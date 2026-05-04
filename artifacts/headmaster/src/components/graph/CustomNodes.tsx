import React, { memo } from "react";
import { Handle, Position, NodeProps } from "reactflow";
import { NodeType } from "@workspace/api-client-react";
import { Box, Lightbulb, Zap, Target, Layers } from "lucide-react";

export interface KnowledgeNodeData {
  label:        string;
  type:         NodeType;
  description?: string | null;
  level?:       string | null;
}

type TypeCfg = {
  bg:     string;
  border: string;
  accent: string;
  ring:   string;
  Icon:   React.ElementType;
  badge:  string;
};

const TYPES: Record<NodeType, TypeCfg> = {
  domain:  { bg: "#EEF2FF", border: "#C7D2FE", accent: "#4F46E5", ring: "#4F46E528", Icon: Layers,    badge: "Domain"  },
  concept: { bg: "#EFF6FF", border: "#BFDBFE", accent: "#2563EB", ring: "#2563EB28", Icon: Box,       badge: "Concept" },
  insight: { bg: "#FFFBEB", border: "#FDE68A", accent: "#D97706", ring: "#D9770628", Icon: Lightbulb, badge: "Insight" },
  action:  { bg: "#F0FDF4", border: "#BBF7D0", accent: "#16A34A", ring: "#16A34A28", Icon: Zap,       badge: "Action"  },
  goal:    { bg: "#FAF5FF", border: "#E9D5FF", accent: "#7C3AED", ring: "#7C3AED28", Icon: Target,    badge: "Goal"    },
};

const LEVEL_CFG: Record<string, { bg: string; color: string; label: string }> = {
  beginner:     { bg: "#DCFCE7", color: "#15803D", label: "Beginner"     },
  intermediate: { bg: "#FEF3C7", color: "#B45309", label: "Intermediate" },
  advanced:     { bg: "#F3E8FF", color: "#7C3AED", label: "Advanced"     },
};

export const KnowledgeNode = memo(({ data, selected }: NodeProps<KnowledgeNodeData>) => {
  const cfg = TYPES[data.type] ?? TYPES.concept;
  const Icon = cfg.Icon;
  const showLevel = (data.type === "concept" || data.type === "goal") && data.level;
  const levelCfg  = data.level ? LEVEL_CFG[data.level] : null;

  const shadow = selected
    ? `inset 4px 0 0 ${cfg.accent}, 0 0 0 3px ${cfg.ring}, 0 6px 20px rgba(0,0,0,0.13)`
    : `inset 4px 0 0 ${cfg.accent}, 0 2px 10px rgba(0,0,0,0.07)`;

  return (
    <div
      style={{
        background:   cfg.bg,
        border:       selected ? `2px solid ${cfg.accent}` : `1.5px solid ${cfg.border}`,
        borderRadius: 10,
        minWidth:     170,
        maxWidth:     230,
        boxShadow:    shadow,
        cursor:       "grab",
        transition:   "box-shadow 0.15s ease, border-color 0.15s ease",
        fontFamily:   "Inter, system-ui, sans-serif",
      }}
      className="active:cursor-grabbing"
    >
      <Handle type="target" position={Position.Left}   style={{ opacity: 0, width: 10, height: 10, left:   -5 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0, width: 10, height: 10, right:  -5 }} />
      <Handle type="target" position={Position.Top}    style={{ opacity: 0, width: 10, height: 10, top:    -5 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 10, height: 10, bottom: -5 }} />

      <div style={{ padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div
            style={{
              marginTop:      2,
              width:          26,
              height:         26,
              borderRadius:   6,
              background:     `${cfg.accent}18`,
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              flexShrink:     0,
            }}
          >
            <Icon style={{ width: 13, height: 13, color: cfg.accent }} strokeWidth={2.2} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize:   13.5,
                fontWeight: 600,
                color:      "#0f172a",
                lineHeight: 1.35,
                margin:     0,
                wordBreak:  "break-word",
              }}
            >
              {data.label}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize:      10,
                  fontWeight:    600,
                  color:         cfg.accent,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  fontFamily:    "ui-monospace, monospace",
                }}
              >
                {cfg.badge}
              </span>
              {showLevel && levelCfg && (
                <span
                  style={{
                    fontSize:      9,
                    fontWeight:    700,
                    color:         levelCfg.color,
                    background:    levelCfg.bg,
                    borderRadius:  4,
                    padding:       "1px 5px",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    fontFamily:    "ui-monospace, monospace",
                  }}
                >
                  {levelCfg.label}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

KnowledgeNode.displayName = "KnowledgeNode";

/* ── Domain group background panel ─────────────────────────────── */
export interface DomainGroupData {
  label:      string;
  color:      string;
  childCount: number;
}

export const DomainGroupNode = memo(({ data }: NodeProps<DomainGroupData>) => {
  return (
    <div
      style={{
        width:         "100%",
        height:        "100%",
        background:    `${data.color}07`,
        border:        `1.5px solid ${data.color}30`,
        borderRadius:  14,
        boxSizing:     "border-box",
        pointerEvents: "none",
        userSelect:    "none",
        position:      "relative",
      }}
    >
      <div
        style={{
          position:      "absolute",
          top:           8,
          left:          12,
          display:       "flex",
          alignItems:    "center",
          gap:           8,
          background:    `${data.color}14`,
          borderRadius:  6,
          padding:       "3px 10px 3px 8px",
        }}
      >
        <Layers style={{ width: 10, height: 10, color: data.color, opacity: 0.8 }} strokeWidth={2.5} />
        <span
          style={{
            fontSize:      9.5,
            fontWeight:    700,
            color:         data.color,
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            fontFamily:    "ui-monospace, monospace",
          }}
        >
          {data.label}
        </span>
        <span
          style={{
            fontSize:   9,
            color:      `${data.color}90`,
            fontFamily: "ui-monospace, monospace",
            fontWeight: 500,
          }}
        >
          {data.childCount} {data.childCount === 1 ? "concept" : "concepts"}
        </span>
      </div>
    </div>
  );
});

DomainGroupNode.displayName = "DomainGroupNode";

export const nodeTypes = {
  domain:      KnowledgeNode,
  concept:     KnowledgeNode,
  insight:     KnowledgeNode,
  action:      KnowledgeNode,
  goal:        KnowledgeNode,
  domainGroup: DomainGroupNode,
};
