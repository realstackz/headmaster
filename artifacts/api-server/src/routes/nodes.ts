import { Router } from "express";
import { db, nodesTable, nodeSourcesTable, inputsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { CreateNodeBody, UpdateNodeBody } from "@workspace/api-zod";

const router = Router();

router.get("/nodes", async (_req, res) => {
  const nodes = await db.select().from(nodesTable).orderBy(nodesTable.createdAt);
  res.json(nodes);
});

router.post("/nodes", async (req, res) => {
  const parsed = CreateNodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { label, type, description, inputId, positionX, positionY } = parsed.data;
  const now = new Date();
  const [node] = await db
    .insert(nodesTable)
    .values({
      id: randomUUID(),
      label,
      type: type as "concept" | "insight" | "action" | "goal",
      description,
      inputId,
      positionX: positionX ?? 0,
      positionY: positionY ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  res.status(201).json(node);
});

router.get("/nodes/:id", async (req, res) => {
  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, req.params.id));
  if (!node) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  /* Fetch sources with input title + type */
  const sourceRows = await db
    .select({
      inputId: nodeSourcesTable.inputId,
      title:   inputsTable.title,
      type:    inputsTable.type,
    })
    .from(nodeSourcesTable)
    .leftJoin(inputsTable, eq(inputsTable.id, nodeSourcesTable.inputId))
    .where(eq(nodeSourcesTable.nodeId, req.params.id));

  const sources = sourceRows
    .filter((r) => r.title !== null)
    .map((r) => ({ inputId: r.inputId, title: r.title!, type: r.type! }));

  res.json({ ...node, sourceCount: sources.length, sources });
});

router.put("/nodes/:id", async (req, res) => {
  const parsed = UpdateNodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const updates: Partial<typeof nodesTable.$inferInsert> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.type !== undefined) updates.type = parsed.data.type as "concept" | "insight" | "action" | "goal";
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.positionX !== undefined) updates.positionX = parsed.data.positionX;
  if (parsed.data.positionY !== undefined) updates.positionY = parsed.data.positionY;
  updates.updatedAt = new Date();

  const [node] = await db
    .update(nodesTable)
    .set(updates)
    .where(eq(nodesTable.id, req.params.id))
    .returning();
  if (!node) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(node);
});

router.delete("/nodes/:id", async (req, res) => {
  await db.delete(nodesTable).where(eq(nodesTable.id, req.params.id));
  res.status(204).send();
});

export default router;
