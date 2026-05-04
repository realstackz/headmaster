# Database Schema

Headmaster uses **PostgreSQL** managed via [Drizzle ORM](https://orm.drizzle.team/). All table definitions live in `lib/db/src/schema/`.

---

## Tables

### `inputs`

Stores every piece of raw content the user adds to Headmaster.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | UUID |
| `title` | `text` NOT NULL | Human-readable title (auto-derived from content when not provided) |
| `content` | `text` NOT NULL | Full text content (URL, transcript, file text, etc.) |
| `type` | `text` NOT NULL | `text` \| `url` \| `note` \| `file` \| `youtube` \| `instagram` \| `pinterest` \| `image` \| `video` \| `audio` |
| `summary` | `text` | One-paragraph AI-generated summary (set after processing) |
| `processed` | `boolean` NOT NULL | `true` once AI extraction has been run |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

---

### `nodes`

Individual knowledge concepts extracted from inputs. Nodes form the vertices of the knowledge graph.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | UUID |
| `label` | `text` NOT NULL | Short label (≤4 words) |
| `type` | `text` NOT NULL | `domain` \| `concept` \| `goal` \| `insight` \| `action` |
| `level` | `text` | `beginner` \| `intermediate` \| `advanced` — null for domain nodes |
| `description` | `text` | One-sentence explanation (synthesized across sources when merged) |
| `input_id` | `text` | Original source input (set on first creation; `node_sources` is authoritative for multi-source tracking) |
| `position_x` | `real` NOT NULL | X position in the graph canvas |
| `position_y` | `real` NOT NULL | Y position in the graph canvas |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**Node type hierarchy:**
```
domain           ← broad knowledge area (e.g. "Technology", "Finance")
  concept / goal ← primary topics within a domain, with a difficulty level
    insight      ← key takeaways or observations under a concept
    action       ← specific things to do or learn under a concept
```

---

### `edges`

Directed connections between nodes. Encode the hierarchy and cross-domain relationships.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | UUID |
| `source_id` | `text` NOT NULL | Source node ID |
| `target_id` | `text` NOT NULL | Target node ID |
| `label` | `text` | Optional edge label |
| `created_at` | `timestamptz` NOT NULL | |

Typical edge patterns:
- `domain → concept` (domain contains concept)
- `domain → goal` (domain contains goal)
- `concept → insight` (concept elaborated by insight)
- `concept → action` (concept implies an action)
- `concept → concept` (cross-domain relationship)

---

### `actions`

Actionable next steps extracted by AI from inputs. Displayed on the Actions board.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `text` PK | UUID |
| `title` | `text` NOT NULL | Short action title |
| `description` | `text` | Longer description of the action |
| `status` | `text` NOT NULL | `pending` \| `in_progress` \| `done` (default: `pending`) |
| `node_id` | `text` | Optional linked node |
| `input_id` | `text` | Source input that generated this action (used to clean up on reprocess) |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

---

### `node_sources`

Junction table tracking which inputs contributed to each node. Enables **node merging**: when two inputs produce a node with the same `type` and `label`, they share a single node record and both appear here.

| Column | Type | Description |
|--------|------|-------------|
| `node_id` | `text` NOT NULL | References `nodes.id` |
| `input_id` | `text` NOT NULL | References `inputs.id` |
| `created_at` | `timestamptz` NOT NULL | |

**Primary key:** composite `(node_id, input_id)`

**Merge key:** `type:label.toLowerCase().trim()` — nodes with the same type and normalized label are considered identical and share a single row.

---

## Migrations

Migrations are plain SQL files in `lib/db/migrations/` — no migration runner dependency required.

### Apply to a fresh database

Use the baseline schema — it creates all five tables in one command using `IF NOT EXISTS`, so it is safe to run on any empty database:

```bash
psql "$DATABASE_URL" -f lib/db/migrations/baseline.sql
```

This is also the strategy used by `docker compose up` for first-boot initialization.

Alternatively, Drizzle Kit can introspect the TypeScript schema and sync it automatically (never drops data):

```bash
DATABASE_URL="your-connection-string" pnpm --filter @workspace/db push
```

> **Upgrading an existing database:** The incremental files (`0000_colorful_infant_terrible.sql`, `0001_add_node_sources.sql`, `0002_add_actions_input_id.sql`) apply targeted `ALTER TABLE` changes and are intended for databases created before the baseline existed. Run them in order only if your DB was provisioned prior to the baseline migration.

### Adding a new migration

1. Write a new SQL file: `lib/db/migrations/NNNN_descriptive_name.sql`
2. Add the entry to `lib/db/migrations/meta/_journal.json`
3. Apply it manually with `psql "$DATABASE_URL" -f lib/db/migrations/NNNN_...sql`

---

## Schema diagram

```
inputs ──────────────────────────────────────────────┐
  │                                                   │
  │ (1:many via node_sources)                         │ (1:many via actions.input_id)
  ▼                                                   ▼
node_sources ──── nodes ◄──── edges ────► nodes     actions
  (node_id, input_id)   (source_id)  (target_id)
```
