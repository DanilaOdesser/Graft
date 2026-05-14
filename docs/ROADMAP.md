# Implementation Roadmap

> **Status: All phases completed.** This was the original implementation plan. All tasks across both developers have been delivered. The project is fully functional with schema, seed data, all 3 queries, 9 API routers, full frontend with graph/thread/search views, SSE real-time updates, tag system, and Claude Code export integration.

A two-developer plan for shipping the v1 scope from `README.md`. Work is split so each developer owns roughly equal effort and an equal share of database-touching work (schema, triggers, queries, indexes, seed data, ORM models).

---

## Roles at a glance

| | **Dev A — "Tree & Read path"** | **Dev B — "Edits & Search path"** |
|---|---|---|
| Schema tables | `users`, `conversations`, `branches`, `nodes` | `node_ancestry`, `node_summaries`, `context_pins`, `context_imports`, `tags`, `node_tags`, `branch_shares` |
| Triggers | Closure-table maintenance trigger (implementation) | Trigger spec + pgTAP/SQL tests for trigger correctness |
| Queries | Q1 (context assembly) | Q2 (branch divergence), Q3 (FTS search) |
| Indexes | `idx_nodes_conv_recent`, `idx_nodes_content_tsv` (GIN), `idx_branch_active` (partial) | `idx_ancestry_desc_depth`, `idx_pins_branch_priority`, `idx_imports_target_recent`, branch-share unique |
| Seed data | Users, conversations, branches | Nodes (transcript ingest), ancestry, pins, imports, summaries, social layer |
| Backend | Conversations, branches, context-assembly, LLM stub | Nodes, pins, imports, divergence, FTS search, CLI ingestion |
| Frontend | Branch DAG view, conversation/message reader | Cherry-pick UI, pins UI, search UI |
| Deployment | Backend (Render) + DB (Supabase) | Frontend (Vercel) + write-up |

---

## Phase 0 — Setup (day 1, both)

Both devs together — short, blocks everything else.

- [x] Decide on Python version, Node version, formatter/linter (ruff + prettier).
- [x] Create Postgres database on Supabase. Note the connection string.
- [x] Repo scaffolding: `/db`, `/backend`, `/frontend`, `/scripts`, `/docs`.
- [x] `db/migrations/` with a simple migration runner (Alembic, or hand-rolled `psql -f`).
- [x] Shared `.env.example` and `Makefile` targets: `make db-reset`, `make seed`, `make dev`.
- [x] Branch protection: PRs only, no direct commits to `main`.

---

## Phase 1 — Schema & migrations (days 2–3)

### Dev A
- [x] DDL for `users`, `conversations`, `branches` (3 tables). Foreign keys, defaults, `updated_at` trigger on `conversations`.
- [x] DDL for `nodes` including the `content_tsv` generated column:
  ```sql
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
  ```
- [x] **Closure-table trigger**: `AFTER INSERT ON nodes` populates `node_ancestry` by copying the parent's ancestor rows + adding self. `AFTER UPDATE ON nodes` (parent change → re-derive — defer if mutability isn't needed for v1).
- [x] Indexes owned by Dev A:
  - `idx_nodes_conv_recent` on `nodes(conversation_id, created_at DESC)`
  - `idx_nodes_content_tsv` GIN on `nodes(content_tsv)`
  - `idx_branch_active` partial on `branches(conversation_id) WHERE is_archived = false`
  - `idx_conv_owner_recent` on `conversations(owner_id, updated_at DESC)`

### Dev B
- [x] DDL for `node_ancestry`, `node_summaries`, `context_pins`, `context_imports`, `tags`, `node_tags`, `branch_shares` (7 tables).
- [x] **Trigger tests**: write SQL that inserts a small DAG and asserts `node_ancestry` contents are correct (depth values + ancestor-of-self row + transitive ancestors). Run as part of `make db-test`.
- [x] Indexes owned by Dev B:
  - `idx_ancestry_desc_depth` on `node_ancestry(descendant_id, depth)`
  - `idx_pins_branch_priority` on `context_pins(branch_id, priority DESC)`
  - `idx_imports_target_recent` on `context_imports(target_branch_id, imported_at DESC)`
  - Unique `(branch_id, shared_with)` on `branch_shares`
  - Unique `(conversation_id, name)` on `branches` (cross-cuts; coordinate with Dev A)
- [x] Maintain `schema.dbml` and export the dbdiagram.io PNG into `docs/`.

**Checkpoint:** `make db-reset` produces an empty schema both can read.

---

## Phase 2 — Seed data (days 4–5)

Faker for the social layer; real-ish transcripts for `nodes` content (so FTS produces meaningful results).

### Dev A
- [x] `scripts/seed_users.py` — ~20 users, deterministic UUIDs (so Dev B's seeds can reference them).
- [x] `scripts/seed_conversations.py` — ~50 conversations across users, ~3 branches per conversation (incl. `main`).
- [x] Backfill `default_branch_id` and `root_node_id` after Dev B's nodes seed runs.

### Dev B
- [x] `scripts/seed_nodes.py` — ingest 5–10 real-ish chat transcripts (split into messages; chain `parent_id`). Trigger should auto-fill `node_ancestry`.
- [x] `scripts/seed_pins.py`, `seed_imports.py`, `seed_summaries.py` — sprinkle pins, cross-branch imports (so Q1's union has work to do), and a few summary nodes.
- [x] `scripts/seed_social.py` — tags, node_tags, branch_shares via Faker.
- [x] `make seed` runs everything in order.

**Checkpoint:** `SELECT COUNT(*) FROM node_ancestry` returns the expected number of (ancestor, descendant) pairs.

---

## Phase 3 — Queries & benchmarking (days 6–7)

Each dev implements their queries, runs `EXPLAIN (ANALYZE, BUFFERS)`, and records before/after timing in `docs/benchmarks.md`.

### Dev A
- [x] **Query 1 — Context assembly**: implement parameterized SQL from `queries.sql`. Wrap in a SQL function `assemble_context(node_id uuid, budget int)` returning the ordered set.
- [x] Benchmark: 1k nodes, 10k nodes, 100k nodes; chart cumulative time.
- [x] Verify the closure-table index is used (no Seq Scan on `node_ancestry`).

### Dev B
- [x] **Query 2 — Branch divergence**: parameterized SQL; wrap as `branch_diverge(a uuid, b uuid)`.
- [x] **Query 3 — FTS search**: parameterized SQL using `websearch_to_tsquery`; wrap as `search_nodes(user_id uuid, q text, k int)`.
- [x] Benchmark Q3 with and without the GIN index (drop/recreate to show speedup).
- [x] Confirm Q2 uses `idx_ancestry_desc_depth`.

**Checkpoint:** `docs/benchmarks.md` has three index-justification entries.

---

## Phase 4 — Backend API (days 8–10)

FastAPI + SQLAlchemy. One app, two routers split by ownership. Each dev writes their own SQLAlchemy models for the tables they own.

### Dev A
- [x] `backend/models/` — SQLAlchemy models for `users`, `conversations`, `branches`, `nodes`.
- [x] Endpoints:
  - `POST /conversations` / `GET /conversations` / `GET /conversations/{id}`
  - `POST /branches` / `GET /branches/{id}` / `POST /branches/{id}/archive`
  - `GET /nodes/{id}/context?budget=N` — calls `assemble_context()`
- [x] **LLM stub agent**: `POST /agent/turn` takes `{node_id, user_message}`, calls `assemble_context`, sends to Claude API, persists assistant reply as a new node, returns it.

### Dev B
- [x] `backend/models/` — SQLAlchemy models for `node_ancestry`, `node_summaries`, `context_pins`, `context_imports`, `tags`, `node_tags`, `branch_shares`.
- [x] Endpoints:
  - `POST /nodes` / `GET /nodes/{id}`
  - `POST /branches/{id}/pins` / `DELETE /pins/{id}`
  - `POST /branches/{id}/imports` / `DELETE /imports/{id}`
  - `GET /branches/{a}/diverge/{b}` — calls `branch_diverge()`
  - `GET /search?q=...&k=...` — calls `search_nodes()`
- [x] **CLI ingestion tool**: `python -m scripts.ingest <transcript.txt>` creates conversation + main branch + chained nodes.

**Checkpoint:** Both routers pass an integration test that hits the DB.

---

## Phase 5 — Frontend (days 11–13)

React + minimal styling (Tailwind or plain CSS). Shared API client, split UI ownership.

### Dev A
- [x] App scaffold (Vite + React + Router).
- [x] **Branch DAG view**: render the node graph for a conversation (use `react-flow` or hand-drawn SVG). Color-code by branch.
- [x] **Conversation reader**: select a node → show assembled context + the message thread up to it.
- [x] Hook up `POST /agent/turn` to a "send message" box.

### Dev B
- [x] **Cherry-pick UI**: from a node in any branch, "import into…" dropdown of target branches.
- [x] **Pins UI**: pin/unpin node on current branch; show pinned panel.
- [x] **Search UI**: search bar → list of `GET /search` results with branch + conversation crumbs; click → navigate to node.

**Checkpoint:** golden-path demo (ingest transcript → branch → cherry-pick → search → agent turn) works end-to-end on `localhost`.

---

## Phase 6 — Deployment & write-up (days 14–15)

### Dev A
- [x] Push Postgres schema + seed to Supabase.
- [x] Deploy backend to Render (or PythonAnywhere). Set env vars. Confirm `/health` is up.
- [x] Record demo video (golden path + branch divergence).

### Dev B
- [x] Deploy frontend to Vercel. Wire `VITE_API_URL` to Dev A's backend.
- [x] Write `docs/writeup.md`: domain description, entities, three critical user paths, schema-image embed, query explanations, index justifications, benchmark numbers.
- [x] Add the deployed URL + demo video link to `README.md`.

---

## Database-work balance check

| Area | Dev A | Dev B |
|---|---|---|
| Tables in DDL | 4 (incl. complex `nodes` w/ tsvector) | 7 (incl. closure table & social layer) |
| Trigger work | Implementation | Spec + tests |
| Queries | Q1 (showpiece) | Q2 + Q3 |
| Indexes | 4 | 5 |
| Seed scripts | 2 (users, conversations) | 4 (nodes, pins/imports, summaries, social) |
| ORM models | 4 | 7 |
| SQL functions wrapped | `assemble_context` | `branch_diverge`, `search_nodes` |

Roughly even on count; Dev A carries the heaviest single artifacts (closure trigger + Query 1), Dev B carries the breadth (more tables, more seed surface, two queries). Adjust mid-sprint if one side is starving.

---

## Coordination rituals

- 15-min sync at start of each phase to confirm interface contracts (table columns, API shapes).
- All schema changes go through a migration file in `db/migrations/` — never edit a previous migration.
- PRs require the other dev's review before merge.
