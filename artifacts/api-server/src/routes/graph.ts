import { Router } from "express";
import { db, nodesTable, edgesTable, inputsTable, actionsTable, nodeSourcesTable } from "@workspace/db";
import { sql, eq, asc } from "drizzle-orm";

const router = Router();

router.get("/graph/summary", async (_req, res) => {
  const [nodeCount] = await db.select({ count: sql<number>`count(*)` }).from(nodesTable);
  const [edgeCount] = await db.select({ count: sql<number>`count(*)` }).from(edgesTable);
  const [inputCount] = await db.select({ count: sql<number>`count(*)` }).from(inputsTable);
  const [actionCount] = await db.select({ count: sql<number>`count(*)` }).from(actionsTable);

  const nodesByType = await db
    .select({ type: nodesTable.type, count: sql<number>`count(*)` })
    .from(nodesTable)
    .groupBy(nodesTable.type);

  const actionsByStatus = await db
    .select({ status: actionsTable.status, count: sql<number>`count(*)` })
    .from(actionsTable)
    .groupBy(actionsTable.status);

  const nodeTypeMap = { domain: 0, concept: 0, insight: 0, action: 0, goal: 0 };
  for (const row of nodesByType) {
    const k = row.type as keyof typeof nodeTypeMap;
    if (k in nodeTypeMap) nodeTypeMap[k] = Number(row.count);
  }

  const actionStatusMap = { pending: 0, in_progress: 0, done: 0 };
  for (const row of actionsByStatus) {
    actionStatusMap[row.status as keyof typeof actionStatusMap] = Number(row.count);
  }

  res.json({
    totalNodes: Number(nodeCount?.count ?? 0),
    totalEdges: Number(edgeCount?.count ?? 0),
    totalInputs: Number(inputCount?.count ?? 0),
    totalActions: Number(actionCount?.count ?? 0),
    nodesByType: nodeTypeMap,
    actionsByStatus: actionStatusMap,
  });
});

router.get("/graph/data", async (_req, res) => {
  const [nodes, edges, sourcesRows] = await Promise.all([
    db.select().from(nodesTable).orderBy(nodesTable.createdAt),
    db.select().from(edgesTable).orderBy(edgesTable.createdAt),
    db
      .select({
        nodeId:  nodeSourcesTable.nodeId,
        inputId: nodeSourcesTable.inputId,
        title:   inputsTable.title,
        type:    inputsTable.type,
      })
      .from(nodeSourcesTable)
      .leftJoin(inputsTable, eq(inputsTable.id, nodeSourcesTable.inputId)),
  ]);

  /* Group sources by nodeId */
  const sourcesByNodeId = new Map<string, Array<{ inputId: string; title: string; type: string }>>();
  for (const row of sourcesRows) {
    if (!row.title) continue;
    const arr = sourcesByNodeId.get(row.nodeId) ?? [];
    arr.push({ inputId: row.inputId, title: row.title, type: row.type! });
    sourcesByNodeId.set(row.nodeId, arr);
  }

  const nodesWithSources = nodes.map((n) => {
    const sources = sourcesByNodeId.get(n.id) ?? [];
    return { ...n, sourceCount: sources.length, sources };
  });

  res.json({ nodes: nodesWithSources, edges });
});

router.get("/graph/domains", async (_req, res) => {
  const rows = await db
    .select({ label: nodesTable.label })
    .from(nodesTable)
    .where(eq(nodesTable.type, "domain"))
    .orderBy(asc(nodesTable.label));

  const seen = new Set<string>();
  const domains: string[] = [];
  for (const row of rows) {
    const key = row.label.trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      domains.push(key);
    }
  }
  res.json({ domains });
});

export default router;
