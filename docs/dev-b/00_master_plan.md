# DEV-B Master Plan — "Edits & Search Path"

You own the supporting tables, cross-branch features (pins, imports, summaries), search, divergence comparison, and the frontend components for those features.

---

## Your Deliverables

| Phase | Hours | What you deliver | Done when |
|-------|-------|------------------|-----------|
| 0 | 0:00–0:30 | Joint setup (see `docs/shared/02_phase0_setup.md`) | Trigger verified, queries confirmed, EXPLAIN output recorded |
| 1 | 0:30–3:00 | SQLAlchemy models + nodes/pins/imports/divergence/search endpoints | `curl` can create nodes, pin them, import them, search, compare branches |
| 2 | 3:00–4:30 | CLI ingestion tool + integration tests | `python -m scripts.ingest transcript.txt` works, tests pass |
| 3 | 4:30–7:30 | Frontend: search page, cherry-pick modal, pins panel | Can search, import nodes, pin/unpin in the browser |
| 4 | 7:30–9:00 | Deploy frontend to Vercel | Frontend is live, connected to backend |
| 5 | 9:00–10:00 | Write-up + README update | `docs/writeup.md` complete, deployed URLs in README |

---

## Phase 1: Backend Models + Endpoints (Hours 0:30–3:00)

### SQLAlchemy Models

Create `backend/models/context.py`:

**NodeAncestry:**
```python
class NodeAncestry(Base):
    __tablename__ = "node_ancestry"
    ancestor_id = Column(UUID, ForeignKey("nodes.id"), primary_key=True)
    descendant_id = Column(UUID, ForeignKey("nodes.id"), primary_key=True)
    depth = Column(Integer, nullable=False)
```
This model is **read-only** — the trigger maintains it. You'll never insert/update via ORM.

**ContextPin:**
- Unique constraint on `(branch_id, node_id)` — handle 409 Conflict in the endpoint
- `priority` as SmallInteger, default 0

**ContextImport:**
- `include_descendants` Boolean, default False
- `imported_at` with server_default

**NodeSummary:**
- Composite PK on `(summary_node_id, summarized_node_id)`

**Tag, NodeTag, BranchShare:**
- Straightforward, match DDL exactly
- `BranchShare.shared_with` is nullable (null = public)

### Endpoints

Create `backend/routers/nodes.py`:

**`POST /api/nodes`**
- Accepts: `{conversation_id, parent_id, branch_id, node_type, role, content}`
- Computes `token_count` as `int(len(content.split()) * 1.3)`
- Creates node (trigger auto-fills `node_ancestry`)
- Advances the branch's `head_node_id` to the new node
- Updates conversation's `updated_at`
- Returns: the new node

**`GET /api/nodes/{id}`**
- Returns: node with metadata

Create `backend/routers/context.py`:

**`POST /api/branches/{id}/pins`**
- Accepts: `{node_id, priority?, reason?, pinned_by}`
- On duplicate `(branch_id, node_id)`: return 409 Conflict
- Returns: the new pin

**`GET /api/branches/{id}/pins`**
- Returns: list of pins ordered by `priority DESC`

**`DELETE /api/pins/{id}`**
- Deletes the pin
- Returns: 204

**`POST /api/branches/{id}/imports`**
- Accepts: `{source_node_id, include_descendants?, imported_by}`
- Returns: the new import

**`GET /api/branches/{id}/imports`**
- Returns: list of imports ordered by `imported_at DESC`

**`DELETE /api/imports/{id}`**
- Deletes the import
- Returns: 204

Create `backend/routers/search.py`:

**`GET /api/branches/{a}/diverge/{b}`**
- Execute Query 2 from `db/queries.sql` via raw SQL
- Bind `:branch_a` and `:branch_b`
- Returns: `{lca_node_id, only_a_count, only_b_count, only_a_nodes, only_b_nodes}`

**`GET /api/search`**
- Query params: `q` (search text), `user_id`, `k` (default 20)
- Execute Query 3 from `db/queries.sql` via raw SQL
- Bind `:query_text`, `:user_id`, `:k`
- Returns: list of `{node_id, content, role, created_at, branch_id, branch_name, conversation_id, conversation_title, rank}`

**Implementation note:** Same as DEV-A — use `session.execute(text(SQL), params)` for Query 2 and Query 3. Don't ORM-ify these.

### Acceptance Criteria
```bash
# Create a node
curl -X POST http://localhost:8000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "...", "parent_id": "...", "branch_id": "...", "node_type": "message", "role": "user", "content": "Test node"}'

# Pin a node
curl -X POST http://localhost:8000/api/branches/<branch-id>/pins \
  -H "Content-Type: application/json" \
  -d '{"node_id": "...", "priority": 10, "reason": "Core schema", "pinned_by": "..."}'

# List pins
curl http://localhost:8000/api/branches/<branch-id>/pins

# Import a node
curl -X POST http://localhost:8000/api/branches/<branch-id>/imports \
  -H "Content-Type: application/json" \
  -d '{"source_node_id": "...", "include_descendants": true, "imported_by": "..."}'

# Search
curl "http://localhost:8000/api/search?q=recipe&user_id=...&k=10"

# Branch divergence
curl http://localhost:8000/api/branches/<id-a>/diverge/<id-b>
```

---

## Phase 2: CLI Ingestion + Integration Tests (Hours 3:00–4:30)

### CLI Ingestion Tool

Create `scripts/ingest.py`:

```
Usage: python -m scripts.ingest <transcript.txt> [--user-id UUID]
```

**Input format:** Plain text with role markers:
```
User: How do I set up a Postgres database?
Assistant: First, install PostgreSQL...
User: What about indexing?
Assistant: There are several types of indexes...
```

**Flow:**
1. Parse transcript into (role, content) pairs
2. Create or get user (use `--user-id` or a default test user)
3. Create conversation with title = filename
4. Create "main" branch
5. Create root node (system prompt: "Imported conversation")
6. Chain nodes: each node's `parent_id` = previous node's `id`
7. Backfill `root_node_id`, `default_branch_id`, branch `head_node_id`
8. Print summary: `"Created conversation {id} with {n} nodes on branch main"`

### Integration Tests

Create a simple test script `scripts/test_integration.py` (or use pytest if time allows):

**Test 1: Pin affects context assembly**
1. Create conversation + branch + 5 nodes via API
2. Pin node #2 with priority 10
3. Call `GET /nodes/{node-5}/context?budget=5000` (DEV-A's endpoint)
4. Assert pinned node appears in results with source = "pinned"

**Test 2: Divergence is correct**
1. Create conversation with main branch + 3 nodes
2. Create branch B from node #2
3. Add 2 nodes to main, 2 nodes to branch B
4. Call `GET /branches/{main}/diverge/{B}`
5. Assert LCA = node #2, only_a_count = 2, only_b_count = 2

**Test 3: Search works**
1. Create conversation with nodes containing "PostgreSQL indexing strategies"
2. Call `GET /search?q=indexing&user_id=...`
3. Assert results include the relevant node

---

## Phase 3: Frontend (Hours 4:30–7:30)

See `docs/dev-b/01_frontend_guide.md` for detailed component specs.

### Overview

You build three components that plug into DEV-A's scaffold:

**SearchPage** — top-level route at `/search`:
```
+------------------------------------------+
| Search: [_______________] [Search]       |
|                                          |
| Results:                                 |
| +--------------------------------------+ |
| | "PostgreSQL indexing strategies..."   | |
| | feat/search · RecipeBox              | |
| | Relevance: 0.89  [Import to...]      | |
| +--------------------------------------+ |
| | "Recipe CRUD endpoint models..."     | |
| | feat/recipe-crud · RecipeBox         | |
| | Relevance: 0.72  [Import to...]      | |
| +--------------------------------------+ |
+------------------------------------------+
```

**PinsPanel** — sidebar/tab inside ConversationView:
```
+-------------------+
| Pinned Context    |
| +---------------+ |
| | [P10] Schema  | |
| | "CREATE TABLE"| |
| | [Unpin]       | |
| +---------------+ |
| | [P5] Auth     | |
| | "JWT token..."| |
| | [Unpin]       | |
| +---------------+ |
+-------------------+
```

**ImportModal** — triggered from search results or message thread:
```
+----------------------------------+
| Import Node to Branch            |
|                                  |
| Source: "Recipe CRUD models..."  |
|                                  |
| Target branch: [dropdown v]      |
|   main                           |
|   feat/auth                      |
|   feat/search  <-- selected      |
|                                  |
| [ ] Include descendants          |
|                                  |
|        [Cancel] [Import]         |
+----------------------------------+
```

### Integration Points with DEV-A

At merge point 3 (hour 7:30), you:
1. Add `/search` route to `App.jsx`
2. Add "Pin" and "Import" buttons to each message in `MessageThread.jsx` (where DEV-A left the `{/* DEV-B: action buttons */}` placeholder)
3. Add `PinsPanel` toggle to `ConversationView.jsx`

---

## Phase 4: Deployment + Write-up (Hours 7:30–10:00)

### Frontend Deployment (Hours 7:30–9:00)

See `docs/dev-b/02_deployment_guide.md` for step-by-step.

**Quick version:**
1. Connect repo to Vercel
2. Set `VITE_API_URL` to DEV-A's Render backend URL
3. Deploy, verify the app loads and can hit the backend
4. Test CORS — if blocked, tell DEV-A to add your Vercel URL to allowed origins

### Write-up (Hours 9:00–10:00)

Create `docs/writeup.md` with these sections:

1. **Domain Description** — condense `02_domain_description.md` to ~300 words
2. **Entities** — table with all 11 entities, one-line description each
3. **Schema Image** — export from dbdiagram.io using `db/schema.dbml`, embed in doc
4. **Three Critical User Paths:**
   - Path 1: Start conversation → send message → receive response (covers Query 1)
   - Path 2: Branch → diverge → compare (covers Query 2)
   - Path 3: Search → find node → cherry-pick into branch (covers Query 3)
5. **Query Explanations** — for each query: what it does, why it's structured that way, EXPLAIN output
6. **Index Justifications** — table of all indexes with the query they support and performance impact
7. **Benchmark Numbers** — from Phase 0 EXPLAIN output

### README Update

Add to `README.md`:
- Deployed URL (Vercel link)
- Backend URL (Render link)
- Demo video link or screenshots

---

## Files You Own

```
backend/
├── models/context.py
├── routers/nodes.py
├── routers/context.py
├── routers/search.py
scripts/
├── ingest.py
├── test_integration.py
frontend/
├── src/pages/SearchPage.jsx
├── src/components/PinsPanel.jsx
├── src/components/ImportModal.jsx
├── src/components/SearchResults.jsx
docs/
├── writeup.md
```

## What You Get From DEV-A

- Working `db.py` with session factory
- `api.js` with base URL configured
- `App.jsx` with router — you add your `/search` route
- `MessageThread.jsx` with `{/* DEV-B: action buttons */}` placeholder
- `ConversationView.jsx` with `{/* DEV-B: pins panel */}` placeholder
- Context assembly endpoint (`GET /nodes/{id}/context`) that you can test pins/imports against
