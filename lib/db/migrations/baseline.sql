-- Headmaster baseline schema
-- Creates all tables from scratch on a fresh database.
-- Safe to run multiple times (uses IF NOT EXISTS throughout).
-- Used by docker-compose for first-boot initialization.

CREATE TABLE IF NOT EXISTS "inputs" (
  "id"         text PRIMARY KEY,
  "title"      text NOT NULL,
  "content"    text NOT NULL,
  "type"       text NOT NULL DEFAULT 'text',
  "summary"    text,
  "processed"  boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "nodes" (
  "id"          text PRIMARY KEY,
  "label"       text NOT NULL,
  "type"        text NOT NULL,
  "level"       text,
  "description" text,
  "input_id"    text,
  "position_x"  real NOT NULL DEFAULT 0,
  "position_y"  real NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "edges" (
  "id"         text PRIMARY KEY,
  "source_id"  text NOT NULL,
  "target_id"  text NOT NULL,
  "label"      text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "actions" (
  "id"          text PRIMARY KEY,
  "title"       text NOT NULL,
  "description" text,
  "status"      text NOT NULL DEFAULT 'pending',
  "node_id"     text,
  "input_id"    text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "node_sources" (
  "node_id"    text NOT NULL,
  "input_id"   text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("node_id", "input_id")
);
