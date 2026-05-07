# Graft — Git for Agent Conversations

A database-driven app that brings Git-style version control to AI agent conversations. Branch, pin, cherry-pick, and search across long-running chats — the DB is the protagonist.

## The Problem

Long agent conversations get bloated. You want to try something speculative without polluting your main thread, or you remember solving a problem in a different chat and want to pull that context in. Today you copy-paste. Graft builds proper structure for it.

## Core Concepts

| Concept | What it does |
|---------|-------------|
| **Conversation** | A DAG of nodes (messages), owned by a user |
| **Branch** | Named pointer into the DAG — like a git branch |
| **Pin** | "Always include this node in context on this branch" |
| **Import** | Cherry-pick a node (or subtree) from another branch |
| **Summary** | Condense old messages to save tokens |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | PostgreSQL (Supabase) — closure table, full-text search, GIN indexes |
| Backend | FastAPI + SQLAlchemy 2.0 |
| Frontend | React + Vite + Tailwind CSS v4 |
| LLM | Claude API (with stub fallback) |
| Hosting | Render (backend) + Vercel (frontend) + Supabase (DB) |

## Schema (11 tables)

`users` · `conversations` · `nodes` · `node_ancestry` · `branches` · `context_pins` · `context_imports` · `node_summaries` · `tags` · `node_tags` · `branch_shares`

Full DDL: [`docs/03_database_schema.md`](docs/03_database_schema.md) · DBML: [`db/schema.dbml`](db/schema.dbml)

## Three Core Queries

1. **Context Assembly** (hot path) — walks ancestors via closure table, unions pinned + imported nodes, elides summaries, ranks by priority/recency, truncates at token budget
2. **Branch Divergence** — finds LCA of two branches, computes set differences for merge decisions
3. **Full-Text Search** — `websearch_to_tsquery` + GIN index across all conversations with branch context

Full SQL: [`db/queries.sql`](db/queries.sql)

---

## Running Locally

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL database (Supabase free tier works — use the **Session pooler** URI)

### 1. Clone and configure

```bash
git clone https://github.com/DanilaOdesser/Graft.git
cd Graft
cp .env.example .env
```

Edit `.env`:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres
ANTHROPIC_API_KEY=sk-ant-...   # optional — without it, agent returns a stub reply
```

### 2. Set up the database (one-time)

```bash
# Run DDL + seed data
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/init.sql
python3 db/seed/load_seed.py
```

This creates all 11 tables, the closure-table trigger, indexes, and loads the RecipeBox sample data (2 users, 1 conversation, 7 branches, 35 nodes).

### 3. Start the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health` should return `{"status":"ok"}`

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

### 5. Use the app

- **Home** (`/`) — lists conversations, create new ones
- **Conversation** (`/conversations/:id`) — branch sidebar, message thread, send messages to the agent
- **Search** (`/search`) — full-text search across all conversations, cherry-pick results into branches

---

## Running Tests

```bash
# Backend unit tests (needs running DB with seed data)
cd backend && source venv/bin/activate && pytest -v

# Phase 1 verification (models, routes, schemas — no DB needed)
python tests/test_phase1.py

# Phase 2 verification (ingestion tool, integration test infra — no DB needed)
python tests/test_phase2.py

# Frontend verification (components, api client, build — no DB needed)
cd ../frontend && node tests/test_phase3.mjs

# Integration tests (needs running backend + seeded DB)
cd .. && python -m scripts.test_integration
```

## CLI Tools

```bash
# Ingest a plain-text transcript into a new conversation
python -m scripts.ingest transcript.txt --user-id <UUID>

# Input format:
# User: How do I set up Postgres?
# Assistant: First, install PostgreSQL...
```

---

## API Endpoints

### Conversations (DEV-A)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/conversations` | Create conversation (atomic: conv + branch + root node) |
| GET | `/api/conversations?owner_id=` | List user's conversations |
| GET | `/api/conversations/{id}` | Get conversation with branches |

### Branches (DEV-A)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/conversations/{id}/branches` | Fork a new branch |
| GET | `/api/branches/{id}` | Get branch details |
| POST | `/api/branches/{id}/archive` | Archive a branch |
| GET | `/api/nodes/{id}/context?budget=N` | Context assembly (Query 1) |

### Agent (DEV-A)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/turn` | Send message, get AI response |

### Nodes (DEV-B)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/nodes` | Create a node |
| GET | `/api/nodes/{id}` | Get a node |

### Pins & Imports (DEV-B)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/branches/{id}/pins` | Pin a node to a branch |
| GET | `/api/branches/{id}/pins` | List pins (ordered by priority) |
| DELETE | `/api/pins/{id}` | Remove a pin |
| POST | `/api/branches/{id}/imports` | Import (cherry-pick) a node |
| GET | `/api/branches/{id}/imports` | List imports |
| DELETE | `/api/imports/{id}` | Remove an import |

### Search & Divergence (DEV-B)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=&user_id=&k=` | Full-text search (Query 3) |
| GET | `/api/branches/{a}/diverge/{b}` | Branch divergence report (Query 2) |

---

## Repository Structure

```
Graft/
├── README.md
├── .env.example
├── render.yaml                    # Render Blueprint for backend deploy
├── backend/
│   ├── main.py                    # FastAPI app, mounts all 6 routers
│   ├── db.py                      # SQLAlchemy engine + session
│   ├── llm.py                     # Claude API client + stub fallback
│   ├── schemas.py                 # Pydantic request/response models
│   ├── requirements.txt
│   ├── models/
│   │   ├── core.py                # User, Conversation, Node, Branch
│   │   └── context.py             # NodeAncestry, Pins, Imports, Summaries, Tags, Shares
│   ├── routers/
│   │   ├── conversations.py       # Conversation CRUD
│   │   ├── branches.py            # Branch CRUD + context assembly (Query 1)
│   │   ├── agent.py               # Agent turn (LLM integration)
│   │   ├── nodes.py               # Node CRUD
│   │   ├── context.py             # Pins + imports endpoints
│   │   └── search.py              # FTS search (Query 3) + divergence (Query 2)
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── api.js                 # Shared API client (all endpoints)
│   │   ├── App.jsx                # Router + nav shell
│   │   ├── pages/
│   │   │   ├── ConversationList.jsx
│   │   │   ├── ConversationView.jsx
│   │   │   └── SearchPage.jsx
│   │   └── components/
│   │       ├── BranchSidebar.jsx
│   │       ├── MessageThread.jsx
│   │       ├── SendBox.jsx
│   │       ├── PinsPanel.jsx
│   │       ├── ImportModal.jsx
│   │       └── SearchResults.jsx
│   └── tests/
├── scripts/
│   ├── ingest.py                  # CLI transcript ingestion
│   └── test_integration.py        # Integration test suite
├── db/
│   ├── schema.dbml                # dbdiagram.io schema
│   ├── queries.sql                # 3 core queries
│   └── seed/
│       ├── init.sql               # DDL in execution order
│       ├── load_seed.py           # Loads data.json with uuid5 mapping
│       ├── data.json              # RecipeBox sample scenario
│       └── relations.md           # Explains seed data relationships
└── docs/
    ├── ROADMAP.md
    ├── 01_entities_and_scenarios.md
    ├── 02_domain_description.md
    └── 03_database_schema.md
```

---

## Deployment

### Backend (Render)
The repo includes `render.yaml` — connect the GitHub repo as a Render Blueprint. Set environment variables in the Render dashboard:
- `DATABASE_URL` — Supabase connection string
- `ANTHROPIC_API_KEY` — optional, falls back to stub

### Frontend (Vercel)
1. Connect repo to Vercel
2. Set root directory to `frontend`, framework to Vite
3. Set `VITE_API_URL` to the Render backend URL (e.g. `https://graft-backend.onrender.com/api`)
4. Deploy

After deploying, add the Vercel URL to the backend's CORS `allow_origins` in `backend/main.py`.

---

## Index Strategy

| Index | Type | Serves |
|-------|------|--------|
| `(ancestor_id, descendant_id)` PK | B-tree | Closure table lookups |
| `(descendant_id, depth)` | B-tree | "All ancestors of X" (Q1, Q2) |
| `content_tsv` | GIN | Full-text search (Q3) |
| `(conversation_id, created_at DESC)` | B-tree | Recent messages |
| `(branch_id, priority DESC)` | B-tree | Ordered pin retrieval (Q1) |
| `(target_branch_id, imported_at DESC)` | B-tree | Import listing (Q1) |
| `conversation_id WHERE is_archived=false` | Partial B-tree | Active branch filtering (Q3) |
| `(owner_id, updated_at DESC)` | B-tree | "My recent conversations" |
| `(conversation_id, name)` UNIQUE | B-tree | Branch name uniqueness |
| `summarized_node_id` | B-tree | Elision check (Q1) |
