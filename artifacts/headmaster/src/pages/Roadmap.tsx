import React, { useMemo, useRef, useCallback, useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetGraphData } from "@workspace/api-client-react";
import type { Node, Edge, NodeType } from "@workspace/api-client-react";
import { Loader2, RefreshCw, ChevronRight, ArrowLeft, Layers, Search, X, Volume2, Square } from "lucide-react";
import { NodeDetailPanel } from "@/components/roadmap/NodeDetailPanel";
import { useLocation } from "wouter";
import { useSpeech } from "@/hooks/useSpeech";

const ROADMAP_STYLES = `
  @keyframes roadmapPulseBlue {
    0%   { box-shadow: 0 0 0 0 rgba(29,78,216,0.55), 0 1px 3px rgba(0,0,0,0.06); }
    70%  { box-shadow: 0 0 0 10px rgba(29,78,216,0), 0 1px 3px rgba(0,0,0,0.06); }
    100% { box-shadow: 0 0 0 0 rgba(29,78,216,0), 0 1px 3px rgba(0,0,0,0.06); }
  }
  @keyframes roadmapPulseAmber {
    0%   { box-shadow: 0 0 0 0 rgba(180,83,9,0.5), 0 2px 6px rgba(0,0,0,0.12); }
    70%  { box-shadow: 0 0 0 10px rgba(180,83,9,0), 0 2px 6px rgba(0,0,0,0.12); }
    100% { box-shadow: 0 0 0 0 rgba(180,83,9,0), 0 2px 6px rgba(0,0,0,0.12); }
  }
  @keyframes roadmapSpeakPulse {
    0%   { opacity: 1; }
    50%  { opacity: 0.55; }
    100% { opacity: 1; }
  }
`;

const PRIMARY_TYPES = new Set<NodeType>(["concept", "goal"]);

const DOMAIN_PALETTE = ["#4F46E5", "#0891B2", "#059669", "#D97706", "#7C3AED", "#DC2626"];

/* ── Level ordering ────────────────────────────────────────────── */
const LEVEL_ORDER: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

const LEVEL_CFG: Record<string, { color: string; bg: string; border: string; label: string }> = {
  beginner:     { color: "#15803D", bg: "#DCFCE7", border: "#86EFAC", label: "Beginner"     },
  intermediate: { color: "#B45309", bg: "#FEF3C7", border: "#FCD34D", label: "Intermediate" },
  advanced:     { color: "#7C3AED", bg: "#F3E8FF", border: "#D8B4FE", label: "Advanced"     },
};

/* ── Topological sort + stable level sort ──────────────────────── */
function sortPrimary(nodes: Node[], edges: Edge[], primaryIds: Set<string>): Node[] {
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  nodes.forEach((n) => { adj[n.id] = []; inDeg[n.id] = 0; });
  edges.forEach((e) => {
    if (primaryIds.has(e.sourceId) && primaryIds.has(e.targetId)) {
      adj[e.sourceId].push(e.targetId);
      inDeg[e.targetId]++;
    }
  });

  const queue = nodes.filter((n) => inDeg[n.id] === 0).map((n) => n.id);
  const topoSorted: Node[] = [];
  const visited = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node) topoSorted.push(node);
    adj[id].forEach((nid) => {
      inDeg[nid]--;
      if (inDeg[nid] === 0 && !visited.has(nid)) queue.push(nid);
    });
  }

  nodes.forEach((n) => { if (!visited.has(n.id)) topoSorted.push(n); });

  /* Stable-sort by level: beginner → intermediate → advanced → unset */
  return [...topoSorted].sort((a, b) => {
    const la = LEVEL_ORDER[a.level ?? ""] ?? 3;
    const lb = LEVEL_ORDER[b.level ?? ""] ?? 3;
    return la - lb;
  });
}

/* ── Type badge colours ────────────────────────────────────────────── */
const TYPE_COLOUR: Record<NodeType, string> = {
  domain:  "#4F46E5",
  concept: "#1D4ED8",
  goal:    "#1D4ED8",
  insight: "#d97706",
  action:  "#059669",
};

const TYPE_LABEL: Record<NodeType, string> = {
  domain:  "Domain",
  concept: "Concept",
  goal:    "Goal",
  insight: "Insight",
  action:  "Action",
};

/* ── Relative time ─────────────────────────────────────────────────── */
function formatLastUpdated(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ── Exact dashed line (6px dash / 4px gap) ───────────────────────── */
const DASH_STYLE: React.CSSProperties = {
  width:              72,
  flexShrink:         0,
  height:             2,
  backgroundImage:    "repeating-linear-gradient(to right, #1D4ED8 0px, #1D4ED8 6px, transparent 6px, transparent 10px)",
  backgroundSize:     "10px 2px",
  backgroundRepeat:   "repeat-x",
  backgroundPosition: "0 center",
};

/* ═══════════════════════════════════════════════════════════════════ */
export default function Roadmap() {
  const { data: graphData, isLoading, refetch } = useGetGraphData();
  const [, navigate] = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeRefs  = useRef<Map<string, HTMLDivElement>>(new Map());
  const [layoutKey, setLayoutKey] = useState(0);
  const [isRefetching, setIsRefetching] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [justSelectedId, setJustSelectedId] = useState<string | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Domain drill-down state ────────────────────────────────────── */
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [showFlatView, setShowFlatView] = useState(false);

  /* ── Search state ───────────────────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");

  /* ── Speech state ───────────────────────────────────────────────── */
  const { isSupported: speechSupported, isSpeaking, speak, stop: stopSpeech } = useSpeech();
  const [speakingNodeId, setSpeakingNodeId] = useState<string | null>(null);

  /* Stop narration whenever the view changes */
  useEffect(() => {
    stopSpeech();
    setSpeakingNodeId(null);
  }, [selectedDomainId, showFlatView, stopSpeech]);

  const selectNode = useCallback((node: Node | null) => {
    setSelectedNode(node);
    if (node && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      setJustSelectedId(node.id);
      pulseTimerRef.current = setTimeout(() => setJustSelectedId(null), 700);
    }
  }, []);

  useEffect(() => {
    return () => { if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current); };
  }, []);

  useEffect(() => {
    if (!selectedNode) return;
    const el = nodeRefs.current.get(selectedNode.id);
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedNode]);

  /* Reset domain selection if domain disappears from data */
  useEffect(() => {
    if (!graphData || !selectedDomainId) return;
    const exists = graphData.nodes.some((n) => n.id === selectedDomainId && n.type === "domain");
    if (!exists) setSelectedDomainId(null);
  }, [graphData, selectedDomainId]);

  const handleRegenerate = useCallback(async () => {
    setIsRefetching(true);
    try {
      await refetch();
    } finally {
      setIsRefetching(false);
    }
    setLayoutKey((k) => k + 1);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [refetch]);

  const selectedNodeRef = useRef<Node | null>(null);
  selectedNodeRef.current = selectedNode;

  const handleNodeClick = useCallback((node: Node) => {
    if (selectedNodeRef.current?.id === node.id) {
      setSelectedNode(null);
    } else {
      selectNode(node);
    }
  }, [selectNode]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
  }, []);

  /* ── Computed data ──────────────────────────────────────────────── */
  const computed = useMemo(() => {
    if (!graphData) {
      return {
        domainNodes:         [] as Node[],
        domainToConceptIds:  {} as Record<string, string[]>,
        conceptToDomainId:   {} as Record<string, string>,
        sortedPrimary:       [] as Node[],
        groups:              {} as Record<string, Node[]>,
        crossDomainBadges:   {} as Record<string, string[]>,
        lastUpdated:         null as Date | null,
        edgeCount:           {} as Record<string, number>,
        hasDomains:          false,
        domainLevelSpread:   {} as Record<string, { beginner: number; intermediate: number; advanced: number }>,
      };
    }

    const nodes = graphData.nodes;
    const edges = graphData.edges;

    /* Connected ids (orphan suppression) */
    const connectedIds = new Set<string>();
    edges.forEach((e) => { connectedIds.add(e.sourceId); connectedIds.add(e.targetId); });

    /* Domain nodes */
    const domainNodes = nodes.filter((n) => n.type === "domain" && connectedIds.has(n.id));
    const domainIdSet = new Set(domainNodes.map((n) => n.id));

    /* Primary nodes (concept / goal) */
    const primaries  = nodes.filter((n) => PRIMARY_TYPES.has(n.type) && connectedIds.has(n.id));
    const primaryIds = new Set(primaries.map((n) => n.id));

    /* Secondary nodes (insight / action) */
    const secs = nodes.filter((n) => !PRIMARY_TYPES.has(n.type) && !domainIdSet.has(n.id) && connectedIds.has(n.id));

    /* Domain → concept/goal IDs */
    const domainToConceptIds: Record<string, string[]> = {};
    domainNodes.forEach((d) => { domainToConceptIds[d.id] = []; });
    edges.forEach((e) => {
      if (domainToConceptIds[e.sourceId] !== undefined && primaryIds.has(e.targetId)) {
        domainToConceptIds[e.sourceId].push(e.targetId);
      }
    });

    /* Concept → domain id (for cross-domain detection) */
    const conceptToDomainId: Record<string, string> = {};
    domainNodes.forEach((d) => {
      (domainToConceptIds[d.id] ?? []).forEach((cId) => {
        if (!conceptToDomainId[cId]) conceptToDomainId[cId] = d.id;
      });
    });

    /* Topological sort of all primaries */
    const sorted = sortPrimary(primaries, edges, primaryIds);

    /* Map each secondary to its first primary parent */
    const parentOf: Record<string, string> = {};
    edges.forEach((e) => {
      if (primaryIds.has(e.sourceId) && !primaryIds.has(e.targetId) && !domainIdSet.has(e.targetId)) {
        if (!parentOf[e.targetId]) parentOf[e.targetId] = e.sourceId;
      }
    });

    const grps: Record<string, Node[]> = {};
    sorted.forEach((n) => { grps[n.id] = []; });
    secs.forEach((s) => {
      const pid = parentOf[s.id];
      if (pid && grps[pid]) grps[pid].push(s);
    });

    /* Cross-domain badges for secondary nodes */
    const crossDomainBadges: Record<string, string[]> = {};
    secs.forEach((sec) => {
      const parentPrimId = parentOf[sec.id];
      if (!parentPrimId) return;
      const parentDomainId = conceptToDomainId[parentPrimId];

      edges.forEach((e) => {
        let otherPrimId: string | null = null;
        if (e.sourceId === sec.id && primaryIds.has(e.targetId)) otherPrimId = e.targetId;
        if (e.targetId === sec.id && primaryIds.has(e.sourceId)) otherPrimId = e.sourceId;
        if (!otherPrimId) return;

        const otherDomainId = conceptToDomainId[otherPrimId];
        if (!otherDomainId || otherDomainId === parentDomainId) return;

        const otherDomain = domainNodes.find((d) => d.id === otherDomainId);
        if (!otherDomain) return;

        if (!crossDomainBadges[sec.id]) crossDomainBadges[sec.id] = [];
        if (!crossDomainBadges[sec.id].includes(otherDomain.label)) {
          crossDomainBadges[sec.id].push(otherDomain.label);
        }
      });
    });

    /* Edge counts */
    const edgeCount: Record<string, number> = {};
    edges.forEach((e) => {
      edgeCount[e.sourceId] = (edgeCount[e.sourceId] ?? 0) + 1;
      edgeCount[e.targetId] = (edgeCount[e.targetId] ?? 0) + 1;
    });

    /* Latest updated date */
    const allDates  = nodes.map((n) => new Date(n.updatedAt ?? n.createdAt));
    const lastUpdated = allDates.length > 0
      ? new Date(Math.max(...allDates.map((d) => d.getTime())))
      : null;

    /* Level spread per domain: count beginner/intermediate/advanced concepts */
    const nodeById: Record<string, Node> = {};
    nodes.forEach((n) => { nodeById[n.id] = n; });
    const domainLevelSpread: Record<string, { beginner: number; intermediate: number; advanced: number }> = {};
    domainNodes.forEach((d) => {
      const conceptIds = domainToConceptIds[d.id] ?? [];
      const spread = { beginner: 0, intermediate: 0, advanced: 0 };
      conceptIds.forEach((cId) => {
        const cNode = nodeById[cId];
        if (cNode?.level && cNode.level in spread) {
          spread[cNode.level as keyof typeof spread]++;
        }
      });
      domainLevelSpread[d.id] = spread;
    });

    return {
      domainNodes,
      domainToConceptIds,
      conceptToDomainId,
      sortedPrimary: sorted,
      groups:        grps,
      crossDomainBadges,
      lastUpdated,
      edgeCount,
      hasDomains:    domainNodes.length > 0,
      domainLevelSpread,
    };
  }, [graphData, layoutKey]);

  const {
    domainNodes,
    domainToConceptIds,
    sortedPrimary,
    groups,
    crossDomainBadges,
    lastUpdated,
    edgeCount,
    hasDomains,
    domainLevelSpread,
  } = computed;

  /* ── Filtered primaries for domain drill-down ────────────────── */
  const { displayPrimary, displayGroups, selectedDomainNode } = useMemo(() => {
    if (!selectedDomainId) {
      return { displayPrimary: sortedPrimary, displayGroups: groups, selectedDomainNode: null };
    }
    const conceptIds = new Set(domainToConceptIds[selectedDomainId] ?? []);
    const filtered   = sortedPrimary.filter((p) => conceptIds.has(p.id));
    const filteredGroups: Record<string, Node[]> = {};
    filtered.forEach((p) => { filteredGroups[p.id] = groups[p.id] ?? []; });
    const domainNode = domainNodes.find((d) => d.id === selectedDomainId) ?? null;
    return {
      displayPrimary:     filtered,
      displayGroups:      filteredGroups,
      selectedDomainNode: domainNode,
    };
  }, [selectedDomainId, sortedPrimary, groups, domainToConceptIds, domainNodes]);

  /* ── Search filtering ───────────────────────────────────────── */
  const searchFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return {
        domainNodes:   domainNodes,
        displayPrimary: displayPrimary,
        displayGroups:  displayGroups,
        matchCount:     null as number | null,
        domainMatchIds: null as Set<string> | null,
      };
    }

    const matchesNode = (n: Node) =>
      (n.label ?? "").toLowerCase().includes(q) ||
      (n.description ?? "").toLowerCase().includes(q);

    // Domain match: domain itself matches OR any of its concepts/secondaries match
    const domainMatchIds = new Set<string>();
    domainNodes.forEach((domain) => {
      if (matchesNode(domain)) { domainMatchIds.add(domain.id); return; }
      const conceptIds = domainToConceptIds[domain.id] ?? [];
      const hasMatch = conceptIds.some((cId) => {
        const concept = graphData?.nodes.find((n) => n.id === cId);
        if (concept && matchesNode(concept)) return true;
        return (groups[cId] ?? []).some(matchesNode);
      });
      if (hasMatch) domainMatchIds.add(domain.id);
    });

    // Column view: filter primaries and secondaries
    const filteredPrimary = displayPrimary.filter((p) => {
      if (matchesNode(p)) return true;
      return (displayGroups[p.id] ?? []).some(matchesNode);
    });

    const filteredGroups: Record<string, Node[]> = {};
    filteredPrimary.forEach((p) => {
      const secs = displayGroups[p.id] ?? [];
      filteredGroups[p.id] = matchesNode(p) ? secs : secs.filter(matchesNode);
    });

    const matchCount = filteredPrimary.length + Object.values(filteredGroups).reduce((sum, s) => sum + s.length, 0);
    const matchingDomains = domainNodes.filter((d) => domainMatchIds.has(d.id));

    return {
      domainNodes:     matchingDomains,
      displayPrimary:  filteredPrimary,
      displayGroups:   filteredGroups,
      matchCount,
      domainMatchCount: matchingDomains.length,
      domainMatchIds,
    };
  }, [searchQuery, domainNodes, displayPrimary, displayGroups, domainToConceptIds, groups, graphData]);

  const {
    domainNodes:     searchDomainNodes,
    displayPrimary:  searchDisplayPrimary,
    displayGroups:   searchDisplayGroups,
    matchCount,
    domainMatchCount,
    domainMatchIds,
  } = searchFiltered;

  /* ── Listen handler (defined after searchDisplayPrimary) ────── */
  const handleListenDomain = useCallback(() => {
    if (isSpeaking) { stopSpeech(); setSpeakingNodeId(null); return; }
    const items: { id: string; text: string }[] = [];
    if (selectedDomainNode) {
      const intro = selectedDomainNode.description
        ? `${selectedDomainNode.label}. ${selectedDomainNode.description}`
        : selectedDomainNode.label;
      items.push({ id: `__domain__${selectedDomainNode.id}`, text: intro });
    }
    searchDisplayPrimary.forEach((p) => {
      const parts: string[] = [p.label];
      if (p.description) parts.push(p.description);
      items.push({ id: p.id, text: parts.join(". ") });
    });
    if (items.length === 0) return;
    speak(
      items,
      (id) => {
        setSpeakingNodeId(id.startsWith("__domain__") ? null : id);
        const el = nodeRefs.current.get(id);
        if (el && scrollRef.current) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      },
      () => setSpeakingNodeId(null),
    );
  }, [isSpeaking, stopSpeech, selectedDomainNode, searchDisplayPrimary, speak]);

  /* ── Decide which view to show ──────────────────────────────── */
  const showDomainGrid   = hasDomains && !selectedDomainId && !showFlatView;
  const showColumnLayout = !showDomainGrid;

  /* ── Loading ────────────────────────────────────────────────────── */
  if (isLoading) {
    return (
      <AppLayout>
        <div style={{ flex: 1, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader2 style={{ width: 20, height: 20, color: "#94a3b8", animation: "spin 1s linear infinite" }} />
        </div>
      </AppLayout>
    );
  }

  const total = graphData?.nodes.filter((n) => n.type !== "domain").length ?? 0;
  const conns = graphData?.edges.length ?? 0;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <AppLayout>
      <style>{ROADMAP_STYLES}</style>
      <div
        ref={scrollRef}
        style={{
          flex:         1,
          background:   "#ffffff",
          overflowY:    "auto",
          overflowX:    "auto",
          fontFamily:   "Inter, system-ui, sans-serif",
          transition:   "padding-right 0.2s ease",
          paddingRight: selectedNode ? 380 : 0,
        }}
      >
        <div style={{ minWidth: 600, padding: "52px 72px 80px" }}>

          {/* ── Header ────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 36 }}>
            <div>
              <h1 style={{ fontSize: 38, fontWeight: 800, color: "#0f172a", margin: 0, letterSpacing: "-0.03em" }}>
                Knowledge Roadmap
              </h1>
              <p style={{ fontSize: 14, color: "#64748b", margin: "6px 0 0" }}>
                {total} nodes · {conns} connections
                {lastUpdated && (
                  <span style={{ marginLeft: 12, color: "#94a3b8" }}>
                    · updated {formatLastUpdated(lastUpdated)}
                  </span>
                )}
              </p>
            </div>

            <button
              onClick={handleRegenerate}
              disabled={isRefetching}
              style={{
                display:      "flex",
                alignItems:   "center",
                gap:          6,
                padding:      "8px 16px",
                background:   "#f8fafc",
                border:       "1.5px solid #e2e8f0",
                borderRadius: 8,
                fontSize:     13,
                fontWeight:   600,
                color:        isRefetching ? "#94a3b8" : "#475569",
                cursor:       isRefetching ? "not-allowed" : "pointer",
                flexShrink:   0,
                marginTop:    4,
                transition:   "background 0.15s",
              }}
              onMouseEnter={(e) => { if (!isRefetching) (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
            >
              <RefreshCw
                style={{
                  width:     14,
                  height:    14,
                  animation: isRefetching ? "spin 1s linear infinite" : "none",
                }}
              />
              Regenerate Layout
            </button>
          </div>

          {/* ── Search bar ─────────────────────────────────────────── */}
          <div style={{ marginBottom: 28, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 400 }}>
              <Search
                style={{
                  position:      "absolute",
                  left:          12,
                  top:           "50%",
                  transform:     "translateY(-50%)",
                  width:         15,
                  height:        15,
                  color:         "#94a3b8",
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setSearchQuery(""); }}
                placeholder="Search nodes, concepts, insights…"
                style={{
                  width:        "100%",
                  height:       40,
                  paddingLeft:  36,
                  paddingRight: searchQuery ? 36 : 14,
                  background:   "#ffffff",
                  border:       `1.5px solid ${searchQuery ? "#6366f1" : "#e2e8f0"}`,
                  borderRadius: 10,
                  fontSize:     14,
                  color:        "#1e293b",
                  outline:      "none",
                  boxSizing:    "border-box",
                  boxShadow:    searchQuery ? "0 0 0 3px rgba(99,102,241,0.1)" : "0 1px 4px rgba(0,0,0,0.06)",
                  transition:   "border-color 0.15s, box-shadow 0.15s",
                  fontFamily:   "Inter, system-ui, sans-serif",
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    position:   "absolute",
                    right:      10,
                    top:        "50%",
                    transform:  "translateY(-50%)",
                    background: "none",
                    border:     "none",
                    cursor:     "pointer",
                    padding:    4,
                    display:    "flex",
                    color:      "#94a3b8",
                    borderRadius: 4,
                  }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <span style={{ fontSize: 13, color: "#64748b", whiteSpace: "nowrap", fontWeight: 500 }}>
                {showDomainGrid
                  ? `${domainMatchCount} domain${domainMatchCount !== 1 ? "s" : ""}`
                  : `${matchCount ?? 0} result${(matchCount ?? 0) !== 1 ? "s" : ""}`
                }
              </span>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════
              DOMAIN GRID VIEW
          ══════════════════════════════════════════════════════════ */}
          {showDomainGrid && (
            <div>
              {/* "View all (flat)" link */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 24 }}>
                <button
                  onClick={() => setShowFlatView(true)}
                  style={{
                    background:  "transparent",
                    border:      "none",
                    cursor:      "pointer",
                    fontSize:    13,
                    color:       "#64748b",
                    fontWeight:  500,
                    padding:     "4px 8px",
                    borderRadius: 6,
                    transition:  "color 0.15s, background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#1e293b";
                    (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  View all (flat) →
                </button>
              </div>

              {/* Domain card grid */}
              {searchDomainNodes.length === 0 && searchQuery.trim() && (
                <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                  No domains match your search
                </div>
              )}
              <div
                style={{
                  display:             "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap:                 20,
                }}
              >
                {searchDomainNodes.map((domain, idx) => {
                  const origIdx    = domainNodes.indexOf(domain);
                  const colorIdx   = origIdx >= 0 ? origIdx : idx;
                  const color      = DOMAIN_PALETTE[colorIdx % DOMAIN_PALETTE.length];
                  const conceptIds = domainToConceptIds[domain.id] ?? [];
                  const isActive   = !!searchQuery.trim();
                  return (
                    <button
                      key={domain.id}
                      onClick={() => setSelectedDomainId(domain.id)}
                      style={{
                        display:       "flex",
                        flexDirection: "column",
                        alignItems:    "flex-start",
                        gap:           0,
                        background:    "#ffffff",
                        border:        isActive ? `1.5px solid ${color}80` : `1.5px solid #e2e8f0`,
                        borderRadius:  12,
                        overflow:      "hidden",
                        cursor:        "pointer",
                        textAlign:     "left",
                        transition:    "box-shadow 0.15s, border-color 0.15s, transform 0.1s",
                        boxShadow:     isActive ? `0 2px 10px ${color}25` : "0 1px 4px rgba(0,0,0,0.06)",
                        padding:       0,
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.boxShadow    = "0 4px 16px rgba(0,0,0,0.10)";
                        el.style.borderColor  = color + "60";
                        el.style.transform    = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget as HTMLButtonElement;
                        el.style.boxShadow   = isActive ? `0 2px 10px ${color}25` : "0 1px 4px rgba(0,0,0,0.06)";
                        el.style.borderColor = isActive ? `${color}80` : "#e2e8f0";
                        el.style.transform   = "translateY(0)";
                      }}
                    >
                      {/* Color accent bar */}
                      <div style={{ width: "100%", height: 4, background: color, flexShrink: 0 }} />

                      <div style={{ padding: "18px 20px 20px", flex: 1, width: "100%", boxSizing: "border-box" }}>
                        {/* Icon + label */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                          <div
                            style={{
                              width:          32,
                              height:         32,
                              borderRadius:   8,
                              background:     `${color}15`,
                              display:        "flex",
                              alignItems:     "center",
                              justifyContent: "center",
                              flexShrink:     0,
                            }}
                          >
                            <Layers style={{ width: 15, height: 15, color }} strokeWidth={2.2} />
                          </div>
                          <span
                            style={{
                              fontSize:   16,
                              fontWeight: 700,
                              color:      "#0f172a",
                              lineHeight: 1.3,
                            }}
                          >
                            {domain.label}
                          </span>
                        </div>

                        {/* Description */}
                        {domain.description && (
                          <p
                            style={{
                              fontSize:    13,
                              color:       "#64748b",
                              lineHeight:  1.5,
                              margin:      "0 0 12px",
                              overflow:    "hidden",
                              display:     "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                            } as React.CSSProperties}
                          >
                            {domain.description}
                          </p>
                        )}

                        {/* Concept count + arrow */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <span
                            style={{
                              fontSize:      11,
                              fontWeight:    600,
                              color:         color,
                              background:    `${color}12`,
                              borderRadius:  5,
                              padding:       "3px 9px",
                              fontFamily:    "ui-monospace, monospace",
                            }}
                          >
                            {conceptIds.length} {conceptIds.length === 1 ? "concept" : "concepts"}
                          </span>
                          <ChevronRight style={{ width: 15, height: 15, color: "#94a3b8" }} />
                        </div>

                        {/* Level spread */}
                        {(() => {
                          const spread = domainLevelSpread[domain.id];
                          if (!spread) return null;
                          const parts: string[] = [];
                          if (spread.beginner     > 0) parts.push(`${spread.beginner} Beginner`);
                          if (spread.intermediate > 0) parts.push(`${spread.intermediate} Intermediate`);
                          if (spread.advanced     > 0) parts.push(`${spread.advanced} Advanced`);
                          if (parts.length === 0) return null;
                          return (
                            <div
                              style={{
                                fontSize:   11,
                                color:      "#94a3b8",
                                marginTop:  8,
                                lineHeight: 1.4,
                                fontFamily: "ui-monospace, monospace",
                              }}
                            >
                              {parts.join(" · ")}
                            </div>
                          );
                        })()}

                        {/* Multi-source badge */}
                        {(domain.sourceCount ?? 0) > 1 && (
                          <div
                            style={{
                              display:       "inline-flex",
                              alignItems:    "center",
                              gap:           4,
                              marginTop:     8,
                              fontSize:      10,
                              fontWeight:    600,
                              color:         "#7c3aed",
                              background:    "#f5f3ff",
                              border:        "1px solid #ddd6fe",
                              borderRadius:  4,
                              padding:       "2px 8px",
                              fontFamily:    "ui-monospace, monospace",
                            }}
                          >
                            ⟳ {domain.sourceCount} sources merged
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════
              COLUMN LAYOUT (flat view or domain drill-down)
          ══════════════════════════════════════════════════════════ */}
          {showColumnLayout && (
            <>
              {/* Breadcrumb / back navigation */}
              {(selectedDomainId || showFlatView) && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 36 }}>
                  <button
                    onClick={() => {
                      setSelectedDomainId(null);
                      setShowFlatView(false);
                    }}
                    style={{
                      display:      "flex",
                      alignItems:   "center",
                      gap:          6,
                      background:   "transparent",
                      border:       "none",
                      cursor:       "pointer",
                      fontSize:     13,
                      color:        "#64748b",
                      fontWeight:   500,
                      padding:      "4px 8px",
                      borderRadius: 6,
                      transition:   "color 0.15s, background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#1e293b";
                      (e.currentTarget as HTMLButtonElement).style.background = "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
                      (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    }}
                  >
                    <ArrowLeft style={{ width: 13, height: 13 }} />
                    All domains
                  </button>
                  {selectedDomainNode && (
                    <>
                      <ChevronRight style={{ width: 13, height: 13, color: "#cbd5e1" }} />
                      <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>
                        {selectedDomainNode.label}
                      </span>
                    </>
                  )}
                  {showFlatView && !hasDomains && null}
                  {showFlatView && hasDomains && (
                    <>
                      <ChevronRight style={{ width: 13, height: 13, color: "#cbd5e1" }} />
                      <span style={{ fontSize: 13, color: "#0f172a", fontWeight: 600 }}>All concepts</span>
                    </>
                  )}

                  {/* Listen button */}
                  {speechSupported && searchDisplayPrimary.length > 0 && (
                    <button
                      onClick={handleListenDomain}
                      aria-label={isSpeaking ? "Stop reading" : "Listen to this section"}
                      title={isSpeaking ? "Stop reading" : "Listen to this section"}
                      style={{
                        display:        "flex",
                        alignItems:     "center",
                        gap:            6,
                        marginLeft:     "auto",
                        padding:        "5px 12px",
                        background:     isSpeaking ? "#EFF6FF" : "#f8fafc",
                        border:         `1.5px solid ${isSpeaking ? "#93C5FD" : "#e2e8f0"}`,
                        borderRadius:   8,
                        fontSize:       13,
                        fontWeight:     600,
                        color:          isSpeaking ? "#1D4ED8" : "#475569",
                        cursor:         "pointer",
                        transition:     "background 0.15s, border-color 0.15s, color 0.15s",
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
                          (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
                          (e.currentTarget as HTMLButtonElement).style.color = "#475569";
                        }
                      }}
                    >
                      {isSpeaking
                        ? <><Square style={{ width: 12, height: 12 }} /> Stop</>
                        : <><Volume2 style={{ width: 13, height: 13 }} /> Listen</>
                      }
                    </button>
                  )}
                </div>
              )}

              {/* Empty state */}
              {displayPrimary.length === 0 ? (
                <div
                  style={{
                    display:        "flex",
                    flexDirection:  "column",
                    alignItems:     "center",
                    justifyContent: "center",
                    padding:        "80px 40px",
                    textAlign:      "center",
                    gap:            0,
                  }}
                >
                  <div
                    style={{
                      width:          96,
                      height:         96,
                      borderRadius:   "50%",
                      background:     "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
                      display:        "flex",
                      alignItems:     "center",
                      justifyContent: "center",
                      marginBottom:   28,
                      flexShrink:     0,
                    }}
                  >
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <line x1="14" y1="8" x2="14" y2="40" stroke="#1D4ED8" strokeWidth="2.5" strokeLinecap="round" />
                      <rect x="6" y="10" width="16" height="8" rx="2" fill="#FDC700" stroke="#c9a000" strokeWidth="1.5" />
                      <line x1="22" y1="14" x2="34" y2="14" stroke="#1D4ED8" strokeWidth="2" strokeDasharray="3 2" strokeLinecap="round" />
                      <rect x="34" y="10" width="8" height="8" rx="2" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
                      <rect x="6" y="22" width="16" height="8" rx="2" fill="#FDC700" stroke="#c9a000" strokeWidth="1.5" />
                      <line x1="22" y1="26" x2="34" y2="26" stroke="#1D4ED8" strokeWidth="2" strokeDasharray="3 2" strokeLinecap="round" />
                      <rect x="34" y="22" width="8" height="8" rx="2" fill="#fff" stroke="#e2e8f0" strokeWidth="1.5" />
                      <rect x="6" y="34" width="16" height="8" rx="2" fill="#FDC700" stroke="#c9a000" strokeWidth="1.5" />
                    </svg>
                  </div>

                  <h2
                    style={{
                      fontSize:      22,
                      fontWeight:    700,
                      color:         "#0f172a",
                      margin:        0,
                      letterSpacing: "-0.02em",
                      marginBottom:  10,
                    }}
                  >
                    {selectedDomainId ? "No concepts in this domain yet" : "Your roadmap is empty"}
                  </h2>

                  <p
                    style={{
                      fontSize:     14,
                      color:        "#64748b",
                      margin:       0,
                      maxWidth:     360,
                      lineHeight:   1.6,
                      marginBottom: 32,
                    }}
                  >
                    {selectedDomainId
                      ? "Process more inputs to add concepts to this domain."
                      : "Process your first input to generate a knowledge roadmap. Concepts, goals, insights, and actions will appear here once your content has been analysed."}
                  </p>

                  <button
                    onClick={() => navigate("/inputs")}
                    style={{
                      display:      "inline-flex",
                      alignItems:   "center",
                      gap:          8,
                      padding:      "10px 22px",
                      background:   "#1D4ED8",
                      border:       "none",
                      borderRadius: 8,
                      fontSize:     14,
                      fontWeight:   600,
                      color:        "#ffffff",
                      cursor:       "pointer",
                      transition:   "background 0.15s, transform 0.1s",
                      boxShadow:    "0 2px 8px rgba(29,78,216,0.25)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#1e40af"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#1D4ED8"; }}
                    onMouseDown={(e)  => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.97)"; }}
                    onMouseUp={(e)    => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
                  >
                    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M8 2.75a.75.75 0 0 0-1.5 0V7H2.75a.75.75 0 0 0 0 1.5H6.5v4.25a.75.75 0 0 0 1.5 0V8.5h4.25a.75.75 0 0 0 0-1.5H8V2.75Z" fill="currentColor" />
                    </svg>
                    Add your first input
                  </button>
                </div>
              ) : (

                /* ── Roadmap body ─────────────────────────────────────── */
                <div style={{ position: "relative" }}>

                  {/* Solid blue vertical spine */}
                  <div
                    style={{
                      position:     "absolute",
                      left:         109,
                      top:          0,
                      bottom:       0,
                      width:        2,
                      background:   "#1D4ED8",
                      zIndex:       0,
                      borderRadius: 1,
                    }}
                  />

                  {searchDisplayPrimary.length === 0 && searchQuery.trim() && (
                    <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                      No results match your search
                    </div>
                  )}
                  {searchDisplayPrimary.map((primary, idx) => {
                    const secNodes           = searchDisplayGroups[primary.id] ?? [];
                    const isPrimarySelected  = selectedNode?.id === primary.id;
                    const isSpeakingThis     = speakingNodeId === primary.id;
                    const prevPrimary        = idx > 0 ? searchDisplayPrimary[idx - 1] : null;
                    const prevLevel          = prevPrimary?.level ?? null;
                    const curLevel           = primary.level ?? null;
                    const showDivider        = idx === 0
                      ? !!curLevel
                      : curLevel !== prevLevel && !!curLevel;
                    const levelMeta          = curLevel ? LEVEL_CFG[curLevel] : null;

                    return (
                      <React.Fragment key={primary.id}>

                        {/* ── Level section divider ────────────────────── */}
                        {showDivider && levelMeta && (
                          <div
                            style={{
                              display:    "flex",
                              alignItems: "center",
                              gap:        10,
                              marginTop:  idx === 0 ? 0 : 12,
                              marginBottom: 4,
                              paddingLeft: 0,
                            }}
                          >
                            <span
                              style={{
                                fontSize:      11,
                                fontWeight:    700,
                                color:         levelMeta.color,
                                background:    levelMeta.bg,
                                border:        `1px solid ${levelMeta.border}`,
                                borderRadius:  6,
                                padding:       "3px 10px",
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                fontFamily:    "ui-monospace, monospace",
                              }}
                            >
                              {levelMeta.label}
                            </span>
                            <div
                              style={{
                                flex:       1,
                                height:     1,
                                background: `${levelMeta.border}80`,
                              }}
                            />
                          </div>
                        )}

                      <div
                        style={{
                          display:       "flex",
                          alignItems:    "center",
                          minHeight:     96,
                          paddingTop:    20,
                          paddingBottom: 20,
                          position:      "relative",
                          zIndex:        1,
                        }}
                      >
                        {/* ── Primary card ────────────────────────── */}
                        <div style={{ width: 220, flexShrink: 0 }}>
                          <div
                            ref={(el) => { if (el) nodeRefs.current.set(primary.id, el); else nodeRefs.current.delete(primary.id); }}
                            onClick={() => handleNodeClick(primary)}
                            style={{
                              background:   isPrimarySelected ? "#FDE68A" : "#FDC700",
                              border:       isPrimarySelected
                                ? "2px solid #b45309"
                                : isSpeakingThis
                                  ? "2px solid #1D4ED8"
                                  : "1px solid #c9a000",
                              borderRadius: 3,
                              padding:      (isPrimarySelected || isSpeakingThis) ? "10px 15px" : "11px 16px",
                              width:        "100%",
                              boxSizing:    "border-box",
                              textAlign:    "center",
                              cursor:       "pointer",
                              userSelect:   "none",
                              boxShadow:    isPrimarySelected
                                ? "0 0 0 3px rgba(180,83,9,0.15), 0 2px 6px rgba(0,0,0,0.12)"
                                : isSpeakingThis
                                  ? "0 0 0 3px rgba(29,78,216,0.18), 0 2px 6px rgba(0,0,0,0.12)"
                                  : "0 2px 6px rgba(0,0,0,0.12)",
                              transition:   "background 0.15s, border 0.15s, box-shadow 0.15s",
                              animation:    justSelectedId === primary.id ? "roadmapPulseAmber 0.65s ease-out" : undefined,
                            }}
                            onMouseEnter={(e) => {
                              if (!isPrimarySelected) (e.currentTarget as HTMLDivElement).style.background = "#F5B800";
                            }}
                            onMouseLeave={(e) => {
                              if (!isPrimarySelected) (e.currentTarget as HTMLDivElement).style.background = "#FDC700";
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 14, color: "#111", lineHeight: 1.3 }}>
                              {primary.label}
                            </div>
                            {secNodes.length > 0 && (
                              <div style={{ fontSize: 11, color: "#7c5a00", marginTop: 4, fontWeight: 500 }}>
                                {secNodes.length} {secNodes.length === 1 ? "topic" : "topics"}
                              </div>
                            )}
                            {levelMeta && (
                              <div
                                style={{
                                  display:       "inline-block",
                                  marginTop:     6,
                                  fontSize:      9,
                                  fontWeight:    700,
                                  color:         levelMeta.color,
                                  background:    levelMeta.bg,
                                  border:        `1px solid ${levelMeta.border}`,
                                  borderRadius:  4,
                                  padding:       "2px 7px",
                                  letterSpacing: "0.07em",
                                  textTransform: "uppercase",
                                  fontFamily:    "ui-monospace, monospace",
                                }}
                              >
                                {levelMeta.label}
                              </div>
                            )}
                            {(primary.sourceCount ?? 0) > 1 && (
                              <div
                                style={{
                                  display:       "inline-block",
                                  marginTop:     4,
                                  fontSize:      9,
                                  fontWeight:    600,
                                  color:         "#7c3aed",
                                  background:    "#f5f3ff",
                                  border:        "1px solid #ddd6fe",
                                  borderRadius:  4,
                                  padding:       "2px 7px",
                                  letterSpacing: "0.05em",
                                  fontFamily:    "ui-monospace, monospace",
                                }}
                              >
                                ⟳ {primary.sourceCount} src
                              </div>
                            )}
                          </div>
                        </div>

                        {/* ── Dashed connector + secondary stack ────── */}
                        {secNodes.length > 0 && (
                          <>
                            <div style={DASH_STYLE} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {secNodes.map((sec) => {
                                const isSecSelected    = selectedNode?.id === sec.id;
                                const domainLinks      = crossDomainBadges[sec.id] ?? [];
                                return (
                                  <div
                                    key={sec.id}
                                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                                  >
                                    <div
                                      ref={(el) => { if (el) nodeRefs.current.set(sec.id, el); else nodeRefs.current.delete(sec.id); }}
                                      onClick={() => handleNodeClick(sec)}
                                      style={{
                                        background:   isSecSelected ? "#F0F9FF" : "#ffffff",
                                        border:       isSecSelected ? "2px solid #1D4ED8" : "1.5px solid #e2e8f0",
                                        borderRadius: 3,
                                        padding:      isSecSelected ? "8px 17px" : "9px 18px",
                                        minWidth:     190,
                                        fontSize:     13,
                                        fontWeight:   500,
                                        color:        "#1e293b",
                                        boxShadow:    isSecSelected
                                          ? "0 0 0 3px rgba(29,78,216,0.12), 0 1px 3px rgba(0,0,0,0.06)"
                                          : "0 1px 3px rgba(0,0,0,0.06)",
                                        cursor:       "pointer",
                                        userSelect:   "none",
                                        transition:   "background 0.15s, border 0.15s, box-shadow 0.15s",
                                        animation:    justSelectedId === sec.id ? "roadmapPulseBlue 0.65s ease-out" : undefined,
                                      }}
                                      onMouseEnter={(e) => {
                                        if (!isSecSelected) {
                                          (e.currentTarget as HTMLDivElement).style.background   = "#f8fafc";
                                          (e.currentTarget as HTMLDivElement).style.borderColor  = "#cbd5e1";
                                        }
                                      }}
                                      onMouseLeave={(e) => {
                                        if (!isSecSelected) {
                                          (e.currentTarget as HTMLDivElement).style.background   = "#ffffff";
                                          (e.currentTarget as HTMLDivElement).style.borderColor  = "#e2e8f0";
                                        }
                                      }}
                                    >
                                      <div>{sec.label}</div>
                                      {(edgeCount[sec.id] ?? 0) > 0 && (
                                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3, fontWeight: 500 }}>
                                          {edgeCount[sec.id]} {edgeCount[sec.id] === 1 ? "connection" : "connections"}
                                        </div>
                                      )}
                                    </div>

                                    {/* Type badge */}
                                    <span
                                      style={{
                                        fontSize:      10,
                                        fontWeight:    700,
                                        letterSpacing: "0.06em",
                                        textTransform: "uppercase",
                                        color:         TYPE_COLOUR[sec.type] ?? "#94a3b8",
                                        fontFamily:    "monospace",
                                      }}
                                    >
                                      {TYPE_LABEL[sec.type]}
                                    </span>

                                    {/* Cross-domain badges */}
                                    {domainLinks.map((domainLabel) => (
                                      <span
                                        key={domainLabel}
                                        style={{
                                          display:       "inline-flex",
                                          alignItems:    "center",
                                          gap:           4,
                                          fontSize:      10,
                                          fontWeight:    600,
                                          color:         "#4F46E5",
                                          background:    "#EEF2FF",
                                          border:        "1px solid #C7D2FE",
                                          borderRadius:  5,
                                          padding:       "2px 7px",
                                          whiteSpace:    "nowrap",
                                          fontFamily:    "ui-monospace, monospace",
                                        }}
                                        title={`Also linked to the ${domainLabel} domain`}
                                      >
                                        linked to {domainLabel}
                                      </span>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* ── Node detail panel ───────────────────────────────────────── */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          onClose={handleClosePanel}
          allNodes={graphData?.nodes ?? []}
          edges={graphData?.edges ?? []}
          onSelectNode={selectNode}
        />
      )}
    </AppLayout>
  );
}
