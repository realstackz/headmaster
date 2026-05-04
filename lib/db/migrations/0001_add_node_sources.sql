CREATE TABLE IF NOT EXISTS "node_sources" (
  "node_id"    text        NOT NULL,
  "input_id"   text        NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "node_sources_pk" PRIMARY KEY ("node_id", "input_id")
);

-- Seed from existing nodes.input_id so nothing is orphaned
INSERT INTO "node_sources" ("node_id", "input_id")
SELECT "id", "input_id"
FROM   "nodes"
WHERE  "input_id" IS NOT NULL
ON CONFLICT DO NOTHING;
