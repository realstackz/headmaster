import dagre from "@dagrejs/dagre";
import { Node as RFNode, Edge as RFEdge, Position } from "reactflow";

export const NODE_W = 210;
export const NODE_H = 68;

/**
 * Dagre LR layout — left-to-right knowledge flow.
 * Source / root concepts on the left, derived insights & actions on the right.
 */
export function getLayoutedElements(
  nodes: RFNode[],
  edges: RFEdge[]
): { nodes: RFNode[]; edges: RFEdge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",   // ← left-to-right: reads naturally like a flowchart
    ranksep: 140,    // horizontal gap between columns
    nodesep: 56,     // vertical gap between nodes in the same column
    edgesep: 20,
    marginx: 80,
    marginy: 60,
  });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => {
    if (g.hasNode(e.source) && g.hasNode(e.target))
      g.setEdge(e.source, e.target);
  });

  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      if (!pos) return n;
      return {
        ...n,
        // LR layout: edges leave from Right and enter from Left
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      };
    }),
    edges,
  };
}
