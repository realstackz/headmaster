import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const edgesTable = pgTable("edges", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEdgeSchema = createInsertSchema(edgesTable).omit({
  createdAt: true,
});

export type InsertEdge = z.infer<typeof insertEdgeSchema>;
export type Edge = typeof edgesTable.$inferSelect;
