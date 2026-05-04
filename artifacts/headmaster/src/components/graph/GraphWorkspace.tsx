import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node as RFNode,
  Edge as RFEdge,
  ConnectionMode,
  MarkerType,
  Position,
  useReactFlow,
  ReactFlowProvider,
  NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";

import {
  useGetGraphData,
  useUpdateNode,
  NodeType,
  type Node as ApiNode,
  type Edge as ApiEdge,
} from "@workspace/api-client-react";

import { nodeTypes as rawNodeTypes } from "./CustomNodes";
import { NodePanel } from "./NodePanel";
import { getLayoutedElements, NODE_W, NODE_H } from "@/lib/layout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, LayoutGrid, Search, X } from "lucide-react";

const RF_NODE_TYPES = rawNodeTypes as unknown as NodeTypes;

const DOMAIN_GROUP_PREFIX = "__domain-group-";
const DOMAIN_PALETTE = ["#4F46E5", "#0891B2", "#059669", "#D97706", "#7C3AED", "#DC2626"];

/* ── Edge colour per source type ──────────────────────────────────── */
const TYPE_EDGE_COLOUR: Record<NodeType, string> = {
  domain:  "#6366F1",
  concept: "#2563EB",
  insight: "#D97706",
  action:  "#16A34A",
  goal:    "#7C3AED",
};

function buildEdge(
  id:         string,
  source:     string,
  target:     string,
  sourceType: NodeType,
  label?:     string | null
): RFEdge {
  const color = TYPE_EDGE_COLOUR[sourceType] ?? "#94a3b8";
  return {
    id,
    source,
    target,
    type:  "smoothstep",
    label: label ?? undefined,
    labelStyle: {
      fill:       "#64748b",
      fontSize:   10,
      fontWeight: 500,
      fontFamily: "Inter, sans-serif",
    },
    labelBgStyle:   { fill: "#f8fafc", fillOpacity: 0.9, rx: 4 },
    labelBgPadding: [3, 7] as [number, number],
    markerEnd: {
      type:   MarkerType.ArrowClosed,
      width:  14,
      height: 14,
      color,
    },
    style: {
      stroke:      color,
      strokeWidth: 1.8,
      opacity:     0.7,
    },
  };
}

/* ── Compute domain group background nodes ────────────────────────── */
function computeDomainGroups(
  layoutedNodes: RFNode[],
  apiNodes:      ApiNode[],
  apiEdges:      ApiEdge[]
): RFNode[] {
  const domainApiNodes = apiNodes.filter((n) => n.type === "domain");
  if (domainApiNodes.length === 0) return [];

  const posMap = new Map<string, { x: number; y: number }>();
  layoutedNodes.forEach((n) => posMap.set(n.id, n.position));

  const domainIds  = new Set(domainApiNodes.map((n) => n.id));
  const primaryIds = new Set(
    apiNodes.filter((n) => n.type === "concept" || n.type === "goal").map((n) => n.id)
  );

  /* domain → direct concept/goal children */
  const domainToChildren = new Map<string, Set<string>>();
  domainApiNodes.forEach((d) => domainToChildren.set(d.id, new Set()));
  apiEdges.forEach((e) => {
    if (domainToChildren.has(e.sourceId) && primaryIds.has(e.targetId)) {
      domainToChildren.get(e.sourceId)!.add(e.targetId);
    }
  });

  /* concept/goal → secondary (insight/action) children */
  const primaryToSecs = new Map<string, Set<string>>();
  primaryIds.forEach((id) => primaryToSecs.set(id, new Set()));
  apiEdges.forEach((e) => {
    if (primaryIds.has(e.sourceId) && !primaryIds.has(e.targetId) && !domainIds.has(e.targetId)) {
      primaryToSecs.get(e.sourceId)?.add(e.targetId);
    }
  });

  const PADDING = 44;
  const groupNodes: RFNode[] = [];

  domainApiNodes.forEach((d, idx) => {
    const childPrimaryIds = domainToChildren.get(d.id) ?? new Set<string>();
    if (childPrimaryIds.size === 0) return;

    const allChildIds = new Set<string>();
    childPrimaryIds.forEach((cId) => {
      allChildIds.add(cId);
      primaryToSecs.get(cId)?.forEach((sId) => allChildIds.add(sId));
    });

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    allChildIds.forEach((id) => {
      const pos = posMap.get(id);
      if (!pos) return;
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + NODE_W);
      maxY = Math.max(maxY, pos.y + NODE_H);
    });

    if (!isFinite(minX)) return;

    const color = DOMAIN_PALETTE[idx % DOMAIN_PALETTE.length];

    groupNodes.push({
      id:         `${DOMAIN_GROUP_PREFIX}${d.id}`,
      type:       "domainGroup",
      position:   { x: minX - PADDING, y: minY - PADDING - 18 },
      style:      { width: maxX - minX + PADDING * 2, height: maxY - minY + PADDING * 2 + 18 },
      data:       { label: d.label, color, childCount: childPrimaryIds.size },
      zIndex:     -1,
      selectable: false,
      draggable:  false,
    } as RFNode);
  });

  return groupNodes;
}

/* ═══════════════════════════════════════════════════════════════════ */

function GraphInner() {
  const { data: graphData, isLoading } = useGetGraphData();
  const updateNode  = useUpdateNode();
  const { toast }   = useToast();
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const initialized = useRef(false);

  /* ── Derived: dim/disable non-matching nodes during search ───── */
  const displayNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nodes;

    // Build node→domain mapping from graphData edges
    // Domain group ID convention: `__domain-group-${domainId}`
    const apiNodes = graphData?.nodes ?? [];
    const apiEdges = graphData?.edges ?? [];

    const domainIds  = new Set(apiNodes.filter((n) => n.type === "domain").map((n) => n.id));
    const primaryIds = new Set(apiNodes.filter((n) => n.type === "concept" || n.type === "goal").map((n) => n.id));

    // Map each primary → its domain
    const primaryToDomain = new Map<string, string>();
    apiEdges.forEach((e) => {
      if (domainIds.has(e.sourceId) && primaryIds.has(e.targetId)) {
        primaryToDomain.set(e.targetId, e.sourceId);
      }
    });

    // Map each secondary → its domain (via its primary)
    const secondaryToDomain = new Map<string, string>();
    apiEdges.forEach((e) => {
      if (primaryIds.has(e.sourceId) && !domainIds.has(e.targetId)) {
        const domainId = primaryToDomain.get(e.sourceId);
        if (domainId) secondaryToDomain.set(e.targetId, domainId);
      }
    });

    const nodeToGroupId = (nodeId: string): string | undefined => {
      const domainId = primaryToDomain.get(nodeId) ?? secondaryToDomain.get(nodeId);
      return domainId ? `${DOMAIN_GROUP_PREFIX}${domainId}` : undefined;
    };

    // First pass: find which regular node IDs match
    const matchingIds = new Set<string>();
    nodes.forEach((n) => {
      if (n.id.startsWith(DOMAIN_GROUP_PREFIX)) return;
      const label = ((n.data as { label?: string })?.label ?? "").toLowerCase();
      const desc  = ((n.data as { description?: string })?.description ?? "").toLowerCase();
      if (label.includes(q) || desc.includes(q)) matchingIds.add(n.id);
    });

    // Second pass: find which domain group panels have ≥1 matching child
    const groupsWithMatches = new Set<string>();
    matchingIds.forEach((nodeId) => {
      const groupId = nodeToGroupId(nodeId);
      if (groupId) groupsWithMatches.add(groupId);
    });

    return nodes.map((n) => {
      if (n.id.startsWith(DOMAIN_GROUP_PREFIX)) {
        const hasMatch = groupsWithMatches.has(n.id);
        return {
          ...n,
          style:       { ...n.style, opacity: hasMatch ? 0.6 : 0 },
          selectable:  false,
          draggable:   false,
          focusable:   false,
          connectable: false,
        };
      }
      const matches = matchingIds.has(n.id);
      return {
        ...n,
        style:     { ...n.style, opacity: matches ? 1 : 0.08 },
        selectable: matches,
      };
    });
  }, [nodes, searchQuery, graphData]);

  /* ── Initial load: restore saved positions or auto-layout ────── */
  useEffect(() => {
    if (!graphData || initialized.current) return;
    initialized.current = true;

    const typeById: Record<string, NodeType> = {};
    graphData.nodes.forEach((n) => { typeById[n.id] = n.type; });

    const rawNodes: RFNode[] = graphData.nodes.map((n) => ({
      id:       n.id,
      type:     n.type,
      position: { x: n.positionX, y: n.positionY },
      data:     { label: n.label, type: n.type, description: n.description, level: n.level },
    }));

    const rawEdges: RFEdge[] = graphData.edges.map((e) =>
      buildEdge(e.id, e.sourceId, e.targetId, typeById[e.sourceId] ?? "concept", e.label)
    );

    // Three-way branch based on which nodes have stored positions:
    //
    // allPositioned  → every node has a saved position; skip dagre entirely,
    //                  restore directly from DB (with LR handle directions).
    // allDefault     → every node is at (0,0), first-ever load or all-new;
    //                  run full dagre layout.
    // mixed          → some nodes positioned, some not (new nodes added since
    //                  last visit); run full dagre so the graph stays coherent
    //                  and new nodes land in sensible positions.
    const unpositionedCount = graphData.nodes.filter(
      (n) => n.positionX === 0 && n.positionY === 0
    ).length;

    let ln: RFNode[];
    let le: RFEdge[];

    if (unpositionedCount === 0) {
      // All nodes have saved positions — restore from DB, skip dagre
      ln = rawNodes.map((n) => ({
        ...n,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }));
      le = rawEdges;
    } else {
      // Some or all nodes are unpositioned — run full dagre layout
      ({ nodes: ln, edges: le } = getLayoutedElements(rawNodes, rawEdges));
    }

    const groupNodes = computeDomainGroups(ln, graphData.nodes, graphData.edges);

    setNodes([...groupNodes, ...ln]);
    setEdges(le);
    setTimeout(() => fitView({ padding: 0.12, duration: 500 }), 80);
  }, [graphData, setNodes, setEdges, fitView]);

  /* ── Auto layout button ──────────────────────────────────────── */
  const handleAutoLayout = useCallback(() => {
    const regularNodes = nodes.filter((n) => !n.id.startsWith(DOMAIN_GROUP_PREFIX));
    const { nodes: ln, edges: le } = getLayoutedElements(regularNodes, edges);
    const groupNodes = graphData
      ? computeDomainGroups(ln, graphData.nodes, graphData.edges)
      : [];
    setNodes([...groupNodes, ...ln]);
    setEdges(le);
    setTimeout(() => fitView({ padding: 0.12, duration: 400 }), 50);
    // Persist the new dagre positions to the DB so they survive a refresh
    ln.forEach((n) => {
      updateNode.mutate(
        { id: n.id, data: { positionX: n.position.x, positionY: n.position.y } },
        { onError: () => toast({ title: "Could not save layout", variant: "destructive" }) }
      );
    });
  }, [nodes, edges, setNodes, setEdges, fitView, graphData, updateNode, toast]);

  /* ── Persist drag positions ──────────────────────────────────── */
  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: RFNode) => {
      if (node.id.startsWith(DOMAIN_GROUP_PREFIX)) return;
      updateNode.mutate(
        { id: node.id, data: { positionX: node.position.x, positionY: node.position.y } },
        { onError: () => toast({ title: "Could not save position", variant: "destructive" }) }
      );
    },
    [updateNode, toast]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, n: RFNode) => {
    if (n.id.startsWith(DOMAIN_GROUP_PREFIX)) return;
    setSelectedNodeId(n.id);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNodeId(null), []);

  const selectedNode = useMemo(
    () => {
      if (!selectedNodeId || selectedNodeId.startsWith(DOMAIN_GROUP_PREFIX) || !graphData) return null;
      return graphData.nodes.find((n) => n.id === selectedNodeId) ?? null;
    },
    [selectedNodeId, graphData]
  );

  const connectedNodes = useMemo(() => {
    if (!selectedNodeId || !graphData) return [];
    const ids = new Set(
      graphData.edges
        .filter((e) => e.sourceId === selectedNodeId || e.targetId === selectedNodeId)
        .map((e) => (e.sourceId === selectedNodeId ? e.targetId : e.sourceId))
    );
    return graphData.nodes.filter((n) => ids.has(n.id));
  }, [selectedNodeId, graphData]);

  /* ── Loading ─────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <div
        className="flex-1 flex items-center justify-center h-full"
        style={{ background: "#f8fafc" }}
      >
        <div className="flex flex-col items-center gap-3" style={{ color: "#94a3b8" }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          <p style={{ fontFamily: "Inter, sans-serif", fontSize: 13 }}>Loading knowledge graph…</p>
        </div>
      </div>
    );
  }

  const hasDomains = (graphData?.nodes ?? []).some((n) => n.type === "domain");
  const panelVisible = !!selectedNodeId && !selectedNodeId.startsWith(DOMAIN_GROUP_PREFIX);

  /* ── Render ──────────────────────────────────────────────────── */
  return (
    <div className="flex-1 relative h-full w-full overflow-hidden">
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={RF_NODE_TYPES}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: "#f8fafc" }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#cbd5e1"
          gap={32}
          size={1.5}
          style={{ backgroundColor: "#f8fafc" }}
        />

        <Controls
          showInteractive={false}
          style={{
            background:   "#ffffff",
            border:       "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow:    "0 1px 6px rgba(0,0,0,0.08)",
          }}
        />

        <MiniMap
          nodeColor={(n) => {
            const map: Record<string, string> = {
              domain:  "#4F46E5",
              concept: "#2563EB",
              insight: "#D97706",
              action:  "#16A34A",
              goal:    "#7C3AED",
            };
            return map[n.type as string] ?? "#94a3b8";
          }}
          nodeStrokeWidth={0}
          nodeBorderRadius={4}
          maskColor="rgba(248,250,252,0.85)"
          style={{
            background:   "#ffffff",
            border:       "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow:    "0 1px 6px rgba(0,0,0,0.08)",
          }}
        />
      </ReactFlow>

      {/* Auto Layout + Search bar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <button
          onClick={handleAutoLayout}
          style={{
            display:      "flex",
            alignItems:   "center",
            gap:          6,
            padding:      "7px 14px",
            background:   "#ffffff",
            border:       "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize:     12,
            fontWeight:   600,
            color:        "#475569",
            boxShadow:    "0 1px 6px rgba(0,0,0,0.08)",
            cursor:       "pointer",
            fontFamily:   "Inter, sans-serif",
            transition:   "background 0.15s",
            whiteSpace:   "nowrap",
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = "#f1f5f9")}
          onMouseOut={(e)  => (e.currentTarget.style.background = "#ffffff")}
        >
          <LayoutGrid style={{ width: 13, height: 13 }} />
          Auto Layout
        </button>

        {/* Search input */}
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search
            style={{
              position:  "absolute",
              left:      9,
              width:     13,
              height:    13,
              color:     "#94a3b8",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
            placeholder="Search nodes…"
            style={{
              height:       32,
              paddingLeft:  28,
              paddingRight: searchQuery ? 28 : 10,
              width:        180,
              background:   "#ffffff",
              border:       `1px solid ${searchQuery ? "#6366f1" : "#e2e8f0"}`,
              borderRadius: 8,
              fontSize:     12,
              color:        "#1e293b",
              outline:      "none",
              boxShadow:    "0 1px 6px rgba(0,0,0,0.08)",
              fontFamily:   "Inter, sans-serif",
              transition:   "border-color 0.15s, width 0.2s",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              style={{
                position:   "absolute",
                right:      6,
                background: "none",
                border:     "none",
                cursor:     "pointer",
                padding:    2,
                display:    "flex",
                color:      "#94a3b8",
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>

        {/* Search result count */}
        {searchQuery.trim() && (() => {
          const count = displayNodes.filter(n => !n.id.startsWith(DOMAIN_GROUP_PREFIX) && (n.style?.opacity ?? 1) === 1).length;
          return (
            <span style={{
              fontSize:   11,
              color:      "#64748b",
              background: "#ffffff",
              border:     "1px solid #e2e8f0",
              borderRadius: 6,
              padding:    "4px 8px",
              boxShadow:  "0 1px 6px rgba(0,0,0,0.08)",
              fontFamily: "Inter, sans-serif",
              whiteSpace: "nowrap",
            }}>
              {count} match{count !== 1 ? "es" : ""}
            </span>
          );
        })()}
      </div>

      {/* Node type legend — top right */}
      <div
        className="absolute top-4 right-4 z-20"
        style={{
          background:    "#ffffff",
          border:        "1px solid #e2e8f0",
          borderRadius:  8,
          boxShadow:     "0 1px 6px rgba(0,0,0,0.08)",
          padding:       "10px 14px",
          display:       "flex",
          flexDirection: "column",
          gap:           6,
        }}
      >
        {(
          hasDomains
            ? (["domain", "concept", "insight", "action", "goal"] as NodeType[])
            : (["concept", "insight", "action", "goal"] as NodeType[])
        ).map((t) => {
          const colours: Record<string, string> = {
            domain:  "#4F46E5",
            concept: "#2563EB",
            insight: "#D97706",
            action:  "#16A34A",
            goal:    "#7C3AED",
          };
          const labels: Record<string, string> = {
            domain:  "Domain",
            concept: "Concept",
            insight: "Insight",
            action:  "Action",
            goal:    "Goal",
          };
          return (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <div
                style={{
                  width:        10,
                  height:       10,
                  borderRadius: t === "domain" ? 2 : 3,
                  background:   colours[t],
                  flexShrink:   0,
                }}
              />
              <span style={{ fontSize: 11, color: "#64748b", fontFamily: "Inter, sans-serif", fontWeight: 500 }}>
                {labels[t]}
              </span>
            </div>
          );
        })}
      </div>

      {/* Node detail panel */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 border-t transition-transform duration-250 ease-out z-10",
          panelVisible ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          height:     260,
          background: "#ffffff",
          borderTop:  "1px solid #e2e8f0",
        }}
      >
        {selectedNode && (
          <NodePanel
            node={selectedNode}
            connectedNodes={connectedNodes}
            onClose={() => setSelectedNodeId(null)}
            onNodeClick={(id) => setSelectedNodeId(id)}
          />
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */

export function GraphWorkspace() {
  return (
    <ReactFlowProvider>
      <GraphInner />
    </ReactFlowProvider>
  );
}
