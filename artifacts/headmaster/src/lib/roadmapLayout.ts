import { Node as RFNode, Edge as RFEdge, MarkerType } from "reactflow";
import { NodeType } from "@workspace/api-client-react";

export const PRIMARY = new Set<NodeType>(["concept", "goal"]);

const NODE_W = 180;
const NODE_H = 50;
const PRIMARY_X = 420;         // center-x of the primary spine column
const PRIMARY_Y_START = 80;
const PRIMARY_GAP = 110;       // vertical gap between primary node bottoms
const SECONDARY_OFFSET = 140;  // distance from primary right-edge to secondary left-edge
const SECONDARY_GAP = 68;      // vertical gap between siblings in a secondary group

/**
 * roadmap.sh-style layout:
 *   • Primary nodes (concept / goal) → vertical center column
 *   • Secondary nodes (insight / action) → stacked to the RIGHT of their primary parent
 */
export function roadmapLayout(rfNodes: RFNode[]): RFNode[] {
  if (rfNodes.length === 0) return rfNodes;

  const primaryNodes   = rfNodes.filter((n) => PRIMARY.has(n.data.type as NodeType));
  const secondaryNodes = rfNodes.filter((n) => !PRIMARY.has(n.data.type as NodeType));
  const primaryIds     = new Set(primaryNodes.map((n) => n.id));

  // ----- 1. Sort primary nodes by their stored spine order (y position) -----
  const sortedPrimary = [...primaryNodes].sort((a, b) => a.position.y - b.position.y);

  // ----- 2. Assign primary positions (vertical column) -----
  const posMap: Record<string, { x: number; y: number }> = {};
  sortedPrimary.forEach((node, i) => {
    posMap[node.id] = {
      x: PRIMARY_X - NODE_W / 2,
      y: PRIMARY_Y_START + i * (NODE_H + PRIMARY_GAP),
    };
  });

  // ----- 3. Group secondary nodes by nearest primary parent (stored y proximity) -----
  const groups: Record<string, RFNode[]> = {};
  sortedPrimary.forEach((n) => { groups[n.id] = []; });

  secondaryNodes.forEach((sec) => {
    // find the closest primary node (by stored y)
    let closest = sortedPrimary[0];
    let minDist  = Infinity;
    sortedPrimary.forEach((pri) => {
      const dist = Math.abs(sec.position.y - pri.position.y);
      if (dist < minDist) { minDist = dist; closest = pri; }
    });
    if (closest) groups[closest.id].push(sec);
  });

  // Sort each group by stored x / y to keep a stable order
  Object.values(groups).forEach((arr) =>
    arr.sort((a, b) => a.position.y - b.position.y)
  );

  // ----- 4. Assign secondary positions (right of their parent) -----
  sortedPrimary.forEach((primary) => {
    const children  = groups[primary.id] ?? [];
    const parentCY  = (posMap[primary.id]?.y ?? 0) + NODE_H / 2;
    const totalH    = children.length * NODE_H + Math.max(0, children.length - 1) * SECONDARY_GAP;
    const startY    = parentCY - totalH / 2;
    const secX      = PRIMARY_X + NODE_W / 2 + SECONDARY_OFFSET;

    children.forEach((child, i) => {
      posMap[child.id] = {
        x: secX,
        y: startY + i * (NODE_H + SECONDARY_GAP),
      };
    });
  });

  // ----- 5. Map positions back onto nodes -----
  return rfNodes.map((n) => ({
    ...n,
    position: posMap[n.id] ?? n.position,
  }));
}

/**
 * Build a ReactFlow edge styled roadmap.sh-style:
 *   primary → primary  → thick solid blue  (spine)
 *   primary → secondary → dashed blue      (branch, right→left handle)
 *   secondary → *      → dashed slate      (secondary branch)
 */
export function buildStyledEdge(
  id: string,
  source: string,
  target: string,
  sourceType: NodeType,
  targetType: NodeType
): RFEdge {
  import("reactflow").then(() => {}); // tree-shaking hint
  const srcPrimary = PRIMARY.has(sourceType);
  const tgtPrimary = PRIMARY.has(targetType);

  if (srcPrimary && tgtPrimary) {
    // SPINE — straight thick blue line, no label
    return {
      id,
      source,
      target,
      type: "straight",
      markerEnd: {
        type:   MarkerType.ArrowClosed,
        width:  18,
        height: 18,
        color:  "#1D4ED8",
      },
      style: { stroke: "#1D4ED8", strokeWidth: 3 },
    };
  }

  // BRANCH from primary → secondary
  if (srcPrimary && !tgtPrimary) {
    return {
      id,
      source,
      target,
      sourceHandle: "right",
      targetHandle: "left",
      type: "smoothstep",
      markerEnd: {
        type:   MarkerType.ArrowClosed,
        width:  14,
        height: 14,
        color:  "#1D4ED8",
      },
      style: {
        stroke:          "#1D4ED8",
        strokeWidth:     1.5,
        strokeDasharray: "7 4",
      },
    };
  }

  // secondary → anything (gray dashed)
  return {
    id,
    source,
    target,
    type: "smoothstep",
    markerEnd: {
      type:   MarkerType.ArrowClosed,
      width:  12,
      height: 12,
      color:  "#94a3b8",
    },
    style: {
      stroke:          "#94a3b8",
      strokeWidth:     1.5,
      strokeDasharray: "5 4",
    },
  };
}
