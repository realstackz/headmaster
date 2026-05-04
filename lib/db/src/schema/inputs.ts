import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const inputsTable = pgTable("inputs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  type: text("type", { enum: ["text", "url", "note", "file", "youtube", "instagram", "pinterest", "image", "video", "audio"] }).notNull().default("text"),
  summary: text("summary"),
  processed: boolean("processed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInputSchema = createInsertSchema(inputsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertInput = z.infer<typeof insertInputSchema>;
export type Input = typeof inputsTable.$inferSelect;
