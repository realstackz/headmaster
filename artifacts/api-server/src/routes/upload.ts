import { Router, Request, Response, NextFunction } from "express";
import multer, { MulterError } from "multer";
import { db, inputsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { spawn } from "child_process";

const router = Router();

const VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const AUDIO_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/x-m4a",
  "audio/mp4",
  "audio/ogg",
  "audio/vorbis",
]);

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "text/plain",
  "text/csv",
  ...IMAGE_MIMES,
  ...VIDEO_MIMES,
  ...AUDIO_MIMES,
]);

const LEGACY_UNSUPPORTED_MIMES = new Set([
  "application/msword",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else if (LEGACY_UNSUPPORTED_MIMES.has(file.mimetype)) {
      cb(new Error(`Legacy .doc files are not supported — please convert to .docx first.`));
    } else {
      cb(new Error(`Unsupported file type. Accepted: PDF, DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, images (JPG, PNG, WEBP, GIF), video (MP4, MOV, WEBM), audio (MP3, WAV, M4A, OGG).`));
    }
  },
});

function extractTitleFromText(text: string, fallback: string): string {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) return h1[1].trim().slice(0, 80);
  }
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^=+$/.test(lines[i + 1].trim()) && lines[i].trim()) {
      return lines[i].trim().slice(0, 80);
    }
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return fallback;
}

function firstSentence(text: string, fallback: string): string {
  const m = text.match(/^[^.!?\n]+[.!?]?/);
  const s = (m?.[0] ?? "").trim().slice(0, 80);
  return s || fallback;
}

interface VisionResult {
  title: string;
  description: string;
}

async function describeImageWithVision(buffer: Buffer, mimetype: string, openaiKey: string): Promise<VisionResult> {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimetype};base64,${base64}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 600,
      messages: [
        {
          role: "system",
          content: `You analyze images and return JSON only (no markdown fences). Use this exact format:
{"title": "Short title (max 10 words) capturing the most prominent text or subject in the image", "description": "2-4 sentence thorough description covering: objects/people/scenes visible, any text present in the image, and the likely context or purpose."}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: "Analyze this image and return the JSON result.",
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Vision API error: ${response.status}`);
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  const raw = (data.choices[0]?.message?.content ?? "").trim();
  try {
    const parsed = JSON.parse(raw) as { title?: string; description?: string };
    return {
      title: (parsed.title ?? "").trim().slice(0, 80),
      description: (parsed.description ?? raw).trim(),
    };
  } catch {
    const firstLine = raw.split("\n")[0] ?? raw;
    return { title: firstLine.trim().slice(0, 80), description: raw };
  }
}

async function extractText(buffer: Buffer, mimetype: string): Promise<string> {
  if (
    mimetype === "application/pdf" ||
    mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimetype === "application/vnd.ms-powerpoint"
  ) {
    const { OfficeParser } = await import("officeparser");
    const ast = await OfficeParser.parseOffice(buffer);
    return ast.toText().trim();
  }

  if (
    mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel"
  ) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheets = wb.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      return csv.trim() ? `=== ${name} ===\n${csv}` : "";
    }).filter(Boolean);
    return sheets.join("\n\n").trim();
  }

  return buffer.toString("utf-8").trim();
}

const WHISPER_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB — stay under Whisper's 25 MB hard cap
const CHUNK_DURATION_S = 20 * 60;             // 20 minutes per chunk (~9 MB at 64 kbps)
const CHUNK_OVERLAP_S = 10;                    // 10 s overlap to avoid cutting mid-word

function spawnFfmpegFromBuffer(
  inputBuffer: Buffer,
  args: string[],
  errorLabel: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });

    const outChunks: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => outChunks.push(c));

    const errChunks: Buffer[] = [];
    ff.stderr.on("data", (c: Buffer) => errChunks.push(c));

    ff.on("close", (code) => {
      if (code === 0 && outChunks.length > 0) {
        resolve(Buffer.concat(outChunks));
      } else {
        const stderr = Buffer.concat(errChunks).toString().slice(-500);
        reject(new Error(`${errorLabel} (ffmpeg code ${code}): ${stderr}`));
      }
    });

    ff.on("error", (err) => reject(new Error(`ffmpeg not found: ${err.message}`)));

    ff.stdin.write(inputBuffer);
    ff.stdin.end();
  });
}

function extractAudioFromVideo(videoBuffer: Buffer): Promise<Buffer> {
  return spawnFfmpegFromBuffer(
    videoBuffer,
    ["-i", "pipe:0", "-vn", "-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", "pipe:1"],
    "Audio extraction failed",
  );
}

function normalizeAudioToMp3(audioBuffer: Buffer): Promise<Buffer> {
  return spawnFfmpegFromBuffer(
    audioBuffer,
    ["-i", "pipe:0", "-vn", "-acodec", "libmp3lame", "-ar", "16000", "-ac", "1", "-b:a", "64k", "-f", "mp3", "pipe:1"],
    "Audio normalization failed",
  );
}

function extractAudioChunk(mp3Buffer: Buffer, startSeconds: number, durationSeconds: number): Promise<Buffer> {
  return spawnFfmpegFromBuffer(
    mp3Buffer,
    [
      "-i", "pipe:0",
      "-ss", String(startSeconds),
      "-t", String(durationSeconds),
      "-acodec", "libmp3lame",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "64k",
      "-f", "mp3",
      "pipe:1",
    ],
    "Audio chunk extraction failed",
  );
}

function getAudioDuration(mp3Buffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "pipe:0",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const outChunks: Buffer[] = [];
    ff.stdout.on("data", (c: Buffer) => outChunks.push(c));

    ff.on("close", (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(Buffer.concat(outChunks).toString()) as {
            format?: { duration?: string };
          };
          const secs = parseFloat(info.format?.duration ?? "0");
          resolve(isNaN(secs) ? 0 : secs);
        } catch {
          reject(new Error("Could not parse audio duration from ffprobe output"));
        }
      } else {
        reject(new Error(`ffprobe exited with code ${code}`));
      }
    });

    ff.on("error", (err) => reject(new Error(`ffprobe not found: ${err.message}`)));
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}

async function transcribeWithWhisper(audioBuffer: Buffer, filename: string, openaiKey: string, mimeType = "audio/mpeg"): Promise<string> {
  const OpenAI = (await import("openai")).default;
  const { toFile } = await import("openai");
  const openai = new OpenAI({ apiKey: openaiKey });
  const file = await toFile(audioBuffer, filename, { type: mimeType });
  try {
    const result = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
    });
    return result.text.trim();
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const status = (err as { status: number }).status;
      if (status === 429) throw new Error("Transcription service is rate-limited — please try again in a moment.");
      if (status === 401 || status === 403) throw new Error("Transcription service is unavailable — invalid API key.");
      if (status >= 500) throw new Error("Transcription service is temporarily unavailable — please try again.");
    }
    throw new Error("Transcription failed — please try again or contact support if the problem persists.");
  }
}

async function transcribeChunked(mp3Buffer: Buffer, filenameStem: string, openaiKey: string): Promise<string> {
  if (mp3Buffer.byteLength <= WHISPER_SIZE_LIMIT) {
    return transcribeWithWhisper(mp3Buffer, `${filenameStem}.mp3`, openaiKey);
  }

  const totalDuration = await getAudioDuration(mp3Buffer);
  if (totalDuration <= 0) {
    return transcribeWithWhisper(mp3Buffer, `${filenameStem}.mp3`, openaiKey);
  }

  const parts: string[] = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < totalDuration) {
    const remaining = totalDuration - offset;
    const chunkDuration = Math.min(CHUNK_DURATION_S + CHUNK_OVERLAP_S, remaining);
    const chunkBuffer = await extractAudioChunk(mp3Buffer, offset, chunkDuration);
    const text = await transcribeWithWhisper(
      chunkBuffer,
      `${filenameStem}_chunk${chunkIndex}.mp3`,
      openaiKey,
    );
    if (text) parts.push(text);
    offset += CHUNK_DURATION_S;
    chunkIndex++;
    if (remaining <= CHUNK_DURATION_S) break;
  }

  return parts.join(" ").trim();
}

router.post(
  "/inputs/upload",
  (req: Request, res: Response, next: NextFunction) => {
    upload.array("files", 20)(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        const message = err.code === "LIMIT_FILE_SIZE"
          ? "File too large — maximum 100 MB per file."
          : `Upload error: ${err.message}`;
        res.status(status).json({ error: message });
        return;
      }
      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: "No files provided." });
      return;
    }

    const now = new Date();
    const created: (typeof inputsTable.$inferSelect)[] = [];
    const errors: { file: string; error: string }[] = [];
    const openaiKey = process.env.OPENAI_API_KEY;

    for (const file of files) {
      const filenameStem = file.originalname.replace(/\.[^.]+$/, "");

      /* ── Video files ─────────────────────────────────────────── */
      if (VIDEO_MIMES.has(file.mimetype)) {
        if (!openaiKey) {
          errors.push({ file: file.originalname, error: "Video transcription requires an OpenAI API key — not configured." });
          continue;
        }
        let audioBuffer: Buffer;
        try {
          audioBuffer = await extractAudioFromVideo(file.buffer);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Audio extraction from video failed");
          errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Could not extract audio from video." });
          continue;
        }
        let transcript: string;
        try {
          transcript = await transcribeChunked(audioBuffer, filenameStem, openaiKey);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Whisper transcription failed for video");
          errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Transcription failed." });
          continue;
        }
        if (!transcript) {
          errors.push({ file: file.originalname, error: "No speech detected in this video." });
          continue;
        }
        try {
          const title = firstSentence(transcript, filenameStem);
          const [input] = await db
            .insert(inputsTable)
            .values({ id: randomUUID(), title, content: transcript, type: "video" as const, processed: false, createdAt: now, updatedAt: now })
            .returning();
          created.push(input);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Failed to persist video input");
          errors.push({ file: file.originalname, error: "Database error — could not save input." });
        }
        continue;
      }

      /* ── Audio files ─────────────────────────────────────────── */
      if (AUDIO_MIMES.has(file.mimetype)) {
        if (!openaiKey) {
          errors.push({ file: file.originalname, error: "Audio transcription requires an OpenAI API key — not configured." });
          continue;
        }
        // For large audio files, normalize to compressed mono MP3 first so chunking works reliably
        let audioBuffer: Buffer = file.buffer;
        if (file.buffer.byteLength > WHISPER_SIZE_LIMIT) {
          try {
            audioBuffer = await normalizeAudioToMp3(file.buffer);
          } catch (err) {
            req.log.error({ err, filename: file.originalname }, "Audio normalization failed");
            errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Could not normalize audio." });
            continue;
          }
        }
        let transcript: string;
        try {
          transcript = await transcribeChunked(audioBuffer, filenameStem, openaiKey);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Whisper transcription failed for audio");
          errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Transcription failed." });
          continue;
        }
        if (!transcript) {
          errors.push({ file: file.originalname, error: "No speech detected in this audio file." });
          continue;
        }
        try {
          const title = firstSentence(transcript, filenameStem);
          const [input] = await db
            .insert(inputsTable)
            .values({ id: randomUUID(), title, content: transcript, type: "audio" as const, processed: false, createdAt: now, updatedAt: now })
            .returning();
          created.push(input);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Failed to persist audio input");
          errors.push({ file: file.originalname, error: "Database error — could not save input." });
        }
        continue;
      }

      /* ── Image files ─────────────────────────────────────────── */
      if (IMAGE_MIMES.has(file.mimetype)) {
        if (!openaiKey) {
          errors.push({ file: file.originalname, error: "Image recognition requires an OpenAI API key — not configured." });
          continue;
        }
        let vision: VisionResult;
        try {
          vision = await describeImageWithVision(file.buffer, file.mimetype, openaiKey);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Vision API failed");
          errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Image recognition failed." });
          continue;
        }
        if (!vision.description) {
          errors.push({ file: file.originalname, error: "Could not extract a description from this image." });
          continue;
        }
        try {
          const title = vision.title || filenameStem;
          const [input] = await db
            .insert(inputsTable)
            .values({ id: randomUUID(), title, content: vision.description, type: "image" as const, processed: false, createdAt: now, updatedAt: now })
            .returning();
          created.push(input);
        } catch (err) {
          req.log.error({ err, filename: file.originalname }, "Failed to persist image input");
          errors.push({ file: file.originalname, error: "Database error — could not save input." });
        }
        continue;
      }

      /* ── Document / text files ───────────────────────────────── */
      let content: string;
      try {
        content = await extractText(file.buffer, file.mimetype);
      } catch (err) {
        req.log.error({ err, filename: file.originalname }, "Text extraction failed");
        errors.push({ file: file.originalname, error: err instanceof Error ? err.message : "Text extraction failed." });
        continue;
      }

      if (!content) {
        errors.push({ file: file.originalname, error: "File appears to be empty." });
        continue;
      }

      try {
        const title = extractTitleFromText(content, filenameStem);
        const [input] = await db
          .insert(inputsTable)
          .values({ id: randomUUID(), title, content, type: "file" as const, processed: false, createdAt: now, updatedAt: now })
          .returning();
        created.push(input);
      } catch (err) {
        req.log.error({ err, filename: file.originalname }, "Failed to persist input");
        errors.push({ file: file.originalname, error: "Database error — could not save input." });
      }
    }

    res.status(201).json({ created, errors });
  }
);

export default router;
