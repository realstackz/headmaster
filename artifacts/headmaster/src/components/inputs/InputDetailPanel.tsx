import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  X, Youtube, Globe, StickyNote, FileText, FolderOpen, Image,
  Video, Music, Pin, CheckCircle2, Cpu, RefreshCw, Loader2, Copy, Check,
} from "lucide-react";
import { format } from "date-fns";

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
};

function splitYouTubeContent(content: string): { description: string | null; transcript: string | null } {
  const idx = content.indexOf("\n\n");
  if (idx === -1) return { description: null, transcript: null };
  const description = content.slice(0, idx).trim() || null;
  const transcript  = content.slice(idx + 2).trim() || null;
  return { description, transcript };
}

interface Input {
  id: string;
  title: string;
  type: string;
  content: string;
  summary?: string | null;
  processed: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface InputDetailPanelProps {
  input: Input;
  onClose: () => void;
  onProcess?: (id: string) => void;
  onReprocess?: (id: string) => void;
  isProcessing?: boolean;
  isReprocessing?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    });
  }, [text]);

  const label = copied ? "Copied!" : failed ? "Copy failed" : "Copy to clipboard";

  return (
    <button
      onClick={handleCopy}
      title={label}
      aria-label={label}
      style={{
        display:        "inline-flex",
        alignItems:     "center",
        gap:            4,
        padding:        "2px 7px",
        borderRadius:   4,
        border:         `1px solid ${copied ? "#bbf7d0" : failed ? "#fecaca" : "#e2e8f0"}`,
        background:     copied ? "#f0fdf4" : failed ? "#fef2f2" : "#f8fafc",
        color:          copied ? "#16a34a" : failed ? "#dc2626" : "#94a3b8",
        fontSize:       10,
        fontWeight:     600,
        fontFamily:     "monospace",
        letterSpacing:  "0.04em",
        cursor:         "pointer",
        transition:     "background 0.15s, color 0.15s, border-color 0.15s",
        flexShrink:     0,
      }}
      onMouseEnter={(e) => {
        if (!copied && !failed) {
          (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff";
          (e.currentTarget as HTMLButtonElement).style.color = "#2563eb";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#bfdbfe";
        }
      }}
      onMouseLeave={(e) => {
        if (!copied && !failed) {
          (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
          (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0";
        }
      }}
    >
      {copied
        ? <><Check style={{ width: 9, height: 9 }} />Copied!</>
        : failed
          ? <><X style={{ width: 9, height: 9 }} />Copy failed</>
          : <><Copy style={{ width: 9, height: 9 }} />Copy</>
      }
    </button>
  );
}

function SectionLabel({ children, copyText }: { children: React.ReactNode; copyText?: string }) {
  return (
    <div style={{
      display:        "flex",
      alignItems:     "center",
      justifyContent: "space-between",
      marginBottom:   8,
    }}>
      <div style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: "0.08em",
        textTransform: "uppercase" as const,
        color:         "#94a3b8",
        fontFamily:    "monospace",
      }}>
        {children}
      </div>
      {copyText && <CopyButton text={copyText} />}
    </div>
  );
}

export function InputDetailPanel({
  input,
  onClose,
  onProcess,
  onReprocess,
  isProcessing,
  isReprocessing,
}: InputDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const Icon  = TYPE_ICON[input.type]  ?? FileText;
  const color = TYPE_COLOUR[input.type] ?? "#64748b";

  const isYouTube = input.type === "youtube";
  const ytSplit   = isYouTube && input.content ? splitYouTubeContent(input.content) : null;
  const hasYtSplit = ytSplit && (ytSplit.description || ytSplit.transcript);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 49,
          background: "rgba(0,0,0,0.15)",
        }}
      />

      {/* Side panel */}
      <div
        ref={panelRef}
        style={{
          position:      "fixed",
          top:           0,
          right:         0,
          bottom:        0,
          width:         480,
          zIndex:        50,
          background:    "#ffffff",
          borderLeft:    "1.5px solid #e2e8f0",
          display:       "flex",
          flexDirection: "column",
          boxShadow:     "-8px 0 32px rgba(0,0,0,0.10)",
          fontFamily:    "Inter, system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{
          display:        "flex",
          alignItems:     "flex-start",
          justifyContent: "space-between",
          gap:            12,
          padding:        "20px 24px 16px",
          borderBottom:   "1px solid #f1f5f9",
          flexShrink:     0,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, flex: 1 }}>
            {/* Type badge */}
            <div style={{
              display:       "inline-flex",
              alignItems:    "center",
              gap:           6,
              alignSelf:     "flex-start",
              padding:       "3px 10px",
              borderRadius:  4,
              background:    `${color}18`,
              color,
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: "0.08em",
              textTransform: "uppercase" as const,
              fontFamily:    "monospace",
            }}>
              <Icon style={{ width: 11, height: 11 }} />
              {input.type}
            </div>

            {/* Title */}
            <h2 style={{
              margin:        0,
              fontSize:      18,
              fontWeight:    700,
              color:         "#0f172a",
              lineHeight:    1.3,
              letterSpacing: "-0.01em",
              wordBreak:     "break-word",
            }}>
              {input.title}
            </h2>
          </div>

          <button
            onClick={onClose}
            aria-label="Close input detail panel"
            data-testid="input-detail-panel-close"
            style={{
              flexShrink:     0,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              width:          30,
              height:         30,
              borderRadius:   6,
              border:         "none",
              background:     "transparent",
              color:          "#94a3b8",
              cursor:         "pointer",
              marginTop:      2,
              transition:     "background 0.15s, color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
              (e.currentTarget as HTMLButtonElement).style.color = "#1e293b";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
            }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex:          1,
          overflowY:     "auto",
          padding:       "20px 24px",
          display:       "flex",
          flexDirection: "column",
          gap:           24,
        }}>
          {/* Summary (if processed) */}
          {input.summary && (
            <div>
              <SectionLabel copyText={input.summary ?? undefined}>Summary</SectionLabel>
              <p style={{
                margin:     0,
                fontSize:   14,
                lineHeight: 1.7,
                color:      "#374151",
              }}>
                {input.summary}
              </p>
            </div>
          )}

          {/* YouTube: Description + Transcript */}
          {isYouTube && hasYtSplit ? (
            <>
              {ytSplit!.description && (
                <div>
                  <SectionLabel copyText={ytSplit!.description}>Description</SectionLabel>
                  <div style={{
                    background:   "#f8fafc",
                    borderRadius: 8,
                    border:       "1.5px solid #e2e8f0",
                    padding:      "14px 16px",
                    maxHeight:    280,
                    overflowY:    "auto",
                  }}>
                    <p style={{
                      margin:     0,
                      fontSize:   13,
                      lineHeight: 1.75,
                      color:      "#374151",
                      whiteSpace: "pre-wrap",
                      wordBreak:  "break-word",
                    }}>
                      {ytSplit!.description}
                    </p>
                  </div>
                </div>
              )}
              {ytSplit!.transcript && (
                <div>
                  <SectionLabel copyText={ytSplit!.transcript}>Transcript</SectionLabel>
                  <div style={{
                    background:   "#f8fafc",
                    borderRadius: 8,
                    border:       "1.5px solid #e2e8f0",
                    padding:      "14px 16px",
                    maxHeight:    400,
                    overflowY:    "auto",
                  }}>
                    <p style={{
                      margin:     0,
                      fontSize:   13,
                      lineHeight: 1.75,
                      color:      "#374151",
                      whiteSpace: "pre-wrap",
                      wordBreak:  "break-word",
                    }}>
                      {ytSplit!.transcript}
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : isYouTube && input.content ? (
            <div>
              <SectionLabel copyText={input.content}>Content</SectionLabel>
              <div style={{
                background:   "#f8fafc",
                borderRadius: 8,
                border:       "1.5px solid #e2e8f0",
                padding:      "14px 16px",
                maxHeight:    500,
                overflowY:    "auto",
              }}>
                <p style={{
                  margin:     0,
                  fontSize:   13,
                  lineHeight: 1.75,
                  color:      "#374151",
                  whiteSpace: "pre-wrap",
                  wordBreak:  "break-word",
                }}>
                  {input.content}
                </p>
              </div>
            </div>
          ) : !isYouTube && input.content ? (
            <div>
              <SectionLabel copyText={input.content}>Content</SectionLabel>
              <div style={{
                background:   "#f8fafc",
                borderRadius: 8,
                border:       "1.5px solid #e2e8f0",
                padding:      "14px 16px",
                maxHeight:    500,
                overflowY:    "auto",
              }}>
                <p style={{
                  margin:     0,
                  fontSize:   13,
                  lineHeight: 1.75,
                  color:      "#374151",
                  whiteSpace: "pre-wrap",
                  wordBreak:  "break-word",
                }}>
                  {input.content}
                </p>
              </div>
            </div>
          ) : null}

          {/* Meta + actions at the bottom */}
          <div style={{
            marginTop:     "auto",
            paddingTop:    16,
            borderTop:     "1px solid #f1f5f9",
            display:       "flex",
            flexDirection: "column",
            gap:           12,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
                  Added {format(new Date(input.createdAt), "MMM d, yyyy")}
                </div>
                <div style={{
                  display:       "inline-flex",
                  alignItems:    "center",
                  gap:           4,
                  fontSize:      10,
                  fontWeight:    700,
                  fontFamily:    "monospace",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase" as const,
                  color:         input.processed ? "#22c55e" : "#f59e0b",
                }}>
                  {input.processed ? (
                    <><CheckCircle2 style={{ width: 11, height: 11 }} /> Processed</>
                  ) : (
                    "Pending"
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {!input.processed && onProcess && (
                  <button
                    onClick={() => onProcess(input.id)}
                    disabled={isProcessing}
                    style={{
                      display:     "flex",
                      alignItems:  "center",
                      gap:         6,
                      padding:     "7px 14px",
                      borderRadius: 7,
                      border:      "none",
                      background:  "#2563eb",
                      color:       "#ffffff",
                      fontSize:    12,
                      fontWeight:  600,
                      cursor:      isProcessing ? "not-allowed" : "pointer",
                      opacity:     isProcessing ? 0.6 : 1,
                      transition:  "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!isProcessing) (e.currentTarget as HTMLButtonElement).style.background = "#1d4ed8"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#2563eb"; }}
                  >
                    {isProcessing
                      ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                      : <Cpu style={{ width: 13, height: 13 }} />
                    }
                    Process
                  </button>
                )}
                {input.processed && onReprocess && (
                  <button
                    onClick={() => onReprocess(input.id)}
                    disabled={isReprocessing}
                    style={{
                      display:     "flex",
                      alignItems:  "center",
                      gap:         6,
                      padding:     "7px 14px",
                      borderRadius: 7,
                      border:      "1.5px solid #e2e8f0",
                      background:  "#f8fafc",
                      color:       "#64748b",
                      fontSize:    12,
                      fontWeight:  600,
                      cursor:      isReprocessing ? "not-allowed" : "pointer",
                      opacity:     isReprocessing ? 0.6 : 1,
                      transition:  "background 0.15s, color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isReprocessing) {
                        (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff";
                        (e.currentTarget as HTMLButtonElement).style.color = "#2563eb";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
                      (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
                    }}
                    title="Re-process: delete existing nodes and regenerate"
                  >
                    {isReprocessing
                      ? <Loader2 style={{ width: 13, height: 13 }} className="animate-spin" />
                      : <RefreshCw style={{ width: 13, height: 13 }} />
                    }
                    Re-process
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
