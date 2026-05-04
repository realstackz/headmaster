import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const nodesTable = pgTable("nodes", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  type: text("type", { enum: ["domain", "concept", "insight", "action", "goal"] }).notNull(),
  level: text("level", { enum: ["beginner", "intermediate", "advanced"] }),
  description: text("description"),
  inputId: text("input_id"),
  positionX: real("position_x").notNull().default(0),
  positionY: real("position_y").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNodeSchema = createInsertSchema(nodesTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Node = typeof nodesTable.$inferSelect;
