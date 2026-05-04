import { Router } from "express";
import { db } from "@workspace/db";
import { inputsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { resolve4, resolve6 } from "dns/promises";
import { CreateInputBody } from "@workspace/api-zod";

const router = Router();

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

async function isSsrfSafe(urlStr: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (isPrivateIp(host)) return false;
  const ips4 = await resolve4(host).catch(() => [] as string[]);
  const ips6 = await resolve6(host).catch(() => [] as string[]);
  if ([...ips4, ...ips6].some(isPrivateIp)) return false;
  return true;
}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 128 * 1024;

async function readLimitedText(resp: Response): Promise<string> {
  const reader = resp.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  try {
    while (bytesRead < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function ssrfSafeFetch(url: string, extraHeaders?: Record<string, string>): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSsrfSafe(current))) return null;
    let resp: Response;
    try {
      resp = await fetch(current, {
        headers: { "User-Agent": "Headmaster/1.0", ...extraHeaders },
        signal: AbortSignal.timeout(8000),
        redirect: "manual",
      });
    } catch {
      return null;
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!resp.ok) return null;
    return await readLimitedText(resp);
  }
  return null;
}

function extractOgMeta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    html.match(new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']{1,2000})["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,2000})["'][^>]+property=["']${escaped}["']`, "i"));
  return m?.[1]?.trim() ?? null;
}

function isInstagramUrl(url: string): boolean {
  try {
    const p = new URL(url);
    const host = p.hostname.toLowerCase().replace(/^www\./, "");
    return host === "instagram.com" && p.pathname.includes("/p/");
  } catch {
    return false;
  }
}

function isPinterestUrl(url: string): boolean {
  try {
    const p = new URL(url);
    const host = p.hostname.toLowerCase().replace(/^www\./, "");
    return (host === "pinterest.com" || host.endsWith(".pinterest.com")) && p.pathname.includes("/pin/");
  } catch {
    return false;
  }
}

async function fetchInstagramContent(url: string): Promise<{ title: string; content: string } | null> {
  const instagramToken = process.env.INSTAGRAM_TOKEN;

  if (instagramToken) {
    const oembedUrl = `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(instagramToken)}&fields=author_name,thumbnail_url,html`;
    if (await isSsrfSafe(oembedUrl)) {
      try {
        const resp = await fetch(oembedUrl, {
          headers: { "User-Agent": "Headmaster/1.0" },
          signal: AbortSignal.timeout(8000),
        });
        if (resp.ok) {
          const data = (await resp.json()) as { author_name?: string; html?: string };
          const authorName = data.author_name?.trim();
          if (authorName) {
            const pageHtml = await ssrfSafeFetch(url, { "Accept-Language": "en-US,en;q=0.9" });
            const caption = pageHtml ? extractOgMeta(pageHtml, "og:description") : null;
            const title = `@${authorName}`.slice(0, 80);
            const content = [`Posted by @${authorName}`, caption].filter(Boolean).join("\n\n");
            return { title, content: content || url };
          }
        }
      } catch {
        /* fall through to meta-scrape */
      }
    }
  }

  /* Fallback: scrape public Open Graph meta tags */
  const html = await ssrfSafeFetch(url, { "Accept-Language": "en-US,en;q=0.9" });
  if (!html) return null;
  const caption = extractOgMeta(html, "og:description");
  const ogTitle = extractOgMeta(html, "og:title");
  if (!caption && !ogTitle) return null;
  const title = (ogTitle ?? url).slice(0, 80);
  const content = [ogTitle, caption].filter(Boolean).join("\n\n") || url;
  return { title, content };
}

async function fetchPinterestContent(url: string): Promise<{ title: string; content: string } | null> {
  const oembedUrl = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`;
  if (!(await isSsrfSafe(oembedUrl))) return null;
  try {
    const resp = await fetch(oembedUrl, {
      headers: { "User-Agent": "Headmaster/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { title?: string; description?: string };
    const title = (data.title?.trim() ?? "Pinterest Pin").slice(0, 80);
    const content = [data.title?.trim(), data.description?.trim()].filter(Boolean).join("\n\n") || url;
    return { title, content };
  } catch {
    return null;
  }
}

const YT_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isYouTubeVideoUrl(url: string): boolean {
  try {
    const p = new URL(url);
    const host = p.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      if (p.searchParams.has("list")) return false;
      const id = p.pathname.slice(1).split("?")[0];
      return YT_VIDEO_ID_RE.test(id);
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (p.searchParams.has("list")) return false;
      const v = p.searchParams.get("v");
      if (v && YT_VIDEO_ID_RE.test(v)) return true;
      const m = p.pathname.match(/^\/(shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      return !!m;
    }
    return false;
  } catch {
    return false;
  }
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const p = new URL(url);
    const host = p.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = p.pathname.slice(1).split("?")[0];
      if (YT_VIDEO_ID_RE.test(id)) return id;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = p.searchParams.get("v");
      if (v && YT_VIDEO_ID_RE.test(v)) return v;
      const m = p.pathname.match(/^\/(shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[2];
    }
  } catch {
    // not a URL
  }
  return null;
}

async function fetchYouTubeVideoContent(url: string): Promise<{ title: string; content: string } | null> {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) return null;

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  let title = `YouTube Video (${videoId})`;
  let author = "";
  try {
    const oembedResp = await fetch(oembedUrl, {
      headers: { "User-Agent": "Headmaster/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (oembedResp.ok) {
      const data = (await oembedResp.json()) as { title?: string; author_name?: string };
      if (data.title) title = data.title;
      if (data.author_name) author = data.author_name;
    } else if (oembedResp.status === 401 || oembedResp.status === 403 || oembedResp.status === 404) {
      return null;
    }
  } catch {
    // best-effort
  }

  // Try transcript first
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    let segments = null;
    try {
      segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    } catch {
      segments = await YoutubeTranscript.fetchTranscript(videoId);
    }
    if (segments && segments.length > 0) {
      const transcript = segments.map((s: { text: string }) => s.text).join(" ").replace(/\s+/g, " ").trim();
      if (transcript) return { title, content: transcript };
    }
  } catch {
    // no transcript available — fall through to description
  }

  // Fall back to page description
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const pageResp = await fetch(videoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (pageResp.ok) {
      const html = await pageResp.text();
      const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      if (m?.[1]) {
        const description = JSON.parse(`"${m[1]}"`);
        if (description) return { title, content: description };
      }
    }
  } catch {
    // best-effort
  }

  const fallback = author
    ? `Video by ${author}.\n\nWatch at ${videoUrl}`
    : `Watch at ${videoUrl}`;
  return { title, content: fallback };
}

async function fetchUrlTitle(url: string): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isSsrfSafe(current))) return null;
    let resp: Response;
    try {
      resp = await fetch(current, {
        headers: { "User-Agent": "Headmaster/1.0" },
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
      });
    } catch {
      return null;
    }
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) return null;
      try {
        current = new URL(location, current).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    const html = await readLimitedText(resp);
    const og =
      html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og?.[1]) return og[1].trim().slice(0, 80);
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag?.[1]) return titleTag[1].trim().slice(0, 80);
    return null;
  }
  return null;
}

function firstLineTitle(text: string): string {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const h1 = trimmed.match(/^#+\s+(.+)/);
    if (h1) return h1[1].trim().slice(0, 80);
    return trimmed.slice(0, 80);
  }
  return "";
}

router.get("/inputs", async (req, res) => {
  const inputs = await db.select().from(inputsTable).orderBy(inputsTable.createdAt);
  res.json(inputs);
});

router.post("/inputs", async (req, res) => {
  const parsed = CreateInputBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error });
    return;
  }
  const { title: rawTitle, content, type } = parsed.data;

  let title = rawTitle.trim();
  let finalContent = content.trim();
  let finalType: "text" | "url" | "note" | "file" | "youtube" | "instagram" | "pinterest" | "image" | "video" | "audio" = type as typeof finalType;

  if (type === "url") {
    const urlTrimmed = content.trim();
    if (isInstagramUrl(urlTrimmed)) {
      const ig = await fetchInstagramContent(urlTrimmed);
      if (!ig) {
        res.status(422).json({ error: "Could not fetch this Instagram post. It may be private or restricted." });
        return;
      }
      finalType = "instagram";
      finalContent = ig.content;
      if (!title) title = ig.title;
    } else if (isPinterestUrl(urlTrimmed)) {
      const pin = await fetchPinterestContent(urlTrimmed);
      if (!pin) {
        res.status(422).json({ error: "Could not fetch this Pinterest pin. It may be private or unavailable." });
        return;
      }
      finalType = "pinterest";
      finalContent = pin.content;
      if (!title) title = pin.title;
    } else if (isYouTubeVideoUrl(urlTrimmed)) {
      const yt = await fetchYouTubeVideoContent(urlTrimmed);
      if (!yt) {
        res.status(422).json({ error: "Could not fetch this YouTube video. It may be private or unavailable." });
        return;
      }
      finalType = "youtube";
      finalContent = yt.content;
      if (!title) title = yt.title;
    } else {
      if (!title) {
        title = (await fetchUrlTitle(urlTrimmed)) ?? urlTrimmed.slice(0, 80);
      }
    }
  } else {
    if (!title) {
      title = firstLineTitle(content) || "Untitled";
    }
  }

  const now = new Date();
  const [input] = await db
    .insert(inputsTable)
    .values({ id: randomUUID(), title, content: finalContent, type: finalType, processed: false, createdAt: now, updatedAt: now })
    .returning();
  res.status(201).json(input);
});

router.get("/inputs/:id", async (req, res) => {
  const [input] = await db.select().from(inputsTable).where(eq(inputsTable.id, req.params.id));
  if (!input) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(input);
});

router.delete("/inputs/:id", async (req, res) => {
  await db.delete(inputsTable).where(eq(inputsTable.id, req.params.id));
  res.status(204).send();
});

/* ── Shared types ───────────────────────────────────────────────────── */

type AiNode = { label: string; type: string; description: string; tier?: string; level?: string };
type AiEdge = { from: number; to: number };
type AiAction = { title: string; description: string };
type AiExtracted = { summary: string; nodes: AiNode[]; edges: AiEdge[]; actions: AiAction[] };
type MergeKey = string; // `${type}:${normalizedLabel}`

function mergeKey(type: string, label: string): MergeKey {
  return `${type}:${label.toLowerCase().trim()}`;
}

const VALID_LEVELS = ["beginner", "intermediate", "advanced"] as const;
type ValidLevel = (typeof VALID_LEVELS)[number];
function isValidLevel(v: unknown): v is ValidLevel {
  return VALID_LEVELS.includes(v as ValidLevel);
}

function isDomainNode(n: AiNode): boolean {
  return n.type === "domain" || n.tier === "domain";
}

function isPrimaryNode(n: AiNode): boolean {
  return !isDomainNode(n) && (n.tier === "primary" || n.type === "concept" || n.type === "goal");
}

/* Build a system prompt that includes existing domain context */
function buildSystemPrompt(existingDomainLabels: string[]): string {
  const domainContext =
    existingDomainLabels.length > 0
      ? `\n\nEXISTING DOMAINS IN THE KNOWLEDGE BASE (use these exact labels when the content fits one of them):\n${existingDomainLabels.map((d) => `- ${d}`).join("\n")}`
      : "";

  return `You are a knowledge extraction AI that produces structured, hierarchical knowledge from user input.

Respond with valid JSON only (no markdown fences). Use this exact format:
{
  "summary": "1-2 sentence summary of the content",
  "nodes": [
    {
      "label": "Short Label",
      "type": "domain|concept|goal|insight|action",
      "description": "One sentence explanation",
      "tier": "domain|primary|secondary",
      "level": "beginner|intermediate|advanced"
    }
  ],
  "edges": [
    { "from": 0, "to": 2 }
  ],
  "actions": [
    {
      "title": "Actionable task title",
      "description": "Brief description"
    }
  ]
}

STRICT RULES:
- List DOMAIN nodes FIRST (tier="domain", type="domain"): 1-3 broad knowledge areas the content belongs to (e.g. "Fashion", "Business", "Technology", "Finance", "Health", "Education"). Choose only the most relevant domain(s). Domain nodes do NOT get a level field (omit it or set null).${domainContext}
- After domains, list exactly 2-4 PRIMARY nodes (tier="primary") of type "concept" or "goal". These are the main topics within the domain(s). Assign each a level: "beginner" for foundational concepts a newcomer needs first, "intermediate" for topics requiring some prerequisite knowledge, "advanced" for expert-level or complex topics.
- After primaries, list exactly 2-3 SECONDARY nodes (tier="secondary") per primary, of type "insight" or "action". These support or elaborate the primary. Assign each secondary the SAME level as its parent primary.
- Total secondaries: 4-9 nodes depending on number of primaries.
- EDGES (zero-based indices into the "nodes" array):
  - Each primary (concept/goal) MUST have an edge FROM exactly one domain node (domain index → primary index).
  - Every secondary MUST have an edge FROM exactly one primary (primary index → secondary index).
  - Add cross-domain edges between concept/goal nodes when they genuinely relate across domains.
- Labels must be 4 words or fewer, concise and descriptive.
- Descriptions must be exactly 1 sentence.
- Produce 1-3 actions (actionable next steps).`;
}

/* Call OpenAI and return parsed extraction */
async function callOpenAi(
  input: { title: string; content: string },
  systemPrompt: string,
  openaiKey: string,
  logger: { error: (obj: object, msg: string) => void },
): Promise<AiExtracted | null> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Title: ${input.title}\n\nContent: ${input.content}` },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    logger.error({ err }, "OpenAI error");
    return null;
  }

  const aiData = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  const rawContent = aiData.choices[0]?.message?.content ?? "{}";
  return JSON.parse(rawContent) as AiExtracted;
}

/* ── Core merge-and-insert: runs inside a DB transaction ────────────── */

type InsertedNode = {
  id: string;
  label: string;
  type: string;
  level: string | null;
  description: string | null;
  inputId: string | null;
  positionX: number;
  positionY: number;
  createdAt: Date;
  updatedAt: Date;
  reused: boolean;
};

async function mergeAndInsert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  inputId: string,
  extracted: AiExtracted,
  now: Date,
  /* mutable: updated in-place so later nodes in the same batch find each other */
  existingByKey: Map<MergeKey, { id: string; description: string | null }>,
): Promise<InsertedNode[]> {
  const { nodesTable } = await import("@workspace/db");
  const { nodeSourcesTable } = await import("@workspace/db");

  const rawNodes = extracted.nodes ?? [];

  const domains     = rawNodes.filter(isDomainNode);
  const primaries   = rawNodes.filter(isPrimaryNode);
  const secondaries = rawNodes.filter((n) => !isDomainNode(n) && !isPrimaryNode(n));
  const orderedNodes = [...domains, ...primaries, ...secondaries];

  /* Pre-compute level inheritance */
  const primaryRawLevels: Record<number, ValidLevel | undefined> = {};
  rawNodes.forEach((n, idx) => {
    if (isPrimaryNode(n)) primaryRawLevels[idx] = isValidLevel(n.level) ? n.level : undefined;
  });

  const secParentPrimIdx: Record<number, number> = {};
  (extracted.edges ?? []).forEach((e) => {
    const src = rawNodes[e.from];
    const tgt = rawNodes[e.to];
    if (src && tgt && isPrimaryNode(src) && !isPrimaryNode(tgt) && !isDomainNode(tgt) && !(e.to in secParentPrimIdx)) {
      secParentPrimIdx[e.to] = e.from;
    }
  });

  function resolveLevel(n: AiNode, rawIdx: number): ValidLevel | undefined {
    if (isDomainNode(n)) return undefined;
    if (isPrimaryNode(n)) return isValidLevel(n.level) ? n.level : undefined;
    const parentIdx = secParentPrimIdx[rawIdx];
    if (parentIdx !== undefined && primaryRawLevels[parentIdx] !== undefined) {
      return primaryRawLevels[parentIdx];
    }
    return isValidLevel(n.level) ? n.level : undefined;
  }

  const cols = 3;
  const insertedNodes: InsertedNode[] = [];

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    const rawIdx = rawNodes.indexOf(node);
    const domainIdx  = domains.indexOf(node);
    const primaryIdx = primaries.indexOf(node);
    const secIdx     = secondaries.indexOf(node);

    let posX: number;
    let posY: number;
    if (domainIdx >= 0) {
      posX = 0;
      posY = 100 + domainIdx * 250;
    } else if (primaryIdx >= 0) {
      posX = 350;
      posY = 100 + primaryIdx * 200;
    } else {
      posX = 700 + (secIdx % cols) * 250;
      posY = 100 + Math.floor(secIdx / cols) * 200;
    }

    const resolvedType = (isDomainNode(node) ? "domain" : node.type) as
      "domain" | "concept" | "insight" | "action" | "goal";
    const nodeLevel = resolveLevel(node, rawIdx);
    const key = mergeKey(resolvedType, node.label);
    const existing = existingByKey.get(key);

    let nodeId: string;
    let reused = false;

    if (existing) {
      /* Reuse existing node — synthesize description if needed */
      nodeId = existing.id;
      reused = true;

      let mergedDescription = existing.description;
      if (!existing.description && node.description) {
        /* Fill in a blank description from new input */
        mergedDescription = node.description;
        await tx
          .update(nodesTable)
          .set({ description: node.description, updatedAt: now })
          .where(eq(nodesTable.id, existing.id));
      } else if (
        existing.description &&
        node.description &&
        node.description.trim() !== existing.description.trim()
      ) {
        /* Both have descriptions — keep the more informative (longer) one,
           or concatenate when neither is clearly better */
        const existLen = existing.description.trim().length;
        const newLen   = node.description.trim().length;
        if (newLen > existLen * 1.5) {
          mergedDescription = node.description;
        } else if (existLen > newLen * 1.5) {
          mergedDescription = existing.description;
        } else {
          /* Similar length — concatenate, capped to avoid bloat */
          mergedDescription = `${existing.description.trimEnd()} ${node.description.trimStart()}`.slice(0, 500);
        }
        await tx
          .update(nodesTable)
          .set({ description: mergedDescription, updatedAt: now })
          .where(eq(nodesTable.id, existing.id));
      }

      insertedNodes.push({
        id: nodeId,
        label: node.label,
        type: resolvedType,
        level: nodeLevel ?? null,
        description: mergedDescription ?? null,
        inputId: null,
        positionX: posX,
        positionY: posY,
        createdAt: now,
        updatedAt: now,
        reused: true,
      });
    } else {
      /* Create new node */
      const [createdNode] = await tx
        .insert(nodesTable)
        .values({
          id: randomUUID(),
          label: node.label,
          type: resolvedType,
          level: nodeLevel,
          description: node.description,
          inputId,
          positionX: posX,
          positionY: posY,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      nodeId = createdNode.id;
      /* Register so later nodes in the same batch can find this one */
      existingByKey.set(key, { id: nodeId, description: node.description ?? null });
      insertedNodes.push({ ...createdNode, reused: false });
    }

    /* Always record this input as a source */
    await tx
      .insert(nodeSourcesTable)
      .values({ nodeId, inputId, createdAt: now })
      .onConflictDoNothing();
  }

  return insertedNodes;
}

/* Build edge lists and insert them inside a transaction */
async function insertEdges(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  insertedNodes: InsertedNode[],
  rawNodes: AiNode[],
  rawEdges: AiEdge[],
  now: Date,
) {
  const { edgesTable } = await import("@workspace/db");

  const domains     = rawNodes.filter(isDomainNode);
  const primaries   = rawNodes.filter(isPrimaryNode);
  const secondaries = rawNodes.filter((n) => !isDomainNode(n) && !isPrimaryNode(n));

  const domainInserted    = insertedNodes.slice(0, domains.length);
  const primaryInserted   = insertedNodes.slice(domains.length, domains.length + primaries.length);
  const secondaryInserted = insertedNodes.slice(domains.length + primaries.length);

  /* Map raw index → insertedNodes index */
  const rawIndexToInsertedIndex: number[] = rawNodes.map((rawNode) => {
    if (isDomainNode(rawNode)) return domains.indexOf(rawNode);
    if (isPrimaryNode(rawNode)) return domains.length + primaries.indexOf(rawNode);
    return domains.length + primaries.length + secondaries.indexOf(rawNode);
  });

  const pendingEdges: Array<{ srcId: string; tgtId: string }> = [];
  const edgeSet = new Set<string>();

  const addEdge = (srcId: string, tgtId: string) => {
    const key = `${srcId}→${tgtId}`;
    if (!edgeSet.has(key) && srcId !== tgtId) {
      edgeSet.add(key);
      pendingEdges.push({ srcId, tgtId });
    }
  };

  /* Check existing edges to avoid duplicates for reused nodes */
  const existingEdgeRows = await tx
    .select({ sourceId: edgesTable.sourceId, targetId: edgesTable.targetId })
    .from(edgesTable);
  for (const e of existingEdgeRows) {
    edgeSet.add(`${e.sourceId}→${e.targetId}`);
  }

  for (const edge of rawEdges) {
    const srcIdx = rawIndexToInsertedIndex[edge.from];
    const tgtIdx = rawIndexToInsertedIndex[edge.to];
    if (srcIdx === undefined || tgtIdx === undefined) continue;
    const src = insertedNodes[srcIdx];
    const tgt = insertedNodes[tgtIdx];
    if (src && tgt) addEdge(src.id, tgt.id);
  }

  /* Enforce sequential primary→primary chain */
  for (let i = 0; i < primaryInserted.length - 1; i++) {
    const src = primaryInserted[i];
    const tgt = primaryInserted[i + 1];
    if (src && tgt) addEdge(src.id, tgt.id);
  }

  /* Ensure every primary has a domain parent */
  for (let i = 0; i < primaryInserted.length; i++) {
    const prim = primaryInserted[i];
    const hasParent = pendingEdges.some(
      (e) => e.tgtId === prim.id && domainInserted.some((d) => d.id === e.srcId),
    );
    if (!hasParent && domainInserted.length > 0) {
      addEdge(domainInserted[i % domainInserted.length].id, prim.id);
    }
  }

  /* Ensure every secondary has a primary parent */
  for (let i = 0; i < secondaryInserted.length; i++) {
    const sec = secondaryInserted[i];
    const hasParent = pendingEdges.some(
      (e) => e.tgtId === sec.id && primaryInserted.some((p) => p.id === e.srcId),
    );
    if (!hasParent && primaryInserted.length > 0) {
      addEdge(primaryInserted[i % primaryInserted.length].id, sec.id);
    }
  }

  const createdEdges = [];
  for (const { srcId, tgtId } of pendingEdges) {
    const [createdEdge] = await tx
      .insert(edgesTable)
      .values({ id: randomUUID(), sourceId: srcId, targetId: tgtId, createdAt: now })
      .returning();
    createdEdges.push(createdEdge);
  }
  return createdEdges;
}

/* ── POST /inputs/:id/process ───────────────────────────────────────── */

router.post("/inputs/:id/process", async (req, res) => {
  const [input] = await db.select().from(inputsTable).where(eq(inputsTable.id, req.params.id));
  if (!input) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    res.status(503).json({ error: "OpenAI API key not configured" });
    return;
  }

  try {
    const { nodesTable } = await import("@workspace/db");
    const { actionsTable } = await import("@workspace/db");

    /* Fetch existing nodes for merge lookup (outside transaction) */
    const existingNodes = await db
      .select({ id: nodesTable.id, label: nodesTable.label, type: nodesTable.type, description: nodesTable.description })
      .from(nodesTable);

    const existingByKey = new Map<MergeKey, { id: string; description: string | null }>();
    for (const n of existingNodes) {
      existingByKey.set(mergeKey(n.type, n.label), { id: n.id, description: n.description });
    }

    const existingDomainLabels = existingNodes
      .filter((n) => n.type === "domain")
      .map((n) => n.label);

    const extracted = await callOpenAi(input, buildSystemPrompt(existingDomainLabels), openaiKey, req.log);
    if (!extracted) {
      res.status(500).json({ error: "AI processing failed" });
      return;
    }

    const now = new Date();

    const { updatedInput, insertedNodes, createdEdges, createdActions } = await db.transaction(async (tx) => {
      const [updatedInput] = await tx
        .update(inputsTable)
        .set({ summary: extracted.summary, processed: true, updatedAt: now })
        .where(eq(inputsTable.id, input.id))
        .returning();

      const insertedNodes = await mergeAndInsert(tx, input.id, extracted, now, existingByKey);
      const createdEdges  = await insertEdges(tx, insertedNodes, extracted.nodes ?? [], extracted.edges ?? [], now);

      const createdActions = [];
      for (const action of (extracted.actions ?? [])) {
        const [createdAction] = await tx
          .insert(actionsTable)
          .values({
            id:          randomUUID(),
            title:       action.title,
            description: action.description,
            status:      "pending",
            inputId:     input.id,
            createdAt:   now,
            updatedAt:   now,
          })
          .returning();
        createdActions.push(createdAction);
      }

      return { updatedInput, insertedNodes, createdEdges, createdActions };
    });

    res.json({
      input: updatedInput,
      nodesCreated: insertedNodes,
      actionsCreated: createdActions,
      edgesCreated: createdEdges,
    });
  } catch (err) {
    req.log.error({ err }, "Processing error");
    res.status(500).json({ error: "Processing failed" });
  }
});

/* ── POST /inputs/:id/reprocess ─────────────────────────────────────── */

router.post("/inputs/:id/reprocess", async (req, res) => {
  const [input] = await db.select().from(inputsTable).where(eq(inputsTable.id, req.params.id));
  if (!input) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    res.status(503).json({ error: "OpenAI API key not configured" });
    return;
  }

  try {
    const { nodesTable } = await import("@workspace/db");
    const { edgesTable } = await import("@workspace/db");
    const { actionsTable } = await import("@workspace/db");
    const { nodeSourcesTable } = await import("@workspace/db");
    const { inArray, or, notInArray, sql } = await import("drizzle-orm");

    /* Fetch existing nodes (outside transaction) for merge + domain context */
    const existingNodes = await db
      .select({ id: nodesTable.id, label: nodesTable.label, type: nodesTable.type, description: nodesTable.description })
      .from(nodesTable);

    const existingDomainLabels = existingNodes
      .filter((n) => n.type === "domain")
      .map((n) => n.label);

    /* Run AI extraction FIRST (before touching existing data) */
    const extracted = await callOpenAi(input, buildSystemPrompt(existingDomainLabels), openaiKey, req.log);
    if (!extracted) {
      res.status(500).json({ error: "AI processing failed" });
      return;
    }

    const now = new Date();

    const { updatedInput, insertedNodes, createdEdges, createdActions } = await db.transaction(async (tx) => {
      /* 1. Remove this input's source contributions */
      await tx
        .delete(nodeSourcesTable)
        .where(eq(nodeSourcesTable.inputId, input.id));

      /* 2. Delete ALL nodes that no longer have any source in node_sources.
            This covers:
            - Nodes originally from this input that are now fully unsourced
            - Legacy nodes (inputId-only, never in node_sources) from this input
            Manually created nodes (inputId IS NULL, not in node_sources) are
            excluded since they have no inputId tie to any processed input. */
      const remainingSourceNodeIds = await tx
        .selectDistinct({ nodeId: nodeSourcesTable.nodeId })
        .from(nodeSourcesTable);

      const remainingIds = remainingSourceNodeIds.map((r) => r.nodeId);

      /* Find all nodes that have no remaining source entry AND were originally
         tied to an input (i.e. inputId is not null) to avoid deleting manually
         created nodes that have no source entries at all. */
      const allNodesInDb = await tx
        .select({ id: nodesTable.id, inputId: nodesTable.inputId })
        .from(nodesTable);

      const remainingSet = new Set(remainingIds);
      const orphanIds: string[] = allNodesInDb
        .filter((n) => !remainingSet.has(n.id) && n.inputId !== null)
        .map((n) => n.id);

      if (orphanIds.length > 0) {
        await tx.delete(edgesTable).where(
          or(inArray(edgesTable.sourceId, orphanIds), inArray(edgesTable.targetId, orphanIds)),
        );
        await tx.delete(nodesTable).where(inArray(nodesTable.id, orphanIds));
      }

      /* 3. Re-build existingByKey from what remains in the DB */
      const remainingNodes = await tx
        .select({ id: nodesTable.id, label: nodesTable.label, type: nodesTable.type, description: nodesTable.description })
        .from(nodesTable);

      const existingByKey = new Map<MergeKey, { id: string; description: string | null }>();
      for (const n of remainingNodes) {
        existingByKey.set(mergeKey(n.type, n.label), { id: n.id, description: n.description });
      }

      /* 4. Update input summary */
      const [updatedInput] = await tx
        .update(inputsTable)
        .set({ summary: extracted.summary, processed: true, updatedAt: now })
        .where(eq(inputsTable.id, input.id))
        .returning();

      /* 5. Delete stale actions from previous process run for this input */
      await tx.delete(actionsTable).where(eq(actionsTable.inputId, input.id));

      /* 6. Merge-insert with fresh extracted data */
      const insertedNodes = await mergeAndInsert(tx, input.id, extracted, now, existingByKey);
      const createdEdges  = await insertEdges(tx, insertedNodes, extracted.nodes ?? [], extracted.edges ?? [], now);

      const createdActions = [];
      for (const action of (extracted.actions ?? [])) {
        const [createdAction] = await tx
          .insert(actionsTable)
          .values({
            id:          randomUUID(),
            title:       action.title,
            description: action.description,
            status:      "pending",
            inputId:     input.id,
            createdAt:   now,
            updatedAt:   now,
          })
          .returning();
        createdActions.push(createdAction);
      }

      return { updatedInput, insertedNodes, createdEdges, createdActions };
    });

    res.json({
      input: updatedInput,
      nodesCreated: insertedNodes,
      actionsCreated: createdActions,
      edgesCreated: createdEdges,
    });
  } catch (err) {
    req.log.error({ err }, "Reprocessing error");
    res.status(500).json({ error: "Reprocessing failed" });
  }
});

export default router;
