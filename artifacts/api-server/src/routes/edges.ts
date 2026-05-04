import { Router } from "express";
import { db, edgesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { CreateEdgeBody } from "@workspace/api-zod";

const router = Router();

router.get("/edges", async (_req, res) => {
  const edges = await db.select().from(edgesTable).orderBy(edgesTable.createdAt);
  res.json(edges);
});

router.post("/edges", async (req, res) => {
  const parsed = CreateEdgeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const { sourceId, targetId, label } = parsed.data;
  const [edge] = await db
    .insert(edgesTable)
    .values({
      id: randomUUID(),
      sourceId,
      targetId,
      label,
      createdAt: new Date(),
    })
    .returning();
  res.status(201).json(edge);
});

router.delete("/edges/:id", async (req, res) => {
  await db.delete(edgesTable).where(eq(edgesTable.id, req.params.id));
  res.status(204).send();
});

export default router;
