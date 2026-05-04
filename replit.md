# Headmaster

A personal AI knowledge system that converts user inputs into structured knowledge, connected concepts, and actionable tasks. Visualised as an interactive knowledge graph.

## Architecture

**Monorepo (pnpm workspaces)**

- `artifacts/headmaster` — React + Vite frontend (`@workspace/headmaster`)
- `artifacts/api-server` — Express API server (`@workspace/api-server`)
- `lib/api-spec` — OpenAPI spec + Orval codegen config
- `lib/api-client-react` — Generated TanStack Query hooks
- `lib/api-zod` — Generated Zod validation schemas
- `lib/db` — Drizzle ORM schema + database client

## Tech Stack

- **Frontend:** React + Vite, React Flow (graph canvas), Tailwind CSS, shadcn/ui, wouter (routing), TanStack Query
- **Backend:** Node.js + Express, Drizzle ORM, Pino logger
- **Database:** PostgreSQL (Replit managed)
- **AI:** OpenAI GPT-4o-mini for knowledge extraction

## Features

- **Input System:** Paste text, notes, or URLs with a title and type
- **AI Processing:** Sends input to OpenAI → extracts summary, 3–6 knowledge nodes, 1–3 action items
- **Node Types:** concept (blue), insight (amber), action (green), goal (purple)
- **Knowledge Graph:** Interactive React Flow canvas — zoom, pan, drag nodes (positions persisted)
- **Bottom Panel:** Click any node to see details + connected nodes
- **Actions Dashboard:** Kanban-style view with pending / in-progress / done columns
- **Inputs Page:** View all inputs, trigger processing, delete entries

## UI Layout

- **Left sidebar:** Navigation (Graph / Inputs / Actions)
- **Right panel (on Graph page):** Quick Ingest form
- **Main canvas:** React Flow graph with minimap, controls, background grid
- **Bottom panel:** Slides up when a node is selected

## Database Schema

- `inputs` — id, title, content, type, summary, processed, timestamps
- `nodes` — id, label, type, level (beginner/intermediate/advanced, nullable), description, inputId, positionX, positionY, timestamps
- `edges` — id, sourceId, targetId, label, createdAt
- `actions` — id, title, description, status, nodeId, timestamps

## API Routes

All routes are under `/api`:

- `GET/POST /inputs` — list / create inputs
- `GET/DELETE /inputs/:id` — get / delete input
- `POST /inputs/:id/process` — AI-process an input → creates nodes + actions
- `GET/POST /nodes` — list / create nodes
- `GET/PUT/DELETE /nodes/:id` — get / update / delete node
- `GET/POST /edges` — list / create edges
- `DELETE /edges/:id` — delete edge
- `GET/PUT/DELETE /actions/:id` — update / delete action
- `GET /graph/data` — all nodes + edges for React Flow
- `GET /graph/summary` — aggregate stats

## Codegen

After changing `lib/api-spec/openapi.yaml`, run:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates hooks in `lib/api-client-react` and Zod schemas in `lib/api-zod`.

## Environment Variables / Secrets

- `DATABASE_URL` — PostgreSQL connection string (managed by Replit)
- `OPENAI_API_KEY` — Required for AI processing
- `SESSION_SECRET` — Express session secret

## Design

- Dark mode only (deep near-black background)
- Monospace typography for labels, clean sans-serif for descriptions
- Neon accent colours per node type — restrained and purposeful
- Roadmap.sh-inspired structured layout
