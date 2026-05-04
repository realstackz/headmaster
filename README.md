# Headmaster

**Turn information overload into structured knowledge.**

Headmaster is a personal AI knowledge system that transforms your raw inputs — articles, videos, notes, files — into a connected knowledge graph you can actually navigate and act on.

```
CHAOS → COMPRESS → STRUCTURE → CONNECT → ACTION
```

| Stage | What happens |
|-------|-------------|
| **CHAOS** | You dump raw inputs: text, URLs, YouTube videos, files, notes |
| **COMPRESS** | GPT-4o-mini extracts a summary and key concepts per input |
| **STRUCTURE** | Concepts are organized into a typed hierarchy: Domain → Concept/Goal → Insight/Action |
| **CONNECT** | Shared concepts across inputs are automatically merged into a single node |
| **ACTION** | Actionable next steps surface from every piece of content |

---

## Features

- Import anything: plain text, web URLs, YouTube videos (with transcripts), PDFs, images, audio, Instagram posts, Pinterest pins
- AI-powered extraction via GPT-4o-mini — no manual tagging required
- Interactive knowledge graph with React Flow
- Roadmap view: domain cards → concept cards → insight/action leaves
- Multi-source node merging: when two inputs teach the same concept, they share one node
- Text-to-speech read-aloud for any node
- Actions board with Pending / In Progress / Done tracking

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, React Flow, TailwindCSS v4 |
| API | Express.js (TypeScript), pino logging |
| AI | OpenAI GPT-4o-mini |
| Database | PostgreSQL, Drizzle ORM |
| Monorepo | pnpm workspaces |

---

## Prerequisites

- **Node.js** 20+ (`node --version`)
- **pnpm** 10+ — install with `npm i -g pnpm`
- **PostgreSQL** 15+ — running locally or via a cloud provider
- An **OpenAI API key** — [platform.openai.com](https://platform.openai.com)

---

## Quick Start (local development)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/headmaster.git
cd headmaster
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env — fill in DATABASE_URL, OPENAI_API_KEY, SESSION_SECRET
```

### 3. Initialize the database

```bash
# Apply all migrations in order
psql "$DATABASE_URL" -f lib/db/migrations/0000_colorful_infant_terrible.sql
psql "$DATABASE_URL" -f lib/db/migrations/0001_add_node_sources.sql
psql "$DATABASE_URL" -f lib/db/migrations/0002_add_actions_input_id.sql
```

Or push the full schema directly with Drizzle (drops nothing, safe on empty DB):

```bash
pnpm --filter @workspace/db push
```

### 4. Start the dev servers

```bash
# Terminal 1 — API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Headmaster frontend
pnpm --filter @workspace/headmaster run dev
```

Open your browser at the URL shown by Vite (usually `http://localhost:5173`).

---

## Docker (full stack)

```bash
cp .env.example .env
# Fill in OPENAI_API_KEY and SESSION_SECRET in .env (DATABASE_URL is set automatically by compose)

docker compose up --build
```

This starts:
- **PostgreSQL** on port 5432 (internal)
- **API server** on port 8080 at `/api`
- **Headmaster frontend** on port 3000

The database schema is applied automatically on first boot.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string — `postgres://user:pass@host:5432/dbname` |
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o-mini extraction |
| `SESSION_SECRET` | Yes | Secret for signing session cookies — any random 32+ char string |
| `PORT` | No | Port for the API server (default: `8080`) |

---

## Project Structure

```
headmaster/
├── artifacts/
│   ├── api-server/          # Express API (TypeScript)
│   │   └── src/routes/      # inputs, nodes, edges, actions, graph
│   └── headmaster/          # React + Vite frontend
│       └── src/
│           ├── pages/       # Graph, Roadmap, Inputs, Actions
│           └── components/
├── lib/
│   ├── api-spec/            # OpenAPI 3.0 spec (source of truth)
│   ├── api-client-react/    # Generated React Query hooks
│   ├── api-zod/             # Generated Zod validation schemas
│   └── db/
│       ├── src/schema/      # Drizzle table definitions
│       └── migrations/      # SQL migration files
└── docs/
    └── schema.md            # Database schema reference
```

---

## API Overview

The API is served at `/api`. All routes accept and return JSON.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/healthz` | Health check |
| `GET` | `/api/inputs` | List all inputs |
| `POST` | `/api/inputs` | Create an input |
| `POST` | `/api/inputs/:id/process` | Extract knowledge with AI |
| `POST` | `/api/inputs/:id/reprocess` | Re-run AI extraction |
| `GET` | `/api/graph/data` | All nodes + edges with source counts |
| `GET` | `/api/graph/summary` | Dashboard statistics |
| `GET` | `/api/nodes/:id` | Single node with full source list |
| `GET` | `/api/actions` | List all actions |

Full OpenAPI spec: `lib/api-spec/openapi.yaml`

---

## Regenerating the API client

If you change `lib/api-spec/openapi.yaml`, regenerate the TypeScript client:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## License

MIT
