# Graft — Git for Agent Conversations

A database-driven app that brings Git-style version control to AI agent conversations. Branch, commit, pin, cherry-pick, search, and export across long-running chats — the DB is the protagonist.

## The Problem

Long agent conversations get bloated. You want to try something speculative without polluting your main thread, or you remember solving a problem in a different chat and want to pull that context in. Today you copy-paste. Graft builds proper structure for it — and lets you take any branch directly into Claude Code with full history intact.

## Core Concepts

| Concept | What it does |
|---------|-------------|
| **Conversation** | A DAG of nodes, owned by a user |
| **Branch** | Named pointer into the DAG — like a git branch |
| **Commit** | Snapshots a run of messages into a single summary node; committed messages are elided from future context and replaced by the commit node |
| **Pin** | "Always include this node in context on this branch" |
| **Import** | Cherry-pick a node (or subtree) from another branch into context |
| **Summarize** | LLM-condenses a single node into a new summary node on a new branch |
| **Export** | Sends a branch to Claude Code as a resumable JSONL session; syncs new CC turns back on next click |

## Schema

![Database schema](db/schema.png)

11 tables: `users` · `conversations` · `nodes` · `node_ancestry` · `branches` · `context_pins` · `context_imports` · `node_summaries` · `tags` · `node_tags` · `claude_exports`

Full DDL: [`docs/03_database_schema.md`](docs/03_database_schema.md) · DBML: [`db/schema.dbml`](db/schema.dbml)

### Key design decisions

- **`nodes` is the single source of truth** for all content — messages, system prompts, and commit nodes are all rows in `nodes`, distinguished by `node_type` (`message` / `summary`) and `role` (`user` / `assistant` / `system` / `NULL`).
- **`node_ancestry`** is a closure table maintained by a DB trigger. Every ancestor-descendant pair at every depth is stored, making the context assembly query a simple join with no recursion.
- **`node_summaries`** links a commit node (`summary_node_id`) to the individual message nodes it replaced (`summarized_node_id`). The context assembly query uses this to elide committed messages from context while including the commit node itself.
- **Commit nodes** (`node_type = 'summary'`, `role = NULL`) carry the raw message transcript as their `content` field so the LLM can reconstruct history from a single node. They are injected into the system prompt by `call_llm`.

## Three Core Queries

1. **Context Assembly** (`QUERY_1_CONTEXT_ASSEMBLY` in `branches.py`) — walks ancestors via closure table, unions pinned + imported nodes, elides nodes referenced in `node_summaries`, ranks by priority/recency, truncates at token budget.
2. **Branch Divergence** — finds LCA of two branches, computes set differences for merge decisions.
3. **Full-Text Search** — `websearch_to_tsquery` + GIN index across all conversations with branch context.

Full SQL: [`db/queries.sql`](db/queries.sql)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Database | PostgreSQL (Supabase) — closure table, full-text search, GIN indexes |
| Backend | FastAPI + SQLAlchemy 2.0 |
| Frontend | React 19 + Vite + Tailwind CSS v4 |
| Graph view | ReactFlow |
| LLM | Claude API (Haiku for summarization, Sonnet for agent turns; stub fallback when no key) |
| Realtime | Server-Sent Events (in-process asyncio pub/sub via `sse.py`) |

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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/init.sql
python3 db/seed/load_seed.py
```

Creates all tables, the closure-table trigger, indexes, and loads the RecipeBox sample data (2 users, 1 conversation, 7 branches, 35 nodes).

### 3. Start the backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

`curl http://localhost:8000/health` → `{"status":"ok"}`

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**

### 5. Use the app

- **Home** (`/`) — list conversations, create new ones
- **Conversation** (`/conversations/:id`)
  - **Thread tab** — message history, send messages, hover a message for Pin / Import to... / → Claude actions
  - **Graph tab** — ReactFlow commit graph; click any node for details, branch-from-here, or summarize-into-new-branch
  - **Left sidebar** — branch list, commit input (type a message and press Enter or click Commit)
  - **Header** — Pins panel, Imports panel, Sync from Claude button
- **Search** (`/search`) — full-text search across all conversations

---

## Running Tests

```bash
# Backend (needs running DB)
cd backend && source venv/bin/activate && pytest -v

# SSE + commit integration tests
cd backend && pytest tests/test_commit_sse.py -v
```

---

## API Endpoints

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/conversations` | Create conversation (conv + branch + root node, atomic) |
| GET | `/api/conversations?owner_id=` | List user's conversations |
| GET | `/api/conversations/{id}` | Get conversation with branches |
| GET | `/api/conversations/{id}/nodes` | All visible nodes (excludes committed messages) |
| GET | `/api/conversations/{id}/stream` | SSE stream for live updates |

### Branches
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/conversations/{id}/branches` | Fork a new branch |
| GET | `/api/branches/{id}` | Get branch details |
| POST | `/api/branches/{id}/archive` | Archive a branch |
| POST | `/api/branches/{id}/commit` | Commit recent messages into a summary node |
| POST | `/api/branches/{id}/sync-claude` | Pull new CC turns from prior export sessions |

### Agent
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/turn` | Send message, get AI response; publishes SSE events |

### Nodes
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/nodes` | Create a node |
| GET | `/api/nodes/{id}` | Get a node |
| GET | `/api/nodes/{id}/context?budget=N` | Context assembly (Query 1) |
| POST | `/api/nodes/{id}/summarize` | LLM-summarize node into new branch |
| POST | `/api/nodes/{id}/export-claude?launch=` | Export branch to Claude Code JSONL session |

### Pins & Imports
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/branches/{id}/pins` | Pin a node to a branch |
| GET | `/api/branches/{id}/pins` | List pins (ordered by priority) |
| DELETE | `/api/pins/{id}` | Remove a pin |
| POST | `/api/branches/{id}/imports` | Import (cherry-pick) a node |
| GET | `/api/branches/{id}/imports` | List imports |
| DELETE | `/api/imports/{id}` | Remove an import |

### Search & Divergence
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search?q=&user_id=&k=` | Full-text search (Query 3) |
| GET | `/api/branches/{a}/diverge/{b}` | Branch divergence report (Query 2) |

### Tags
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create a tag (idempotent) |
| GET | `/api/nodes/{id}/tags` | Get tags for a node |
| PUT | `/api/nodes/{id}/tags` | Replace tag set on a node |

### Users
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/users/register` | Register a new user |
| POST | `/api/users/login` | Login with email/password |

### SSE Event Types

All mutation endpoints publish to `GET /api/conversations/{id}/stream`. The frontend listens and updates state in real time.

| Event | Payload |
|-------|---------|
| `node_created` | `{ node }` |
| `branch_updated` | `{ branch }` |
| `pin_created` | `{ pin }` |
| `pin_deleted` | `{ pin_id }` |
| `import_created` | `{ import }` |
| `import_deleted` | `{ import_id }` |
| `commit_created` | `{ node, branch, summarized_node_ids[] }` |
| `node_tags_updated` | `{ node_id, tags[] }` |

---

## Repository Structure

```
Graft/
├── README.md
├── CLAUDE.md                          # Agentic dev guidance
├── .env.example
├── render.yaml                        # Render Blueprint for backend deploy
├── backend/
│   ├── main.py                        # FastAPI app — mounts all 9 routers
│   ├── helpers.py                     # Shared serialization helpers
│   ├── db.py                          # SQLAlchemy engine + session
│   ├── llm.py                         # Claude API client + stub fallback
│   ├── sse.py                         # In-process asyncio pub/sub + heartbeat
│   ├── schemas.py                     # Pydantic request models
│   ├── requirements.txt
│   ├── models/
│   │   ├── core.py                    # User, Conversation, Node, Branch
│   │   └── context.py                 # NodeAncestry, Pins, Imports, NodeSummary,
│   │                                  #   ClaudeExport, Tags, Shares
│   ├── routers/
│   │   ├── conversations.py           # Conversation CRUD + SSE stream endpoint
│   │   ├── branches.py                # Branch CRUD + commit + context assembly (Q1)
│   │   ├── agent.py                   # Agent turn (insert nodes, call LLM, SSE publish)
│   │   ├── nodes.py                   # Node CRUD + summarize endpoint
│   │   ├── context.py                 # Pins + imports endpoints
│   │   ├── search.py                  # FTS search (Q3) + divergence (Q2)
│   │   ├── export.py                  # Export to Claude Code + sync-back
│   │   ├── tags.py                    # Tag CRUD + node tag assignment
│   │   └── users.py                   # User registration + login
│   └── tests/
│       └── test_commit_sse.py
├── frontend/
│   ├── src/
│   │   ├── api.js                     # All API calls + DEFAULT_USER_ID
│   │   ├── App.jsx                    # Router + nav shell
│   │   ├── pages/
│   │   │   ├── ConversationList.jsx
│   │   │   ├── ConversationView.jsx   # Main view: SSE listener, all state, graph+thread tabs
│   │   │   ├── SearchPage.jsx         # Full-text search + tag facets
│   │   │   ├── LoginPage.jsx          # User authentication
│   │   │   └── RegisterPage.jsx       # User registration
│   │   └── components/
│   │       ├── BranchSidebar.jsx      # Branch list + commit input
│   │       ├── ConversationGraph.jsx  # ReactFlow commit graph + search overlay
│   │       ├── MessageThread.jsx      # Thread view + optimistic messages + export button
│   │       ├── SendBox.jsx            # Chat input with optimistic send
│   │       ├── PinsPanel.jsx
│   │       ├── ImportModal.jsx
│   │       ├── SearchResults.jsx
│   │       └── TagPopover.jsx         # Tag editor popover
├── db/
│   ├── schema.dbml                    # dbdiagram.io source
│   ├── schema.png                     # Schema diagram image
│   ├── queries.sql                    # 3 core queries
│   └── seed/
│       ├── init.sql                   # DDL in execution order
│       ├── load_seed.py
│       └── data.json                  # RecipeBox sample scenario
└── docs/
    ├── known-bugs.md                  # Active known issues
    ├── ROADMAP.md
    └── ...
```

---

## Deployment

### Backend (Render)
Connect the GitHub repo as a Render Blueprint (`render.yaml`). Set env vars in the Render dashboard:
- `DATABASE_URL` — Supabase connection string
- `ANTHROPIC_API_KEY` — optional, stubs when absent

### Frontend (Vercel)
1. Connect repo, set root directory to `frontend`, framework to Vite
2. Set `VITE_API_URL` to the Render backend URL
3. Add the Vercel URL to `allow_origins` in `backend/main.py`
