import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

export const nodeSourcesTable = pgTable(
  "node_sources",
  {
    nodeId:    text("node_id").notNull(),
    inputId:   text("input_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.inputId] })],
);

export type NodeSourceRow = typeof nodeSourcesTable.$inferSelect;
