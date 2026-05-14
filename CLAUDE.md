# CLAUDE.md — Graft Development Guide

## Project overview

Graft is a Git-inspired conversation manager for AI agents. The core abstraction is a DAG of **nodes** (messages) with named **branches**, stored in PostgreSQL using a closure table (`node_ancestry`) for ancestor lookups. The backend is FastAPI; the frontend is React + Vite + Tailwind + ReactFlow.

**Never commit directly to `main`.** Always use feature branches.

---

## Running the dev environment

```bash
# Terminal 1 — backend
cd backend && source venv/bin/activate && uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Backend: http://localhost:8000 · Frontend: http://localhost:5173

---

## Architecture

### Data model (what matters most)

- **`nodes`** — every piece of content: user messages, assistant replies, system prompts, and commit nodes. Distinguished by `node_type` (`message` | `summary`) and `role` (`user` | `assistant` | `system` | `NULL`).
- **`node_ancestry`** — closure table. A trigger on `nodes` INSERT populates all ancestor-descendant pairs including `(self, self, depth=0)`. Never write to this table manually.
- **`node_summaries`** — links a commit node to the message nodes it replaced. The context assembly query (`QUERY_1_CONTEXT_ASSEMBLY` in `routers/branches.py`) uses this to elide committed messages while including the commit node.
- **Commit nodes** have `node_type = 'summary'` and `role = NULL` (the DB has a CHECK constraint — do not set `role = 'summary'`). Their `content` is `"{commit_message}\n\n{raw_transcript}"`.
- **`branches.head_node_id`** always points to the latest node on that branch.

### Context assembly (Query 1)

`GET /api/nodes/{id}/context` and the agent turn both use `QUERY_1_CONTEXT_ASSEMBLY`. It:
1. Walks the ancestry closure table from `current_node_id`
2. Unions pinned nodes (from `context_pins`) and imported nodes (from `context_imports`)
3. Elides nodes that appear in `node_summaries.summarized_node_id`
4. Ranks and truncates at the token budget

The query is in `routers/branches.py`. Do not duplicate it.

### LLM pipeline

`routers/agent.py` → `llm.call_llm(llm_context)`:
- Context rows are augmented with `role` **and** `node_type` via a secondary DB fetch (see `agent.py` lines ~108–118).
- `call_llm` in `llm.py` puts system nodes in the system prompt, puts commit/summary nodes in the system prompt as `[Committed context]\n{content}` blocks, and builds the messages array from user/assistant ancestors only.
- Falls back to a stub reply when `ANTHROPIC_API_KEY` is not set.

### SSE (realtime updates)

`sse.py` maintains an in-process `dict[str, list[asyncio.Queue]]`. Every mutation endpoint calls `await publish(conv_id, event_type, payload)` after committing. The frontend listens on `GET /api/conversations/{id}/stream`.

All 8 event types and their handlers are in `ConversationView.jsx`. If you add a new mutation, publish an SSE event and handle it there.

### Commit flow

`POST /api/branches/{id}/commit`:
1. Walks ancestors from head, stops at an existing summary/system node (`previous_visible`)
2. Creates a `Node` with `node_type='summary'`, `parent_id=previous_visible.id` (NOT the last message — this is what keeps the graph connected)
3. Creates `NodeSummary` rows linking the new node to each uncommitted message
4. Advances `branch.head_node_id`
5. Publishes `commit_created` with `summarized_node_ids`

The frontend `commit_created` handler filters those IDs from `allNodes` and appends the new commit node.

### Graph view

`ConversationGraph.jsx` renders only "visible" nodes: `node_type === 'summary'` OR root (`!parent_id`). Individual message nodes are excluded. Edges walk up `nodeDataMap` via `findVisibleAncestor()` when a node's direct parent isn't visible (handles mid-message forks).

`SearchOverlay` is mounted *inside* `<ReactFlow>` so it can call `useReactFlow().fitView()`.

### Export to Claude Code

`routers/export.py` (`POST /nodes/{id}/export-claude`):
- Linearizes ancestry oldest-first, writes a JSONL file to `~/.claude/projects/<encoded-cwd>/`
- On macOS with `launch=true`, spawns Terminal via AppleScript
- Records a `ClaudeExport` row so subsequent syncs can diff new CC turns
- Commit/summary nodes are injected into the preamble as `[Committed context]` blocks.

---

## Conventions

### Backend

- All mutation endpoints must be `async def` and call `await publish(...)` after `db.commit()`.
- Capture IDs **before** delete; `db.delete(obj)` then `db.commit()` makes the object unusable.
- Use `db.flush()` → work with the object → `db.commit()` when you need the generated ID mid-transaction.
- Shared helpers (`branch_to_dict`, `node_to_dict`, `token_count`) live in `helpers.py`. Import from there — never redefine locally.

### Frontend

- All API calls go through `src/api.js`. Add new endpoints there.
- State that changes via SSE (branches, allNodes, pins, imports) should not be refetched manually — the SSE handler is the source of truth. `refreshContext()` is the exception: it fetches thread context because SSE doesn't stream content body.
- `pendingMessages` in `ConversationView` hold optimistic user + loading-indicator nodes. They are cleared when `refreshContext()` succeeds.
- `isHeadSummary` (`useMemo` in `ConversationView`) controls whether the Commit button is disabled.

### Branching and commits

- Never commit to `main` directly.
- Feature branches: `dev-a/...` (DEV-A work) or `dev-b/...` (DEV-B work).
- Commit after each logical unit of work.

---

## Known issues

See [`docs/known-bugs.md`](docs/known-bugs.md) — all known bugs have been resolved.

---

## File map (quick reference)

| What you're touching | Where to look |
|----------------------|---------------|
| Shared serialization helpers | `helpers.py` — `branch_to_dict`, `node_to_dict`, `token_count` |
| Context assembly SQL | `routers/branches.py` — `QUERY_1_CONTEXT_ASSEMBLY` |
| LLM call + system prompt | `llm.py` — `call_llm` |
| Agent turn (insert nodes, call LLM) | `routers/agent.py` |
| Commit logic | `routers/branches.py` — `commit_branch` |
| Node summarization | `routers/nodes.py` — `summarize_node` |
| SSE pub/sub | `sse.py` |
| Export to Claude Code | `routers/export.py` |
| Tags CRUD + node tagging | `routers/tags.py` |
| User registration + login | `routers/users.py` |
| DB models | `models/core.py`, `models/context.py` |
| All frontend state + SSE listener | `pages/ConversationView.jsx` |
| Commit graph rendering | `components/ConversationGraph.jsx` |
| Thread rendering + export button | `components/MessageThread.jsx` |
| Commit input | `components/BranchSidebar.jsx` |
| Tag editor popover | `components/TagPopover.jsx` |
| Full-text search + tag facets | `pages/SearchPage.jsx` |
