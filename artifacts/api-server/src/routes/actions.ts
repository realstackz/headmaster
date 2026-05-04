import { Router } from "express";
import { db, actionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateActionBody } from "@workspace/api-zod";

const router = Router();

router.get("/actions", async (_req, res) => {
  const actions = await db.select().from(actionsTable).orderBy(actionsTable.createdAt);
  res.json(actions);
});

router.put("/actions/:id", async (req, res) => {
  const parsed = UpdateActionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }
  const updates: Partial<typeof actionsTable.$inferInsert> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status as "pending" | "in_progress" | "done";
  updates.updatedAt = new Date();

  const [action] = await db
    .update(actionsTable)
    .set(updates)
    .where(eq(actionsTable.id, req.params.id))
    .returning();
  if (!action) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(action);
});

router.delete("/actions/:id", async (req, res) => {
  await db.delete(actionsTable).where(eq(actionsTable.id, req.params.id));
  res.status(204).send();
});

export default router;
