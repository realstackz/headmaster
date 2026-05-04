import React, { useEffect } from "react";
import { Node, NodeType } from "@workspace/api-client-react";
import { X, Target, Zap, Lightbulb, Box, ArrowRight, Layers, Volume2, Square } from "lucide-react";
import { format } from "date-fns";
import { useSpeech } from "@/hooks/useSpeech";

interface NodePanelProps {
  node: Node;
  connectedNodes: Node[];
  onClose: () => void;
  onNodeClick: (id: string) => void;
}

const TYPE_CONFIG: Record<NodeType, { icon: React.ElementType; cssVar: string; label: string }> = {
  domain:  { icon: Layers,    cssVar: "--node-domain",   label: "Domain"  },
  concept: { icon: Box,       cssVar: "--node-concept",  label: "Concept" },
  insight: { icon: Lightbulb, cssVar: "--node-insight",  label: "Insight" },
  action:  { icon: Zap,       cssVar: "--node-action",   label: "Action"  },
  goal:    { icon: Target,    cssVar: "--node-goal",     label: "Goal"    },
};

export function NodePanel({ node, connectedNodes, onClose, onNodeClick }: NodePanelProps) {
  const config = TYPE_CONFIG[node.type] ?? TYPE_CONFIG.concept;
  const Icon = config.icon;
  const color = `hsl(var(${config.cssVar}))`;

  const { isSupported: speechSupported, isSpeaking, speak, stop } = useSpeech();

  /* Stop speech when node changes or panel unmounts */
  useEffect(() => { return () => { stop(); }; }, [node.id, stop]);

  function handleListen() {
    if (isSpeaking) { stop(); return; }
    const parts: string[] = [node.label];
    if (node.description) parts.push(node.description);
    speak([{ id: node.id, text: parts.join(". ") }]);
  }

  return (
    <div className="flex h-full w-full">
      {/* Main details */}
      <div className="flex-1 flex flex-col px-6 py-4 gap-3 overflow-y-auto border-r border-border min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5 min-w-0">
            {/* Type badge */}
            <div
              className="inline-flex items-center gap-1.5 self-start px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-widest font-mono"
              style={{ backgroundColor: `${color}18`, color }}
            >
              <Icon className="w-3 h-3" strokeWidth={2.5} />
              {config.label}
            </div>
            <h2 className="text-xl font-semibold tracking-tight leading-snug text-foreground truncate">
              {node.label}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            {speechSupported && (
              <button
                onClick={handleListen}
                aria-label={isSpeaking ? "Stop reading" : "Read aloud"}
                title={isSpeaking ? "Stop reading" : "Read aloud"}
                className={`p-1.5 rounded-md transition-colors ${
                  isSpeaking
                    ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                style={isSpeaking ? { animation: "roadmapSpeakPulse 1.4s ease-in-out infinite" } : undefined}
              >
                {isSpeaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">
          {node.description || "No description provided."}
        </p>

        <div className="mt-auto pt-2 flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
          <span>Added {format(new Date(node.createdAt), "MMM d, yyyy")}</span>
          {(node.sourceCount ?? 0) > 1 ? (
            <>
              <span className="text-border">·</span>
              <span
                style={{
                  color:         "#7c3aed",
                  background:    "#f5f3ff",
                  border:        "1px solid #ddd6fe",
                  borderRadius:  4,
                  padding:       "1px 6px",
                  fontWeight:    600,
                  letterSpacing: "0.04em",
                }}
              >
                ⟳ {node.sourceCount} sources merged
              </span>
            </>
          ) : node.inputId ? (
            <>
              <span className="text-border">·</span>
              <span>From source input</span>
            </>
          ) : null}
        </div>
      </div>

      {/* Connections */}
      <div className="w-72 shrink-0 flex flex-col px-4 py-4 gap-3 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-mono">
          Connections ({connectedNodes.length})
        </p>

        <div className="flex flex-col gap-1.5">
          {connectedNodes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No connections yet.</p>
          ) : (
            connectedNodes.map((cn) => {
              const cnConfig = TYPE_CONFIG[cn.type] ?? TYPE_CONFIG.concept;
              const CnIcon = cnConfig.icon;
              const cnColor = `hsl(var(${cnConfig.cssVar}))`;
              return (
                <button
                  key={cn.id}
                  onClick={() => onNodeClick(cn.id)}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-background border border-border hover:border-muted-foreground/40 hover:bg-accent/40 transition-colors text-left group"
                >
                  <CnIcon className="w-3.5 h-3.5 shrink-0" style={{ color: cnColor }} strokeWidth={2.5} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate leading-snug">{cn.label}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: cnColor }}>
                      {cnConfig.label}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
