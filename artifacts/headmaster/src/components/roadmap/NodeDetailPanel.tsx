import React, { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useGetInput, useListActions } from "@workspace/api-client-react";
import type { Node, Edge, NodeType, Action, ActionStatus, NodeSource } from "@workspace/api-client-react";
import { X, FileText, Link, Youtube, Image, File, Circle, Clock, CheckCircle2, ExternalLink, Volume2, Square } from "lucide-react";
import { format } from "date-fns";
import { useSpeech } from "@/hooks/useSpeech";

const TYPE_CONFIG: Record<NodeType, { label: string; color: string; bg: string }> = {
  domain:  { label: "Domain",  color: "#4F46E5", bg: "#EEF2FF" },
  concept: { label: "Concept", color: "#1D4ED8", bg: "#EFF6FF" },
  goal:    { label: "Goal",    color: "#1D4ED8", bg: "#EFF6FF" },
  insight: { label: "Insight", color: "#d97706", bg: "#FFFBEB" },
  action:  { label: "Action",  color: "#059669", bg: "#ECFDF5" },
};

const INPUT_TYPE_ICON: Record<string, React.ElementType> = {
  text:      FileText,
  url:       Link,
  note:      FileText,
  file:      File,
  youtube:   Youtube,
  instagram: Link,
  pinterest: Link,
  image:     Image,
};

const ACTION_STATUS_CONFIG: Record<ActionStatus, { label: string; icon: React.ElementType; color: string }> = {
  pending:     { label: "Pending",     icon: Circle,        color: "#94a3b8" },
  in_progress: { label: "In Progress", icon: Clock,         color: "#d97706" },
  done:        { label: "Done",        icon: CheckCircle2,  color: "#059669" },
};

interface NodeDetailPanelProps {
  node: Node;
  onClose: () => void;
  allNodes: Node[];
  edges: Edge[];
  onSelectNode: (node: Node) => void;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize:      10,
        fontWeight:    700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color:         "#94a3b8",
        fontFamily:    "monospace",
        marginBottom:  8,
      }}
    >
      {children}
    </div>
  );
}

function splitYouTubeContent(content: string): { description: string | null; transcript: string | null } {
  const idx = content.indexOf("\n\n");
  if (idx === -1) return { description: null, transcript: null };
  const description = content.slice(0, idx).trim() || null;
  const transcript  = content.slice(idx + 2).trim() || null;
  return { description, transcript };
}

const EXCERPT_LEN = 160;
function truncate(text: string, len: number): string {
  const t = text.trim();
  return t.length > len ? t.slice(0, len) + "…" : t;
}

/* ── Multi-source section ─────────────────────────────────────────── */

function SourcesSection({
  sources,
  fallbackInputId,
}: {
  sources?: NodeSource[] | null;
  fallbackInputId?: string | null;
}) {
  const list = sources ?? [];

  if (list.length > 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((s) => (
          <SourceInputRow key={s.inputId} inputId={s.inputId} />
        ))}
      </div>
    );
  }

  /* Backward compat: node pre-dates junction table */
  if (fallbackInputId) {
    return <SourceInputRow inputId={fallbackInputId} />;
  }

  return <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>No source inputs recorded.</p>;
}

function SourceInputRow({ inputId }: { inputId: string }) {
  const { data: input, isLoading } = useGetInput(inputId);
  const [, navigate] = useLocation();
  const Icon = input ? (INPUT_TYPE_ICON[input.type] ?? FileText) : FileText;

  if (isLoading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "12px 14px",
          background: "#f8fafc",
          borderRadius: 8,
          border: "1.5px solid #e2e8f0",
        }}
      >
        <div style={{ width: 120, height: 12, background: "#e2e8f0", borderRadius: 4 }} />
        <div style={{ width: "100%", height: 10, background: "#e2e8f0", borderRadius: 4 }} />
        <div style={{ width: "70%", height: 10, background: "#e2e8f0", borderRadius: 4 }} />
      </div>
    );
  }

  if (!input) return null;

  const safeInput = input;

  function handleViewInput() {
    navigate(`/inputs?inputId=${encodeURIComponent(safeInput.id)}`);
  }

  const isYouTube = input.type === "youtube";
  const ytSplit   = isYouTube && input.content ? splitYouTubeContent(input.content) : null;
  const hasSplit  = ytSplit && (ytSplit.description || ytSplit.transcript);

  const plainExcerpt = !hasSplit && !isYouTube && input.content
    ? truncate(input.content, EXCERPT_LEN)
    : null;

  const LABEL_STYLE: React.CSSProperties = {
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color:         "#94a3b8",
    fontFamily:    "monospace",
    marginBottom:  3,
  };

  return (
    <div
      style={{
        display:      "flex",
        flexDirection: "column",
        gap:          0,
        background:   "#f8fafc",
        borderRadius: 8,
        border:       "1.5px solid #e2e8f0",
        overflow:     "hidden",
      }}
    >
      {/* Title row */}
      <div
        style={{
          display:    "flex",
          alignItems: "center",
          gap:        10,
          padding:    "10px 14px",
        }}
      >
        <Icon style={{ width: 14, height: 14, color: "#64748b", flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {input.title}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "monospace" }}>
            {input.type}
          </div>
        </div>
      </div>

      {/* Content: split description + transcript for YouTube, or plain excerpt otherwise */}
      {hasSplit ? (
        <div
          style={{
            display:       "flex",
            flexDirection: "column",
            gap:           10,
            padding:       "10px 14px",
            borderTop:     "1px solid #e2e8f0",
          }}
        >
          {ytSplit!.description && (
            <div>
              <div style={LABEL_STYLE}>Description</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>
                {truncate(ytSplit!.description, EXCERPT_LEN)}
              </div>
            </div>
          )}
          {ytSplit!.transcript && (
            <div>
              <div style={LABEL_STYLE}>Transcript</div>
              <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>
                {truncate(ytSplit!.transcript, EXCERPT_LEN)}
              </div>
            </div>
          )}
        </div>
      ) : isYouTube && input.content ? (
        <div
          style={{
            display:       "flex",
            flexDirection: "column",
            gap:           4,
            padding:       "10px 14px",
            borderTop:     "1px solid #e2e8f0",
          }}
        >
          <div style={LABEL_STYLE}>Content</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>
            {truncate(input.content, EXCERPT_LEN)}
          </div>
        </div>
      ) : plainExcerpt ? (
        <div
          style={{
            padding:    "10px 14px",
            fontSize:   12,
            lineHeight: 1.6,
            color:      "#64748b",
            borderTop:  "1px solid #e2e8f0",
          }}
        >
          {plainExcerpt}
        </div>
      ) : null}

      {/* View full input link */}
      <button
        onClick={handleViewInput}
        style={{
          display:         "flex",
          alignItems:      "center",
          gap:             6,
          padding:         "8px 14px",
          background:      "transparent",
          border:          "none",
          borderTop:       "1px solid #e2e8f0",
          cursor:          "pointer",
          color:           "#3b82f6",
          fontSize:        12,
          fontWeight:      500,
          textAlign:       "left",
          transition:      "background 0.15s",
          width:           "100%",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        <ExternalLink style={{ width: 12, height: 12, flexShrink: 0 }} />
        View full input
      </button>
    </div>
  );
}

function RelatedActionsSection({ nodeId }: { nodeId: string }) {
  const { data: allActions = [], isLoading } = useListActions();
  const related = allActions.filter((a: Action) => a.nodeId === nodeId);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[1, 2].map((i) => (
          <div
            key={i}
            style={{
              height: 44,
              background: "#f8fafc",
              borderRadius: 8,
              border: "1.5px solid #e2e8f0",
            }}
          />
        ))}
      </div>
    );
  }

  if (related.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
        No actions linked to this node.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {related.map((action: Action) => {
        const statusCfg = ACTION_STATUS_CONFIG[action.status] ?? ACTION_STATUS_CONFIG.pending;
        const StatusIcon = statusCfg.icon;
        return (
          <div
            key={action.id}
            style={{
              display:      "flex",
              alignItems:   "flex-start",
              gap:          10,
              padding:      "10px 14px",
              background:   "#f8fafc",
              borderRadius: 8,
              border:       "1.5px solid #e2e8f0",
            }}
          >
            <StatusIcon
              style={{ width: 14, height: 14, color: statusCfg.color, flexShrink: 0, marginTop: 2 }}
            />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", lineHeight: 1.4 }}>
                {action.title}
              </div>
              {action.description && (
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 3, lineHeight: 1.5 }}>
                  {action.description}
                </div>
              )}
              <div
                style={{
                  marginTop:     4,
                  fontSize:      10,
                  fontWeight:    700,
                  color:         statusCfg.color,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontFamily:    "monospace",
                }}
              >
                {statusCfg.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnectedNodesSection({
  node,
  allNodes,
  edges,
  onSelectNode,
}: {
  node: Node;
  allNodes: Node[];
  edges: Edge[];
  onSelectNode: (node: Node) => void;
}) {
  const connectedIds = new Set<string>();
  edges.forEach((e) => {
    if (e.sourceId === node.id) connectedIds.add(e.targetId);
    if (e.targetId === node.id) connectedIds.add(e.sourceId);
  });

  const connected = allNodes.filter((n) => n.id !== node.id && connectedIds.has(n.id));

  if (connected.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
        No connected nodes.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {connected.map((n) => {
        const cfg = TYPE_CONFIG[n.type] ?? TYPE_CONFIG.concept;
        return (
          <button
            key={n.id}
            onClick={() => onSelectNode(n)}
            style={{
              display:     "flex",
              alignItems:  "center",
              gap:         10,
              padding:     "10px 14px",
              background:  "#f8fafc",
              borderRadius: 8,
              border:      "1.5px solid #e2e8f0",
              cursor:      "pointer",
              textAlign:   "left",
              width:       "100%",
              transition:  "background 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#cbd5e1";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0";
            }}
          >
            <span
              style={{
                display:       "inline-flex",
                alignItems:    "center",
                flexShrink:    0,
                padding:       "2px 8px",
                borderRadius:  4,
                background:    cfg.bg,
                color:         cfg.color,
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily:    "monospace",
              }}
            >
              {cfg.label}
            </span>
            <span style={{ fontSize: 13, fontWeight: 500, color: "#1e293b", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {n.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function NodeDetailPanel({ node, onClose, allNodes, edges, onSelectNode }: NodeDetailPanelProps) {
  const cfg = TYPE_CONFIG[node.type] ?? TYPE_CONFIG.concept;
  const panelRef = useRef<HTMLDivElement>(null);
  const { isSupported: speechSupported, isSpeaking, speak, stop } = useSpeech();

  /* Stop speech whenever the node changes or panel unmounts */
  useEffect(() => { return () => { stop(); }; }, [node.id, stop]);

  function handleListen() {
    if (isSpeaking) { stop(); return; }
    const parts: string[] = [node.label];
    if (node.description) parts.push(node.description);
    speak([{ id: node.id, text: parts.join(". ") }]);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  return (
    <>

      {/* Side panel */}
      <div
        ref={panelRef}
        style={{
          position:      "fixed",
          top:           0,
          right:         0,
          bottom:        0,
          width:         380,
          zIndex:        50,
          background:    "#ffffff",
          borderLeft:    "1.5px solid #e2e8f0",
          display:       "flex",
          flexDirection: "column",
          boxShadow:     "-8px 0 32px rgba(0,0,0,0.08)",
          fontFamily:    "Inter, system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            display:        "flex",
            alignItems:     "flex-start",
            justifyContent: "space-between",
            gap:            12,
            padding:        "24px 24px 20px",
            borderBottom:   "1px solid #f1f5f9",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            {/* Type badge */}
            <div
              style={{
                display:       "inline-flex",
                alignItems:    "center",
                gap:           6,
                alignSelf:     "flex-start",
                padding:       "3px 10px",
                borderRadius:  4,
                background:    cfg.bg,
                color:         cfg.color,
                fontSize:      10,
                fontWeight:    700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontFamily:    "monospace",
              }}
            >
              {cfg.label}
            </div>

            {/* Label */}
            <h2
              style={{
                margin:        0,
                fontSize:      20,
                fontWeight:    700,
                color:         "#0f172a",
                lineHeight:    1.3,
                letterSpacing: "-0.02em",
              }}
            >
              {node.label}
            </h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, marginTop: 2 }}>
            {speechSupported && (
              <button
                onClick={handleListen}
                aria-label={isSpeaking ? "Stop reading" : "Read aloud"}
                title={isSpeaking ? "Stop reading" : "Read aloud"}
                style={{
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  width:          30,
                  height:         30,
                  borderRadius:   6,
                  border:         "none",
                  background:     isSpeaking ? "#EFF6FF" : "transparent",
                  color:          isSpeaking ? "#1D4ED8" : "#94a3b8",
                  cursor:         "pointer",
                  transition:     "background 0.15s, color 0.15s",
                  animation:      isSpeaking ? "roadmapSpeakPulse 1.4s ease-in-out infinite" : undefined,
                }}
                onMouseEnter={(e) => {
                  if (!isSpeaking) {
                    (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
                    (e.currentTarget as HTMLButtonElement).style.color = "#1e293b";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSpeaking) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
                  }
                }}
              >
                {isSpeaking
                  ? <Square style={{ width: 14, height: 14 }} />
                  : <Volume2 style={{ width: 16, height: 16 }} />
                }
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close panel"
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
        </div>

        {/* Body */}
        <div
          style={{
            flex:          1,
            overflowY:     "auto",
            padding:       "20px 24px",
            display:       "flex",
            flexDirection: "column",
            gap:           24,
          }}
        >
          {/* Description */}
          <div>
            <SectionLabel>Description</SectionLabel>
            <p
              style={{
                margin:     0,
                fontSize:   14,
                lineHeight: 1.7,
                color:      node.description ? "#374151" : "#94a3b8",
              }}
            >
              {node.description || "No description available for this node."}
            </p>
          </div>

          {/* Sources — shows all contributing inputs */}
          <div>
            <SectionLabel>
              Sources{node.sources && node.sources.length > 0
                ? ` (${node.sources.length})`
                : node.sourceCount
                  ? ` (${node.sourceCount})`
                  : ""}
            </SectionLabel>
            <SourcesSection sources={node.sources} fallbackInputId={node.inputId} />
          </div>

          {/* Connected nodes */}
          <div>
            <SectionLabel>Connected Nodes</SectionLabel>
            <ConnectedNodesSection
              node={node}
              allNodes={allNodes}
              edges={edges}
              onSelectNode={onSelectNode}
            />
          </div>

          {/* Related actions */}
          <div>
            <SectionLabel>Related Actions</SectionLabel>
            <RelatedActionsSection nodeId={node.id} />
          </div>

          {/* Meta */}
          <div
            style={{
              marginTop:     "auto",
              paddingTop:    16,
              borderTop:     "1px solid #f1f5f9",
              display:       "flex",
              flexDirection: "column",
              gap:           6,
            }}
          >
            <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
              Added {format(new Date(node.createdAt), "MMM d, yyyy")}
            </div>
            {node.updatedAt && node.updatedAt !== node.createdAt && (
              <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace" }}>
                Updated {format(new Date(node.updatedAt), "MMM d, yyyy")}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
