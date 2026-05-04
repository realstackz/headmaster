import { Router } from "express";
import { db, inputsTable } from "@workspace/db";
import { randomUUID } from "crypto";
import { parseStringPromise } from "xml2js";

const router = Router();

/* ── Helpers ─────────────────────────────────────────────────── */

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractVideoId(input: string): string | null {
  input = input.trim();
  if (YT_ID_RE.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (url.searchParams.has("list")) return null;
      const v = url.searchParams.get("v");
      if (v && YT_ID_RE.test(v)) return v;
      const m = url.pathname.match(/^\/(shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
    if (host === "youtu.be") {
      if (url.searchParams.has("list")) return null;
      const id = url.pathname.slice(1).split("?")[0];
      if (YT_ID_RE.test(id)) return id;
    }
  } catch {
    // not a URL
  }
  return null;
}

function extractPlaylistId(input: string): string | null {
  input = input.trim();
  if (/^PL[A-Za-z0-9_-]{10,}$/.test(input)) return input;
  try {
    const url = new URL(input);
    const list = url.searchParams.get("list");
    if (list) return list;
  } catch {
    // not a URL — fall through
  }
  return null;
}

interface YtEntry {
  title?: string[];
  "yt:videoId"?: string[];
  "media:group"?: Array<{ "media:description"?: string[] }>;
}

async function fetchVideoFeed(videoId: string): Promise<string | null> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?video_id=${videoId}`;
  try {
    const resp = await fetch(rssUrl, {
      headers: { "User-Agent": "Headmaster/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;

    const xml = await resp.text();
    const parsed = await parseStringPromise(xml, { explicitArray: true });

    const feed = parsed?.feed ?? {};
    const rawEntries: YtEntry[] = (feed.entry as YtEntry[] | undefined) ?? [];
    if (rawEntries.length === 0) return null;

    const description = (rawEntries[0]["media:group"]?.[0]?.["media:description"]?.[0] ?? "") as string;
    return description.trim() || null;
  } catch {
    return null;
  }
}

async function fetchPlaylistFeed(playlistId: string): Promise<{
  feedTitle: string;
  entries: Array<{ videoId: string | null; title: string; description: string }>;
}> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistId}`;
  const resp = await fetch(rssUrl, {
    headers: { "User-Agent": "Headmaster/1.0" },
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`YouTube RSS returned ${resp.status}`);
  }

  const xml = await resp.text();
  const parsed = await parseStringPromise(xml, { explicitArray: true });

  const feed = parsed?.feed ?? {};
  const feedTitle: string = (feed.title?.[0] as string | undefined) ?? "YouTube Playlist";
  const rawEntries: YtEntry[] = (feed.entry as YtEntry[] | undefined) ?? [];

  const entries = rawEntries.map((e) => ({
    videoId:     (e["yt:videoId"]?.[0] ?? null) as string | null,
    title:       (e.title?.[0] ?? "") as string,
    description: (e["media:group"]?.[0]?.["media:description"]?.[0] ?? "") as string,
  }));

  return { feedTitle, entries };
}

interface OEmbedResponse {
  title?: string;
  author_name?: string;
}

async function fetchYouTubeTranscript(videoId: string): Promise<string | null> {
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    if (!segments || segments.length === 0) return null;
    return segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  } catch {
    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      if (!segments || segments.length === 0) return null;
      return segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
    } catch {
      return null;
    }
  }
}

async function fetchVideoData(
  videoId: string,
  shouldFetchTranscript = true,
): Promise<{ title: string; content: string; hasTranscript: boolean }> {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const oembedResp = await fetch(oembedUrl, {
    headers: { "User-Agent": "Headmaster/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!oembedResp.ok) {
    if (oembedResp.status === 401 || oembedResp.status === 403 || oembedResp.status === 404) {
      throw new Error(`Video is private or unavailable (${oembedResp.status})`);
    }
    throw new Error(`YouTube oEmbed returned ${oembedResp.status}`);
  }
  const oembedData = await oembedResp.json() as OEmbedResponse;
  const title = oembedData.title ?? `YouTube Video (${videoId})`;
  const author = oembedData.author_name ?? "";

  // Fetch transcript and RSS description in parallel
  const [transcript, rssDescription] = await Promise.all([
    shouldFetchTranscript ? fetchYouTubeTranscript(videoId) : Promise.resolve(null),
    fetchVideoFeed(videoId),
  ]);

  let content: string;
  if (transcript && rssDescription) {
    content = `${rssDescription}\n\n${transcript}`;
  } else if (transcript) {
    content = transcript;
  } else if (rssDescription) {
    content = rssDescription;
  } else {
    content = author
      ? `Video by ${author}.\n\nWatch at ${videoUrl}`
      : `Watch at ${videoUrl}`;
  }

  return { title, content, hasTranscript: transcript !== null };
}

/* ── POST /inputs/youtube ─────────────────────────────────────── */
router.post("/inputs/youtube", async (req, res) => {
  const { url, title: customTitle, fetchTranscripts } = req.body as {
    url?: string;
    title?: string;
    fetchTranscripts?: boolean;
  };

  const shouldFetchTranscripts = fetchTranscripts !== false && (fetchTranscripts as unknown) !== "false";

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  const trimmed = url.trim();
  const now = new Date();

  // ── Single video ──────────────────────────────────────────────
  const videoId = extractVideoId(trimmed);
  if (videoId) {
    try {
      const { title: videoTitle, content } = await fetchVideoData(videoId);
      const title = customTitle?.trim() || videoTitle;
      const [input] = await db
        .insert(inputsTable)
        .values({
          id:        randomUUID(),
          title,
          content,
          type:      "youtube" as const,
          processed: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      res.status(201).json({ input, playlistEntries: null });
    } catch (err) {
      req.log.error({ err }, "YouTube video fetch error");
      const msg = err instanceof Error ? err.message : "Failed to fetch video";
      const isUnavailable = msg.includes("private or unavailable");
      res.status(isUnavailable ? 422 : 500).json({ error: isUnavailable ? msg : "Failed to fetch video. Make sure it is public." });
    }
    return;
  }

  // ── Playlist (NDJSON streaming) ────────────────────────────────
  const playlistId = extractPlaylistId(trimmed);
  if (!playlistId) {
    res.status(400).json({ error: "Could not recognise a YouTube video or playlist URL" });
    return;
  }

  let feedTitle: string;
  let entries: Array<{ videoId: string | null; title: string; description: string }>;

  try {
    ({ feedTitle, entries } = await fetchPlaylistFeed(playlistId));
  } catch (err) {
    req.log.error({ err }, "YouTube playlist feed error");
    res.status(500).json({ error: "Failed to fetch playlist. Make sure it is public." });
    return;
  }

  if (entries.length === 0) {
    res.status(422).json({ error: "Playlist is empty or private" });
    return;
  }

  const playlistTitle = customTitle?.trim() || feedTitle || `YouTube Playlist (${playlistId})`;

  // Start NDJSON streaming response
  res.writeHead(200, {
    "Content-Type":    "application/x-ndjson; charset=utf-8",
    "Transfer-Encoding": "chunked",
    "Cache-Control":   "no-cache",
    "X-Accel-Buffering": "no",
  });

  const writeLine = (obj: unknown) => {
    res.write(JSON.stringify(obj) + "\n");
  };

  writeLine({ type: "start", total: entries.length, playlistTitle });

  let added   = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const index = i + 1;

    if (!entry.videoId) {
      writeLine({ type: "skip", index, total: entries.length, title: entry.title, reason: "no video ID" });
      skipped++;
      continue;
    }

    // Fetch video data — failure here means video is unavailable; skip it
    let videoTitle: string;
    let content: string;
    let hasTranscript: boolean;
    try {
      ({ title: videoTitle, content, hasTranscript } = await fetchVideoData(
        entry.videoId,
        shouldFetchTranscripts,
      ));
    } catch (err) {
      req.log.warn({ err, videoId: entry.videoId }, "Skipping unavailable playlist video");
      writeLine({ type: "skip", index, total: entries.length, title: entry.title, reason: "unavailable or private" });
      skipped++;
      continue;
    }

    // DB insert — failure here is an internal error; abort the stream
    let insertedRows: (typeof inputsTable.$inferSelect)[];
    try {
      insertedRows = await db
        .insert(inputsTable)
        .values({
          id:        randomUUID(),
          title:     videoTitle,
          content,
          type:      "youtube" as const,
          processed: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    } catch (err) {
      req.log.error({ err, videoId: entry.videoId }, "DB insert failed during playlist import");
      writeLine({ type: "error", message: "Internal error: failed to save video to database" });
      res.end();
      return;
    }

    writeLine({ type: "video", index, total: entries.length, title: videoTitle, input: insertedRows[0], hasTranscript });
    added++;
  }

  writeLine({ type: "done", added, skipped });
  res.end();
});

export default router;
