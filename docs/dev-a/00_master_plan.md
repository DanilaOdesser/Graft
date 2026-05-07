# DEV-A Master Plan — "Tree & Read Path"

You own the core conversation infrastructure: the tables that make conversations work, the context assembly query, the agent stub, and the main frontend layout.

---

## Your Deliverables

| Phase | Hours | What you deliver | Done when |
|-------|-------|------------------|-----------|
| 0 | 0:00–0:30 | Joint setup (see `docs/shared/02_phase0_setup.md`) | DB up, DDL run, seed loaded, queries verified |
| 1 | 0:30–3:00 | SQLAlchemy models + conversation/branch/context endpoints | `curl` can create conversations, branches, and get assembled context |
| 2 | 3:00–4:30 | Agent stub endpoint + integration test | `POST /agent/turn` works end-to-end |
| 3 | 4:30–7:30 | Frontend: scaffold, DAG sidebar, message thread, send box | Can use the app in browser: create conversation, send messages, see responses |
| 4 | 7:30–9:00 | Deploy backend to Render | Backend is live at a public URL, `/health` returns 200 |
| 5 | 9:00–10:00 | Polish: e2e test, demo recording, README update | Golden path works on deployed app |

---

## Phase 1: Backend Models + Core Endpoints (Hours 0:30–3:00)

### SQLAlchemy Models

Create `backend/models/core.py`:

**User model:**
```python
class User(Base):
    __tablename__ = "users"
    id = Column(UUID, primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String(255), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
```

**Conversation model:**
- `owner_id` FK to users
- `root_node_id` and `default_branch_id` are nullable (backfilled after creation)
- Include `updated_at`

**Node model:**
- All columns from DDL
- **Skip `content_tsv`** — it's a generated column, read-only in SQLAlchemy. Don't map it.
- `token_count` defaults to 0 — compute it in the endpoint using `int(len(content.split()) * 1.3)` (rough word-to-token ratio). Both devs MUST use this same formula for consistency.

**Branch model:**
- `head_node_id` and `base_node_id` nullable
- `is_archived` defaults to False

### Endpoints

Create `backend/routers/conversations.py`:

**`POST /api/conversations`**
- Accepts: `{title, owner_id}`
- In one transaction:
  1. Create conversation (without root_node_id, default_branch_id)
  2. Create "main" branch (head_node_id=null, base_node_id=null)
  3. Create root node (parent_id=null, branch_id=main, role='system', content="You are a helpful AI assistant. This conversation is managed by Graft.")
  4. Update conversation: set root_node_id and default_branch_id
  5. Update branch: set head_node_id to root node
- Returns: conversation with branch and root node

**`GET /api/conversations`**
- Query param: `owner_id`
- Returns: list of conversations sorted by `updated_at DESC`

**`GET /api/conversations/{id}`**
- Returns: conversation with its branches (non-archived)

Create `backend/routers/branches.py`:

**`POST /api/conversations/{conv_id}/branches`**
- Accepts: `{name, fork_node_id, created_by}`
- Creates branch with `base_node_id = fork_node_id`, `head_node_id = fork_node_id`
- Returns: the new branch

**`GET /api/branches/{id}`**
- Returns: branch with head and base node info

**`POST /api/branches/{id}/archive`**
- Sets `is_archived = true`
- Returns: 204

**`GET /api/nodes/{node_id}/context`**
- Query param: `budget` (default 4096)
- **Execute Query 1 from `db/queries.sql` via raw SQL** using `text()`
- Bind `:current_node_id` and `:budget`
- Returns: ordered list of `{id, source, pin_priority, depth, token_count, running_tokens, content}`

**Key implementation note for Query 1:** Use `session.execute(text(QUERY_1_SQL), {"current_node_id": node_id, "budget": budget})` — don't try to translate the CTE chain into ORM.

### Acceptance Criteria
```bash
# Create a conversation
curl -X POST http://localhost:8000/api/conversations \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "owner_id": "<user-uuid>"}'

# List conversations
curl http://localhost:8000/api/conversations?owner_id=<user-uuid>

# Create a branch
curl -X POST http://localhost:8000/api/conversations/<conv-id>/branches \
  -H "Content-Type: application/json" \
  -d '{"name": "feat/test", "fork_node_id": "<node-uuid>", "created_by": "<user-uuid>"}'

# Get assembled context
curl http://localhost:8000/api/nodes/<node-uuid>/context?budget=5000
```

---

## Phase 2: Agent Stub (Hours 3:00–4:30)

### Endpoint

Create `backend/routers/agent.py`:

**`POST /api/agent/turn`**
- Accepts: `{node_id, user_message, budget?}`
- Flow:
  1. Look up the node to get its `branch_id` and `conversation_id`
  2. Create a new `user` node: `parent_id = node_id`, content = user_message
  3. Advance branch `head_node_id` to the new user node
  4. Call `assemble_context(new_node_id, budget)` — reuse Query 1
  5. Format assembled context as a message list for the LLM
  6. Call Claude API (or return a stub response: `"[Stub] I received your message with {n} context nodes totaling {t} tokens."`)
  7. Create an `assistant` node: `parent_id = user_node_id`, content = LLM response
  8. Advance branch head again
  9. Return: `{user_node, assistant_node, context_used: {node_count, total_tokens}}`

### Token Counting

Both devs use the same formula: `token_count = int(len(content.split()) * 1.3)` (rough word-to-token ratio). Good enough for the demo. Do NOT use `tiktoken` — keep it consistent.

### Claude API Integration (optional, time permitting)

```python
from anthropic import Anthropic

client = Anthropic()  # reads ANTHROPIC_API_KEY from env

def call_llm(context_nodes):
    messages = [
        {"role": node["role"] or "user", "content": node["content"]}
        for node in context_nodes
        if node["role"] in ("user", "assistant")
    ]
    system = "\n".join(
        node["content"] for node in context_nodes if node["role"] == "system"
    )
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system,
        messages=messages,
    )
    return response.content[0].text
```

If no API key, fall back to the stub response. Don't let this block progress.

### Acceptance Criteria
```bash
# Send a message
curl -X POST http://localhost:8000/api/agent/turn \
  -H "Content-Type: application/json" \
  -d '{"node_id": "<head-node-uuid>", "user_message": "Hello, what can you help me with?"}'

# Response should include user_node, assistant_node, and context_used
```

---

## Phase 3: Frontend (Hours 4:30–7:30)

See `docs/dev-a/01_frontend_guide.md` for detailed component specs.

### Overview

Three pages, simple layout:

```
/                       -> ConversationList
/conversations/:id      -> ConversationView (main workspace)
```

**ConversationView layout:**
```
+-------------------+-------------------------------+
| Branch Sidebar    | Message Thread                |
| - main           | [system] You are a helpful... |
| - feat/auth      | [user] Hello world            |
| - feat/recipe *  | [assistant] Hi there!         |
|                   |                               |
| [+ New Branch]   | [DEV-B: PinsPanel toggle]     |
|                   |                               |
|                   | +---------------------------+ |
|                   | | Send a message...    [Send]| |
|                   | +---------------------------+ |
+-------------------+-------------------------------+
```

**Key shortcut:** The branch sidebar is a flat list with fork-point info, NOT a graph visualization. This saves 2+ hours.

### Acceptance Criteria
- Can create a conversation from the list page
- Can see branches in the sidebar, click to switch
- Can see message thread for the selected branch
- Can send a message and see the response appear
- Can create a new branch from a fork-point node

---

## Phase 4: Deployment (Hours 7:30–9:00)

See `docs/dev-a/02_deployment_guide.md` for step-by-step.

### Quick Version

1. Create `Dockerfile` or use Render's Python environment
2. Set env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY` (optional)
3. Add CORS middleware allowing DEV-B's Vercel URL
4. Deploy, verify `GET /health` returns 200
5. Test one endpoint against the deployed backend

---

## Files You Own

```
backend/
├── main.py
├── db.py
├── models/core.py
├── routers/conversations.py
├── routers/branches.py
├── routers/agent.py
frontend/
├── src/App.jsx
├── src/api.js
├── src/pages/ConversationList.jsx
├── src/pages/ConversationView.jsx
├── src/components/BranchSidebar.jsx
├── src/components/MessageThread.jsx
├── src/components/SendBox.jsx
```

## What You Leave for DEV-B

- `{/* DEV-B: action buttons */}` placeholder in `MessageThread.jsx` on each message bubble
- `{/* DEV-B: pins panel */}` placeholder in `ConversationView.jsx` sidebar area
- Router slot in `App.jsx` for `/search` route (add a comment: `{/* DEV-B: add SearchPage route */}`)
