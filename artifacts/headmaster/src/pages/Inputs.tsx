import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListInputs,
  useProcessInput,
  useReprocessInput,
  useDeleteInput,
  useCreateInput,
  useFetchYoutubePlaylist,
  getListInputsQueryKey,
  getGetGraphDataQueryKey,
  getListNodesQueryKey,
  getGetGraphSummaryQueryKey,
  type PlaylistEntry,
  type Input as ApiInput,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Trash2, Cpu, CheckCircle2, FileText, Globe, StickyNote,
  ArrowRight, Loader2, Youtube, Upload, Play, FolderOpen,
  RefreshCw, X, FilePlus, Image, Pin, AlertCircle, Search,
  Video, Music, ExternalLink, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { InputDetailPanel } from "@/components/inputs/InputDetailPanel";

/* ── Types ──────────────────────────────────────────────────────── */
type InputTab = "text" | "note" | "url" | "youtube" | "files";

const TYPE_ICON: Record<string, React.ElementType> = {
  url:       Globe,
  note:      StickyNote,
  text:      FileText,
  file:      FolderOpen,
  youtube:   Youtube,
  instagram: Image,
  pinterest: Pin,
  image:     Image,
  video:     Video,
  audio:     Music,
  domain:    Layers,
};

const TYPE_COLOUR: Record<string, string> = {
  text:      "#3B82F6",
  url:       "#8B5CF6",
  note:      "#F59E0B",
  file:      "#10B981",
  youtube:   "#EF4444",
  instagram: "#E1306C",
  pinterest: "#E60023",
  image:     "#06B6D4",
  video:     "#7C3AED",
  audio:     "#D97706",
  domain:    "#6366F1",
};

interface FileEntry {
  file: File;
  status: "pending" | "uploading" | "completing" | "done" | "error";
  error?: string;
  uploadStartedAt?: number;
  objectUrl?: string;
  progress?: number;
  completingWidth?: number;
  speedBps?: number;
  etaSecs?: number;
}

const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/x-m4a",
  "audio/mp4", "audio/ogg", "audio/vorbis",
]);
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const TRANSCRIBABLE_EXTENSIONS = new Set([
  "mp4", "mov", "webm", "mp3", "wav", "m4a", "ogg",
]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function isTranscribable(file: File): boolean {
  if (VIDEO_MIME_TYPES.has(file.type) || AUDIO_MIME_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TRANSCRIBABLE_EXTENSIONS.has(ext);
}

function isImage(file: File): boolean {
  if (IMAGE_MIME_TYPES.has(file.type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

function splitYouTubeContent(content: string): { description: string | null; transcript: string | null } {
  const idx = content.indexOf("\n\n");
  if (idx === -1) return { description: null, transcript: null };
  const description = content.slice(0, idx).trim() || null;
  const transcript  = content.slice(idx + 2).trim() || null;
  return { description, transcript };
}

function estimateTranscriptionSeconds(file: File): number {
  const mb = file.size / (1024 * 1024);
  return Math.round(Math.max(5, Math.min(90, mb * 4)));
}

function estimateTranscriptionBarWidth(elapsedMs: number, estimatedSecs: number): number {
  const elapsed = elapsedMs / 1000;
  const ratio = elapsed / estimatedSecs;
  if (ratio <= 0.8) return (ratio / 0.8) * 85;
  if (ratio <= 1.0) return 85 + ((ratio - 0.8) / 0.2) * 5;
  const tailElapsed = elapsed - estimatedSecs;
  return Math.min(90 + (tailElapsed / 60) * 5, 95);
}

interface UploadResult {
  created: { id: string; title: string }[];
  errors: { filename: string; error: string }[];
}

function formatSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

function formatEta(secs: number): string {
  if (secs < 60) return `~${Math.ceil(secs)}s`;
  return `~${Math.ceil(secs / 60)}m`;
}

function uploadFileWithProgress(
  file: File,
  onProgress: (pct: number, speedBps: number, etaSecs: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("files", file);

    const startTime = Date.now();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        const elapsedSecs = (Date.now() - startTime) / 1000;
        const speedBps = elapsedSecs > 0 ? e.loaded / elapsedSecs : 0;
        const remaining = e.total - e.loaded;
        const etaSecs = speedBps > 0 ? remaining / speedBps : 0;
        onProgress(pct, speedBps, etaSecs);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          reject(new Error("Failed to parse upload response"));
        }
      } else {
        let msg = `HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText) as Record<string, unknown>;
          if (typeof body.message === "string") msg = body.message;
          else if (typeof body.error === "string") msg = body.error;
        } catch { /* ignore */ }
        reject(new Error(msg));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.open("POST", "/api/inputs/upload");
    xhr.send(formData);
  });
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return <span>{elapsed}s</span>;
}

function CompletingBar({ initialWidth, color = "emerald" }: { initialWidth: number; color?: "emerald" | "cyan" }) {
  const [width, setWidth] = useState(initialWidth);
  useEffect(() => {
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => setWidth(100));
      return inner;
    });
    return () => cancelAnimationFrame(outer);
  }, []);
  const colorClass = color === "cyan"
    ? "bg-cyan-500"
    : "bg-emerald-500";
  return (
    <div
      className={`h-full rounded-full ${colorClass} transition-[width] duration-500 ease-out`}
      style={{ width: `${width}%` }}
    />
  );
}

/* ── Component ───────────────────────────────────────────────────── */
export default function Inputs() {
  const { data: inputs = [], isLoading } = useListInputs();
  const processInput   = useProcessInput();
  const reprocessInput = useReprocessInput();
  const deleteInput    = useDeleteInput();
  const createInput  = useCreateInput();
  const fetchYt      = useFetchYoutubePlaylist();
  const queryClient  = useQueryClient();
  const { toast }    = useToast();

  /* ── Form state ── */
  const [activeTab, setActiveTab] = useState<InputTab>(() => {
    const saved = sessionStorage.getItem("inputs:activeTab");
    const valid: InputTab[] = ["text", "note", "url", "youtube", "files"];
    return valid.includes(saved as InputTab) ? (saved as InputTab) : "text";
  });
  const [title, setTitle]         = useState("");
  const [content, setContent]     = useState("");
  const [ytUrl, setYtUrl]                 = useState("");
  const [ytTitle, setYtTitle]             = useState("");
  const [ytFetchTranscripts, setYtFetchTranscripts] = useState(true);
  const [ytLastEntries, setYtLastEntries] = useState<PlaylistEntry[] | null>(null);

  /* Playlist streaming state */
  type YtStreamVideo = { title: string; hasTranscript: boolean; skipped?: boolean };
  type PlaylistStreamEvent =
    | { type: "start"; total: number; playlistTitle: string }
    | { type: "video"; index: number; total: number; title: string; input: ApiInput; hasTranscript: boolean }
    | { type: "skip";  index: number; total: number; title: string; reason: string }
    | { type: "error"; message: string }
    | { type: "done";  added: number; skipped: number };
  const [ytImportPhase, setYtImportPhase] = useState<"idle" | "importing" | "done">("idle");
  const [ytImportProgress, setYtImportProgress] = useState<{ current: number; total: number; currentTitle: string } | null>(null);
  const [ytImportSummary, setYtImportSummary]   = useState<{ added: number; skipped: number } | null>(null);
  const [ytImportVideos, setYtImportVideos]     = useState<YtStreamVideo[]>([]);
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const fileEntriesRef = useRef<FileEntry[]>([]);
  const [isDragOver, setIsDragOver]   = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [uploadProgress, setUploadProgress]   = useState({ done: 0, total: 0 });
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fileEntriesRef.current = fileEntries; }, [fileEntries]);

  const handleTabChange = (tab: InputTab) => {
    sessionStorage.setItem("inputs:activeTab", tab);
    setActiveTab(tab);
  };

  /* ── Helpers ── */
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInputsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetGraphDataQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetGraphSummaryQueryKey() });
  };

  /* ── Text / URL / Note submit ── */
  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      const input = await createInput.mutateAsync({
        data: { title: title.trim(), content: content.trim(), type: activeTab as "text" | "url" | "note" },
      });
      invalidate();
      setTitle("");
      setContent("");
      toast({ title: "Input saved", description: `"${input.title}" ready to process.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save input";
      toast({ title: "Failed to save", description: msg, variant: "destructive" });
    }
  };

  /* ── Helpers ── */
  const isLikelyPlaylist = (url: string) => /[?&]list=/.test(url.trim());

  /* ── YouTube submit ── */
  const handleYtSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim() || ytImportPhase === "importing" || fetchYt.isPending) return;
    setYtLastEntries(null);
    setYtImportSummary(null);
    setYtImportVideos([]);

    // ── Playlist: stream individual videos ───────────────────────
    if (isLikelyPlaylist(ytUrl)) {
      setYtImportPhase("importing");
      setYtImportProgress(null);

      try {
        const response = await fetch("/api/inputs/youtube", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            url:             ytUrl.trim(),
            title:           ytTitle.trim() || undefined,
            fetchTranscripts: ytFetchTranscripts,
          }),
        });

        if (!response.ok || !response.body) {
          const err = await response.json() as { error?: string };
          throw new Error(err.error ?? `HTTP ${response.status}`);
        }

        const reader  = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as PlaylistStreamEvent;
              if (event.type === "start") {
                setYtImportProgress({ current: 0, total: event.total, currentTitle: event.playlistTitle });
              } else if (event.type === "video") {
                setYtImportProgress({ current: event.index, total: event.total, currentTitle: event.title });
                setYtImportVideos((prev) => [...prev, { title: event.title, hasTranscript: event.hasTranscript }]);
                invalidate();
              } else if (event.type === "skip") {
                setYtImportProgress({ current: event.index, total: event.total, currentTitle: event.title });
                setYtImportVideos((prev) => [...prev, { title: event.title, hasTranscript: false, skipped: true }]);
              } else if (event.type === "error") {
                throw new Error(event.message);
              } else if (event.type === "done") {
                setYtImportPhase("done");
                setYtImportProgress(null);
                setYtImportSummary({ added: event.added, skipped: event.skipped });
                setYtUrl("");
                setYtTitle("");
                invalidate();
                toast({
                  title: `${event.added} video${event.added !== 1 ? "s" : ""} imported`,
                  description: event.skipped > 0 ? `${event.skipped} unavailable video${event.skipped !== 1 ? "s" : ""} skipped` : "All videos ready to process.",
                });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to import playlist";
        toast({ title: "Import failed", description: msg, variant: "destructive" });
        setYtImportPhase("idle");
        setYtImportProgress(null);
      }
      return;
    }

    // ── Single video: existing JSON response path ─────────────────
    try {
      const result = await fetchYt.mutateAsync({
        data: { url: ytUrl.trim(), title: ytTitle.trim() || undefined, fetchTranscripts: ytFetchTranscripts },
      });
      invalidate();
      setYtUrl("");
      setYtTitle("");
      toast({ title: "Fetched from YouTube", description: `"${result.input.title}" ready to process.` });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to fetch from YouTube";
      toast({ title: "Failed", description: msg, variant: "destructive" });
    }
  };

  /* ── File handling ── */
  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const ALLOWED = [
      ".pdf", ".docx", ".xls", ".xlsx", ".pptx", ".ppt", ".txt", ".csv",
      ".jpg", ".jpeg", ".png", ".webp", ".gif",
      ".mp4", ".mov", ".webm",
      ".mp3", ".wav", ".m4a", ".ogg",
    ];
    const accepted = list.filter((f) =>
      ALLOWED.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    const rejected = list.filter((f) => !accepted.includes(f));
    if (rejected.length) {
      toast({
        title: `${rejected.length} file(s) skipped`,
        description: "Supported: PDF, DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, images (JPG, PNG, WEBP, GIF), video (MP4, MOV, WEBM), audio (MP3, WAV, M4A, OGG).",
        variant: "destructive",
      });
    }
    setFileEntries((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        file,
        status: "pending" as const,
        objectUrl: (isTranscribable(file) || isImage(file)) ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, []);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  const removeFile = (idx: number) => {
    setFileEntries((prev) => {
      const entry = prev[idx];
      if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  useEffect(() => {
    return () => {
      fileEntriesRef.current.forEach((e) => { if (e.objectUrl) URL.revokeObjectURL(e.objectUrl); });
    };
  }, []);

  /* ── Upload a single FileEntry (returns true on success) ── */
  const uploadEntry = async (entry: FileEntry): Promise<boolean> => {
    const now = Date.now();
    setFileEntries((prev) =>
      prev.map((f) =>
        f.file === entry.file
          ? { ...f, status: "uploading", error: undefined, uploadStartedAt: now, progress: 0 }
          : f
      )
    );
    try {
      const result = await uploadFileWithProgress(entry.file, (pct, speedBps, etaSecs) => {
        setFileEntries((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, progress: pct, speedBps, etaSecs } : f))
        );
      });
      if (result.errors.length > 0) {
        const msg = result.errors[0]?.error ?? "Processing failed";
        setFileEntries((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "error", error: msg } : f))
        );
        return false;
      } else {
        const completingWidth = (() => {
          if (!isTranscribable(entry.file)) return entry.progress ?? 100;
          const elapsedMs = Date.now() - (entry.uploadStartedAt ?? Date.now());
          return estimateTranscriptionBarWidth(elapsedMs, estimateTranscriptionSeconds(entry.file));
        })();
        setFileEntries((prev) =>
          prev.map((f) => (f.file === entry.file ? { ...f, status: "completing", progress: 100, completingWidth } : f))
        );
        const captured = entry.file;
        const capturedUrl = entry.objectUrl;
        setTimeout(() => {
          setFileEntries((prev) =>
            prev.map((f) => (f.file === captured && f.status === "completing" ? { ...f, status: "done" } : f))
          );
          setTimeout(() => {
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
            setFileEntries((prev) => prev.filter((f) => !(f.file === captured && f.status === "done")));
          }, 2000);
        }, 500);
        return true;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      setFileEntries((prev) =>
        prev.map((f) => (f.file === entry.file ? { ...f, status: "error", error: msg } : f))
      );
      return false;
    }
  };

  const handleFilesUpload = async () => {
    const pending = fileEntries.filter((f) => f.status === "pending");
    if (!pending.length || isUploading) return;

    setIsUploading(true);
    setUploadProgress({ done: 0, total: pending.length });
    let successCount = 0;
    let errorCount   = 0;

    for (const entry of pending) {
      const ok = await uploadEntry(entry);
      if (ok) successCount++; else errorCount++;
      setUploadProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    setIsUploading(false);
    setUploadProgress({ done: 0, total: 0 });
    invalidate();

    if (successCount > 0 || errorCount > 0) {
      if (errorCount === 0) {
        toast({ title: `${successCount} file(s) uploaded`, description: "Ready to process." });
      } else {
        toast({
          title: `${successCount} uploaded, ${errorCount} failed`,
          description: "Check the file list for details.",
          variant: successCount === 0 ? "destructive" : "default",
        });
      }
    }
  };

  /* ── Retry a single failed file ── */
  const retryFile = async (idx: number) => {
    const entry = fileEntries[idx];
    if (!entry || entry.status !== "error" || isUploading) return;
    setIsUploading(true);
    const ok = await uploadEntry(entry);
    setIsUploading(false);
    invalidate();
    if (!ok) {
      toast({ title: "Retry failed", description: entry.file.name, variant: "destructive" });
    }
  };

  /* ── Retry all failed files ── */
  const retryAllFailed = async () => {
    const failed = fileEntries.filter((f) => f.status === "error");
    if (!failed.length || isUploading) return;

    setIsUploading(true);
    setUploadProgress({ done: 0, total: failed.length });
    let successCount = 0;
    let errorCount   = 0;

    for (const entry of failed) {
      const ok = await uploadEntry(entry);
      if (ok) successCount++; else errorCount++;
      setUploadProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    setIsUploading(false);
    setUploadProgress({ done: 0, total: 0 });
    invalidate();

    if (errorCount === 0) {
      toast({ title: `${successCount} file(s) re-uploaded`, description: "Ready to process." });
    } else {
      toast({
        title: `${successCount} succeeded, ${errorCount} still failed`,
        description: "Check the file list for details.",
        variant: successCount === 0 ? "destructive" : "default",
      });
    }
  };

  /* ── Individual process ── */
  const handleProcess = async (id: string) => {
    try {
      const result = await processInput.mutateAsync({ id });
      invalidate();
      toast({
        title: "Processed",
        description: `${result.nodesCreated.length} nodes created.`,
      });
    } catch {
      toast({ title: "Failed to process", variant: "destructive" });
    }
  };

  /* ── Re-process (delete old nodes/edges + regenerate) ── */
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const handleReprocess = async (id: string) => {
    setReprocessingId(id);
    try {
      const result = await reprocessInput.mutateAsync({ id });
      invalidate();
      toast({
        title: "Re-processed",
        description: `${result.nodesCreated.length} nodes regenerated with ${result.edgesCreated.length} connections.`,
      });
    } catch {
      toast({ title: "Failed to re-process", variant: "destructive" });
    } finally {
      setReprocessingId(null);
    }
  };

  /* ── Bulk process ── */
  const handleBulkProcess = async () => {
    const unprocessed = inputs.filter((i) => !i.processed);
    if (!unprocessed.length) {
      toast({ title: "All inputs already processed" });
      return;
    }
    setBulkProcessing(true);
    setBulkProgress({ done: 0, total: unprocessed.length });
    const perInput: { title: string; nodes: number }[] = [];
    let failed = 0;
    for (let i = 0; i < unprocessed.length; i++) {
      const inp = unprocessed[i];
      try {
        const result = await processInput.mutateAsync({ id: inp.id });
        perInput.push({ title: inp.title, nodes: result.nodesCreated.length });
        invalidate();
      } catch {
        failed++;
        perInput.push({ title: inp.title, nodes: 0 });
      }
      setBulkProgress({ done: i + 1, total: unprocessed.length });
    }
    setBulkProcessing(false);
    setBulkProgress({ done: 0, total: 0 });
    const totalNodes = perInput.reduce((sum, r) => sum + r.nodes, 0);
    const lines = perInput
      .filter((r) => r.nodes > 0)
      .slice(0, 3)
      .map((r) => `${r.title}: ${r.nodes} node${r.nodes !== 1 ? "s" : ""}`)
      .join(" · ");
    const suffix = perInput.filter((r) => r.nodes > 0).length > 3
      ? ` +${perInput.filter((r) => r.nodes > 0).length - 3} more`
      : "";
    const desc = lines
      ? `${totalNodes} nodes total — ${lines}${suffix}${failed ? ` · ${failed} failed` : ""}`
      : failed
      ? `${failed} input(s) failed to process`
      : "No new nodes generated";
    toast({ title: "Bulk processing complete", description: desc });
  };

  /* ── Delete ── */
  const handleDelete = async (id: string) => {
    try {
      await deleteInput.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListInputsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetGraphSummaryQueryKey() });
      toast({ title: "Deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const unprocessedCount = inputs.filter((i) => !i.processed).length;

  /* ── Search + filter state — persisted in URL query params for shareability ── */
  const [searchParams, setSearchParams] = useSearchParams();

  const searchQuery  = searchParams.get("q") ?? "";
  const typeFilter   = searchParams.get("type") ?? null;
  const rawStatus    = searchParams.get("status");
  const statusFilter: "all" | "pending" | "processed" =
    rawStatus === "pending" || rawStatus === "processed" ? rawStatus : "all";

  /* ID-based deep-link from NodeDetailPanel */
  const highlightInputId = searchParams.get("inputId") ?? null;

  /* ── Detail panel ── */
  const [selectedInputId, setSelectedInputId] = useState<string | null>(null);
  const selectedInput = useMemo(
    () => inputs.find((i) => i.id === selectedInputId) ?? null,
    [inputs, selectedInputId],
  );

  /* Auto-open panel when deep-linked from Roadmap */
  useEffect(() => {
    if (highlightInputId) {
      setSelectedInputId(highlightInputId);
    }
  }, [highlightInputId]);

  const setSearchQuery = useCallback((value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("q", value); else next.delete("q");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setTypeFilter = useCallback((value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set("type", value); else next.delete("type");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setStatusFilter = useCallback((value: "all" | "pending" | "processed") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value !== "all") next.set("status", value); else next.delete("status");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  /* Canonical type order per spec; only show chips that have ≥1 input */
  const CANONICAL_TYPES = ["text", "note", "url", "youtube", "file", "image", "video", "audio", "instagram", "pinterest"];
  const availableTypes = useMemo(() => {
    const present = new Set<string>(inputs.map((i) => i.type));
    return CANONICAL_TYPES.filter((t) => present.has(t));
  }, [inputs]);

  /* Per-type counts respecting status filter and search query (but not type filter) */
  const typeCountMap = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = inputs;
    if (q) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.content.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q),
      );
    }
    if (statusFilter === "pending")   list = list.filter((i) => !i.processed);
    if (statusFilter === "processed") list = list.filter((i) => i.processed);
    const map: Record<string, number> = {};
    for (const i of list) {
      map[i.type] = (map[i.type] ?? 0) + 1;
    }
    return map;
  }, [inputs, searchQuery, statusFilter]);

  const filteredInputs = useMemo(() => {
    /* When an inputId deep-link is active, show only that one input */
    if (highlightInputId) {
      return inputs.filter((i) => i.id === highlightInputId);
    }
    let list = inputs;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.content.toLowerCase().includes(q) ||
          (i.summary ?? "").toLowerCase().includes(q),
      );
    }
    if (typeFilter) {
      list = list.filter((i) => i.type === typeFilter);
    }
    if (statusFilter === "pending")   list = list.filter((i) => !i.processed);
    if (statusFilter === "processed") list = list.filter((i) => i.processed);
    return list;
  }, [inputs, searchQuery, typeFilter, statusFilter, highlightInputId]);

  const hasActiveFilter = searchQuery.trim() !== "" || typeFilter !== null || statusFilter !== "all" || highlightInputId !== null;

  /* ── Tab config ── */
  const tabs: { id: InputTab; label: string; Icon: React.ElementType }[] = [
    { id: "text",    label: "Text",     Icon: FileText },
    { id: "note",    label: "Note",     Icon: StickyNote },
    { id: "url",     label: "URL",      Icon: Globe },
    { id: "youtube", label: "YouTube",  Icon: Youtube },
    { id: "files",   label: "Files",    Icon: Upload },
  ];

  return (
    <AppLayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Page header */}
        <div className="px-8 py-5 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1 font-mono">
                <span>Headmaster</span>
                <ArrowRight className="w-3 h-3" />
                <span className="text-foreground">Inputs</span>
              </div>
              <h1 className="text-xl font-semibold tracking-tight">Inputs</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Feed knowledge from text, URLs, files, or YouTube videos and playlists.
              </p>
            </div>
            {unprocessedCount > 0 && (
              <button
                onClick={handleBulkProcess}
                disabled={bulkProcessing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {bulkProcessing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {bulkProcessing && bulkProgress.total > 0
                  ? `Processing ${bulkProgress.done}/${bulkProgress.total}…`
                  : `Process All (${unprocessedCount})`
                }
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto p-8 space-y-8">

            {/* ── Input form card ── */}
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              {/* Tab bar */}
              <div className="flex border-b border-border bg-muted/30">
                {tabs.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleTabChange(id)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                      activeTab === id
                        ? "border-primary text-primary bg-card"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="p-6">
                {/* TEXT / NOTE / URL tab */}
                {(activeTab === "text" || activeTab === "note" || activeTab === "url") && (
                  <form onSubmit={handleTextSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Title <span className="font-normal normal-case">(optional — auto-detected)</span>
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={
                          activeTab === "url"
                            ? "Auto-detected from page title"
                            : activeTab === "note"
                            ? "Auto-detected from first line"
                            : "Auto-detected from first line"
                        }
                        className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                        {activeTab === "url" ? "URL" : "Content"}
                      </label>
                      {activeTab === "url" ? (
                        <>
                          <input
                            type="url"
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="https://example.com/article"
                            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                          <div className="flex items-center gap-3 mt-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">Also supports:</span>
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#EF444418", color: "#EF4444" }}>
                              <Youtube className="w-3 h-3" /> YouTube videos (transcript)
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#E1306C18", color: "#E1306C" }}>
                              <Image className="w-3 h-3" /> Instagram posts
                            </span>
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "#E6002318", color: "#E60023" }}>
                              <Pin className="w-3 h-3" /> Pinterest pins
                            </span>
                          </div>
                        </>
                      ) : (
                        <textarea
                          value={content}
                          onChange={(e) => setContent(e.target.value)}
                          placeholder={
                            activeTab === "note"
                              ? "Quick thought, idea, or observation..."
                              : "Paste article, notes, or any text..."
                          }
                          rows={5}
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                        />
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={createInput.isPending || !content.trim()}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {createInput.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FilePlus className="w-4 h-4" />
                      )}
                      Save Input
                    </button>
                  </form>
                )}

                {/* YOUTUBE tab */}
                {activeTab === "youtube" && (
                  <div className="space-y-4">
                    <form onSubmit={handleYtSubmit} className="space-y-4">
                      <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/8 border border-red-500/20">
                        <Youtube className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Paste a <strong className="text-foreground">public YouTube video or playlist URL</strong>.
                          Title and description are fetched automatically — no API key required.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                          YouTube URL <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="url"
                          value={ytUrl}
                          onChange={(e) => {
                            setYtUrl(e.target.value);
                            setYtLastEntries(null);
                            setYtImportPhase("idle");
                            setYtImportVideos([]);
                            setYtImportSummary(null);
                            setYtImportProgress(null);
                          }}
                          placeholder="https://www.youtube.com/watch?v=xxxx  or  /playlist?list=PLxxxx"
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400/40"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                          Custom Title <span className="text-muted-foreground font-normal">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={ytTitle}
                          onChange={(e) => setYtTitle(e.target.value)}
                          placeholder="Defaults to the title from YouTube"
                          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400/40"
                        />
                      </div>
                      <label className="flex items-center gap-3 cursor-pointer select-none group">
                        <div className="relative shrink-0">
                          <input
                            type="checkbox"
                            checked={ytFetchTranscripts}
                            onChange={(e) => setYtFetchTranscripts(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className={cn(
                            "w-9 h-5 rounded-full transition-colors border",
                            ytFetchTranscripts
                              ? "bg-red-600 border-red-600"
                              : "bg-muted border-border"
                          )}>
                            <div className={cn(
                              "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
                              ytFetchTranscripts ? "translate-x-4" : "translate-x-0"
                            )} />
                          </div>
                        </div>
                        <div>
                          <span className="text-sm font-medium text-foreground">Fetch transcripts for each video</span>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Applies to playlists only. Disable to speed up import — descriptions only will be used.
                          </p>
                        </div>
                      </label>
                      <button
                        type="submit"
                        disabled={fetchYt.isPending || ytImportPhase === "importing" || !ytUrl.trim()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                      >
                        {(fetchYt.isPending || ytImportPhase === "importing") ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        {ytImportPhase === "importing" ? "Importing…" : "Fetch from YouTube"}
                      </button>
                    </form>

                    {/* Live import progress (playlist streaming) */}
                    {ytImportPhase === "importing" && ytImportProgress && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
                        <div className="px-3 py-2 border-b border-red-500/15">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold text-red-600 dark:text-red-400">
                              Importing {ytImportProgress.current} of {ytImportProgress.total}…
                            </span>
                            <span className="text-[10px] text-muted-foreground tabular-nums">
                              {ytImportProgress.total > 0
                                ? Math.round((ytImportProgress.current / ytImportProgress.total) * 100)
                                : 0}%
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-red-500/15 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-red-500 transition-[width] duration-300 ease-out"
                              style={{ width: `${ytImportProgress.total > 0 ? (ytImportProgress.current / ytImportProgress.total) * 100 : 0}%` }}
                            />
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
                            {ytImportProgress.currentTitle}
                          </p>
                        </div>
                        {ytImportVideos.length > 0 && (
                          <ul className="divide-y divide-border max-h-48 overflow-y-auto">
                            {[...ytImportVideos].reverse().map((v, i) => (
                              <li key={i} className="flex items-center gap-2.5 px-3 py-2">
                                <span className="flex-1 text-xs text-foreground truncate">{v.title}</span>
                                {v.skipped ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                    Skipped
                                  </span>
                                ) : v.hasTranscript ? (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    <CheckCircle2 className="w-2.5 h-2.5" />
                                    Transcript
                                  </span>
                                ) : (
                                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                    No transcript
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {/* Import complete summary */}
                    {ytImportPhase === "done" && ytImportSummary && ytImportVideos.length > 0 && (
                      <div className="rounded-lg border border-border overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {ytImportSummary.added} video{ytImportSummary.added !== 1 ? "s" : ""} imported
                          </span>
                          <div className="flex items-center gap-2">
                            {ytImportSummary.skipped > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {ytImportSummary.skipped} skipped
                              </span>
                            )}
                            <span className="text-[10px] text-muted-foreground">
                              {ytImportVideos.filter((v) => !v.skipped && v.hasTranscript).length} with transcript
                            </span>
                          </div>
                        </div>
                        <ul className="divide-y divide-border max-h-64 overflow-y-auto">
                          {ytImportVideos.map((v, i) => (
                            <li key={i} className={cn("flex items-center gap-2.5 px-3 py-2", v.skipped && "opacity-50")}>
                              <span className="text-[10px] text-muted-foreground/50 font-mono w-5 shrink-0 text-right">
                                {i + 1}
                              </span>
                              <span className="flex-1 text-xs text-foreground truncate">{v.title}</span>
                              {v.skipped ? (
                                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                  Skipped
                                </span>
                              ) : v.hasTranscript ? (
                                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Transcript
                                </span>
                              ) : (
                                <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                                  No transcript
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                        <div className="px-3 py-2 border-t border-border bg-muted/20">
                          <button
                            onClick={() => { setYtImportPhase("idle"); setYtImportVideos([]); setYtImportSummary(null); }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* FILES tab */}
                {activeTab === "files" && (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                      <Upload className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Drag & drop or pick <strong className="text-foreground">PDF, DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV</strong>, <strong className="text-foreground">images (JPG, PNG, WEBP, GIF)</strong>, <strong className="text-foreground">video (MP4, MOV, WEBM)</strong>, or <strong className="text-foreground">audio (MP3, WAV, M4A, OGG)</strong>.
                        Images are described using AI vision; video and audio are transcribed via Whisper. Max 100 MB per file.
                      </p>
                    </div>

                    {/* Drop zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 cursor-pointer transition-colors",
                        isDragOver
                          ? "border-emerald-500 bg-emerald-500/5"
                          : "border-border hover:border-muted-foreground/40 hover:bg-muted/20"
                      )}
                    >
                      <div className="p-3 rounded-full bg-muted">
                        <Upload className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-foreground">Drop files here or click to browse</p>
                        <p className="text-xs text-muted-foreground mt-1">PDF · DOCX · XLS · XLSX · PPT · PPTX · TXT · CSV · JPG · PNG · WEBP · GIF · MP4 · MOV · WEBM · MP3 · WAV · M4A · OGG</p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.xls,.xlsx,.pptx,.ppt,.txt,.csv,.jpg,.jpeg,.png,.webp,.gif,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg"
                        onChange={handleFilePick}
                        className="hidden"
                      />
                    </div>

                    {/* File list */}
                    {fileEntries.length > 0 && (
                      <div className="space-y-2">
                        {fileEntries.map((entry, idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "px-3 py-2.5 rounded-lg border text-sm",
                              entry.status === "error"
                                ? "bg-destructive/5 border-destructive/30"
                                : entry.status === "done" || entry.status === "completing"
                                ? "bg-emerald-500/5 border-emerald-500/30"
                                : "bg-muted/30 border-border"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <FolderOpen className={cn(
                                "w-4 h-4 shrink-0",
                                entry.status === "error" ? "text-destructive" : "text-emerald-500"
                              )} />
                              <span className="flex-1 truncate text-foreground font-medium">
                                {entry.file.name}
                              </span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {(entry.file.size / 1024).toFixed(0)} KB
                              </span>
                              {entry.status === "uploading" && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500 shrink-0" />
                              )}
                              {(entry.status === "completing" || entry.status === "done") && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              )}
                              {entry.status === "error" && (
                                <>
                                  <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                                  <button
                                    onClick={() => retryFile(idx)}
                                    disabled={isUploading}
                                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40 transition-colors shrink-0"
                                    title="Retry upload"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    Retry
                                  </button>
                                  <button
                                    onClick={() => removeFile(idx)}
                                    className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                                    title="Dismiss"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              {entry.status === "pending" && (
                                <button
                                  onClick={() => removeFile(idx)}
                                  className="p-0.5 rounded text-muted-foreground hover:text-destructive"
                                  title="Remove"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                            {entry.status === "pending" && entry.objectUrl && (
                              <div className="mt-2 pl-7">
                                {isImage(entry.file) ? (
                                  <img
                                    src={entry.objectUrl}
                                    alt={entry.file.name}
                                    className="h-20 max-w-full rounded-md object-contain"
                                  />
                                ) : (
                                  <audio
                                    src={entry.objectUrl}
                                    controls
                                    preload="metadata"
                                    className="w-full h-8"
                                    style={{ height: "32px" }}
                                  />
                                )}
                              </div>
                            )}
                            {(entry.status === "uploading" || entry.status === "completing") && (
                              <div className="mt-1.5 pl-7 space-y-1">
                                {entry.status === "completing" ? (
                                  <>
                                    <p className="text-xs text-emerald-600 font-medium">
                                      Done!
                                    </p>
                                    <div className="h-1 w-full rounded-full bg-emerald-500/15 overflow-hidden">
                                      <CompletingBar
                                        initialWidth={entry.completingWidth ?? (isImage(entry.file) ? 0 : (entry.progress ?? 100))}
                                        color={isImage(entry.file) ? "cyan" : "emerald"}
                                      />
                                    </div>
                                  </>
                                ) : entry.progress !== undefined && entry.progress < 100 ? (
                                  <>
                                    <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
                                      <span>Uploading… {entry.progress}%</span>
                                      {entry.speedBps !== undefined && entry.speedBps > 0 && (
                                        <span className="text-muted-foreground font-normal">
                                          — {formatSpeed(entry.speedBps)}
                                          {entry.etaSecs !== undefined && entry.etaSecs > 0 && entry.progress < 99 && (
                                            <> · {formatEta(entry.etaSecs)} remaining</>
                                          )}
                                        </span>
                                      )}
                                    </p>
                                    <div className="h-1 w-full rounded-full bg-emerald-500/15 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-out"
                                        style={{ width: `${entry.progress}%` }}
                                      />
                                    </div>
                                  </>
                                ) : isTranscribable(entry.file) ? (
                                  <>
                                    <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
                                      Transcribing… (may take a moment)
                                      <span className="text-muted-foreground font-normal">
                                        {entry.uploadStartedAt && (
                                          <>— <ElapsedTimer startedAt={entry.uploadStartedAt} /> / ~{estimateTranscriptionSeconds(entry.file)}s</>
                                        )}
                                      </span>
                                    </p>
                                    <div className="h-1 w-full rounded-full bg-emerald-500/15 overflow-hidden">
                                      <div
                                        className="h-full rounded-full bg-emerald-500 origin-left"
                                        style={{
                                          animation: [
                                            `transcription-progress ${estimateTranscriptionSeconds(entry.file)}s linear forwards`,
                                            `transcription-progress-tail 60s linear ${estimateTranscriptionSeconds(entry.file)}s forwards`,
                                          ].join(", "),
                                        }}
                                      />
                                    </div>
                                  </>
                                ) : isImage(entry.file) ? (
                                  <>
                                    <p className="text-xs text-cyan-600 font-medium flex items-center gap-1.5">
                                      Analyzing image… (may take a moment)
                                      <span className="text-muted-foreground font-normal">
                                        {entry.uploadStartedAt && (
                                          <>— <ElapsedTimer startedAt={entry.uploadStartedAt} /></>
                                        )}
                                      </span>
                                    </p>
                                    <div className="h-1 w-full rounded-full bg-cyan-500/15 overflow-hidden">
                                      <div className="h-full rounded-full bg-cyan-500 origin-left animate-indeterminate-progress" />
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-xs text-emerald-600 font-medium">
                                      Uploading… 100%
                                    </p>
                                    <div className="h-1 w-full rounded-full bg-emerald-500/15 overflow-hidden">
                                      <div className="h-full w-full rounded-full bg-emerald-500" />
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                            {entry.status === "error" && entry.error && (
                              <p className="mt-1 text-xs text-destructive pl-7 leading-snug">
                                {entry.error}
                              </p>
                            )}
                          </div>
                        ))}

                        {(fileEntries.some((f) => f.status === "pending") || isUploading) && (
                          <button
                            onClick={handleFilesUpload}
                            disabled={isUploading}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            {isUploading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Uploading {uploadProgress.done + 1}/{uploadProgress.total}…
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4" />
                                Upload {fileEntries.filter((f) => f.status === "pending").length} File(s)
                              </>
                            )}
                          </button>
                        )}
                        {fileEntries.filter((f) => f.status === "error").length >= 2 && !isUploading && (
                          <button
                            onClick={retryAllFailed}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/40 text-emerald-600 text-sm font-semibold hover:bg-emerald-500/10 transition-colors"
                          >
                            <RefreshCw className="w-4 h-4" />
                            Retry all failed ({fileEntries.filter((f) => f.status === "error").length})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Inputs list ── */}
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : inputs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-xl text-muted-foreground">
                <FileText className="w-6 h-6 mb-2 opacity-40" />
                <p className="text-sm">No inputs yet. Add one above.</p>
              </div>
            ) : (
              <>
                {/* ── Search + filters ── */}
                <div className="space-y-2.5">
                  {/* Search box */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by title or content…"
                      className="w-full pl-9 pr-9 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filter chips */}
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status filter */}
                    <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs shrink-0">
                      {(["all", "pending", "processed"] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatusFilter(s)}
                          className={cn(
                            "px-3 py-1.5 font-medium transition-colors",
                            statusFilter === s
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                        >
                          {s === "all" ? "All" : s === "pending" ? "Pending" : "Processed"}
                        </button>
                      ))}
                    </div>

                    {/* Type filter chips */}
                    {availableTypes.map((type) => {
                      const Icon  = TYPE_ICON[type]  ?? FileText;
                      const color = TYPE_COLOUR[type] ?? "#64748b";
                      const active = typeFilter === type;
                      const count = typeCountMap[type] ?? 0;
                      const empty = count === 0;
                      return (
                        <button
                          key={type}
                          onClick={() => setTypeFilter(active ? null : type)}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium capitalize transition-colors",
                            active
                              ? "text-white border-transparent"
                              : empty
                              ? "border-border text-muted-foreground/40 opacity-50 cursor-default"
                              : "border-border text-muted-foreground hover:bg-muted",
                          )}
                          style={active ? { background: color } : {}}
                          disabled={empty && !active}
                        >
                          <Icon className="w-3 h-3" style={{ color: active ? "white" : color }} />
                          {type}
                          <span
                            className={cn(
                              "ml-0.5 px-1 py-0 rounded text-[10px] font-semibold leading-4",
                              active
                                ? "bg-white/25 text-white"
                                : empty
                                ? "bg-muted text-muted-foreground/50"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}

                    {/* Clear all */}
                    {hasActiveFilter && (
                      <button
                        onClick={() => {
                          setSearchQuery("");
                          setTypeFilter(null);
                          setStatusFilter("all");
                          setSearchParams((prev) => {
                            const next = new URLSearchParams(prev);
                            next.delete("inputId");
                            return next;
                          }, { replace: true });
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors ml-1"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                </div>

                {/* Deep-link banner */}
                {highlightInputId && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-sm text-primary">
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1">Showing source input from Roadmap</span>
                    <button
                      onClick={() => setSearchParams((prev) => {
                        const next = new URLSearchParams(prev);
                        next.delete("inputId");
                        return next;
                      }, { replace: true })}
                      className="text-primary hover:text-primary/70 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Count header */}
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                    {hasActiveFilter
                      ? <>{filteredInputs.length} of {inputs.length} Input{inputs.length !== 1 ? "s" : ""}</>
                      : <>{inputs.length} Input{inputs.length !== 1 ? "s" : ""}</>
                    }
                    {!hasActiveFilter && unprocessedCount > 0 && (
                      <span className="ml-2 text-amber-500">· {unprocessedCount} pending</span>
                    )}
                  </h2>
                </div>

                {filteredInputs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-xl text-muted-foreground">
                    <Search className="w-6 h-6 mb-2 opacity-40" />
                    <p className="text-sm">No inputs match your filters.</p>
                    <button
                      onClick={() => { setSearchQuery(""); setTypeFilter(null); setStatusFilter("all"); }}
                      className="mt-1.5 text-xs text-primary hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredInputs.map((input) => {
                    const Icon  = TYPE_ICON[input.type]  ?? FileText;
                    const color = TYPE_COLOUR[input.type] ?? "#64748b";
                    const isHighlighted = highlightInputId === input.id;
                    const isSelected = selectedInputId === input.id;
                    return (
                      <div
                        key={input.id}
                        data-testid={`input-card-${input.id}`}
                        onClick={() => setSelectedInputId(isSelected ? null : input.id)}
                        className={cn(
                          "bg-card border rounded-xl p-4 flex flex-col hover:border-muted-foreground/40 transition-colors group cursor-pointer",
                          isHighlighted || isSelected
                            ? "border-primary ring-2 ring-primary/20"
                            : "border-border",
                        )}
                        style={{ borderLeft: `3px solid ${isHighlighted || isSelected ? "hsl(var(--primary))" : color}` }}
                      >
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md" style={{ background: `${color}18` }}>
                              <Icon className="w-3.5 h-3.5" style={{ color }} strokeWidth={2} />
                            </div>
                            <span className="text-[10px] font-mono font-semibold uppercase tracking-widest text-muted-foreground">
                              {input.type}
                            </span>
                          </div>

                          <span className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm",
                            input.processed
                              ? "bg-green-500/10 text-green-400"
                              : "bg-amber-500/10 text-amber-400"
                          )}>
                            {input.processed
                              ? <><CheckCircle2 className="w-2.5 h-2.5" /> Done</>
                              : "Pending"}
                          </span>
                        </div>

                        {/* Title */}
                        <h3 className="text-sm font-semibold text-foreground mb-1.5 leading-snug line-clamp-2">
                          {input.title}
                        </h3>

                        {/* Summary / excerpt */}
                        {(() => {
                          if (input.summary) {
                            return (
                              <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">
                                {input.summary}
                              </p>
                            );
                          }
                          if (input.type === "youtube" && input.content) {
                            const { description, transcript } = splitYouTubeContent(input.content);
                            if (description || transcript) {
                              return (
                                <div className="flex flex-col gap-1.5 flex-1 min-h-0">
                                  {description && (
                                    <div>
                                      <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/60">Description</span>
                                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">{description}</p>
                                    </div>
                                  )}
                                  {transcript && (
                                    <div>
                                      <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/60">Transcript</span>
                                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mt-0.5">{transcript}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return (
                              <div className="flex flex-col gap-1 flex-1 min-h-0">
                                <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/60">Content</span>
                                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{input.content}</p>
                              </div>
                            );
                          }
                          return (
                            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 flex-1">
                              {input.content}
                            </p>
                          );
                        })()}

                        {/* Footer */}
                        <div
                          className="mt-4 pt-3 border-t border-border flex items-center justify-between"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {format(new Date(input.createdAt), "MMM d, yyyy")}
                          </span>

                          <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(input.id); }}
                              disabled={deleteInput.isPending}
                              data-testid={`button-delete-${input.id}`}
                              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            {!input.processed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleProcess(input.id); }}
                                disabled={processInput.isPending || bulkProcessing}
                                data-testid={`button-process-${input.id}`}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                              >
                                {processInput.isPending ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Cpu className="w-3 h-3" />
                                )}
                                Process
                              </button>
                            )}

                            {input.processed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleReprocess(input.id); }}
                                disabled={reprocessingId === input.id}
                                data-testid={`button-reprocess-${input.id}`}
                                title="Re-process: delete existing nodes/edges and regenerate"
                                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted text-muted-foreground text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                              >
                                {reprocessingId === input.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                                Re-process
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedInput && (
        <InputDetailPanel
          input={selectedInput}
          onClose={() => setSelectedInputId(null)}
          onProcess={async (id) => { await handleProcess(id); }}
          onReprocess={async (id) => { await handleReprocess(id); }}
          isProcessing={processInput.isPending}
          isReprocessing={reprocessingId === selectedInput.id}
        />
      )}
    </AppLayout>
  );
}
