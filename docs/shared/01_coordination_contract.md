# Coordination Contract

How DEV-A and DEV-B stay unblocked from each other during the sprint.

---

## Shared Interfaces

### Database

Single Supabase instance. Both devs use the same connection string via `.env`. No migration files for a 1-day sprint -- DDL runs once in Phase 0, done.

### Backend Structure

```
backend/
├── main.py              # FastAPI app, mounts all routers         [DEV-A owns]
├── db.py                # SQLAlchemy engine + session factory      [DEV-A owns]
├── models/
│   ├── __init__.py      # Re-exports all models                   [DEV-A creates, both add]
│   ├── core.py          # User, Conversation, Branch, Node        [DEV-A]
│   └── context.py       # NodeAncestry, pins, imports, summaries, tags, shares [DEV-B]
├── routers/
│   ├── conversations.py # Conversation CRUD                       [DEV-A]
│   ├── branches.py      # Branch CRUD + archive                   [DEV-A]
│   ├── agent.py         # POST /agent/turn                        [DEV-A]
│   ├── nodes.py         # Node CRUD                               [DEV-B]
│   ├── context.py       # Pins + imports endpoints                [DEV-B]
│   └── search.py        # Search + divergence endpoints           [DEV-B]
└── requirements.txt     # Shared                                  [DEV-A creates, both add]
```

### Frontend Structure

```
frontend/src/
├── App.jsx              # Router + layout                         [DEV-A owns]
├── api.js               # Shared API client (axios/fetch wrapper) [DEV-A owns]
├── pages/
│   ├── ConversationList.jsx   # List conversations                [DEV-A]
│   ├── ConversationView.jsx   # Main workspace                   [DEV-A]
│   └── SearchPage.jsx         # Search page                      [DEV-B]
├── components/
│   ├── BranchSidebar.jsx      # Branch list + create              [DEV-A]
│   ├── MessageThread.jsx      # Message display                   [DEV-A]
│   ├── SendBox.jsx            # Message input                     [DEV-A]
│   ├── PinsPanel.jsx          # Pins sidebar/tab                  [DEV-B]
│   ├── ImportModal.jsx        # Cherry-pick modal                 [DEV-B]
│   └── SearchResults.jsx      # Search result list                [DEV-B]
```

---

## Merge Points

Exactly **3 sync points** during the sprint:

### Merge 1 (Hour 0:30)
**What:** DEV-A pushes the initial scaffold to a shared branch.
**Contents:**
- `backend/main.py` — FastAPI app with health check + CORS middleware
- `backend/db.py` — SQLAlchemy engine + session factory (reads `DATABASE_URL` from env)
- `backend/models/__init__.py` — empty, DEV-A adds core imports, DEV-B adds context imports at Merge 2
- `backend/requirements.txt` — fastapi, uvicorn, sqlalchemy, psycopg2-binary, python-dotenv
- `frontend/` — full Vite+React+Tailwind scaffold
- `frontend/src/api.js` — **complete API client with ALL functions** (both DEV-A and DEV-B endpoints). DEV-A pre-includes stubs for DEV-B's endpoints so DEV-B never needs to edit this file.
- `frontend/src/api.js` also exports `DEFAULT_USER_ID` — set to the UUID generated for seed user "u-01" after Phase 0 seed loading
- `.env.example` — template with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `VITE_API_URL`

**DEV-B action:** Pull and start building on top. Do NOT edit `main.py`, `db.py`, or `api.js`.

### Merge 2 (Hour 4:30)
**What:** Both devs merge their backend work.

**DEV-B provides DEV-A** with the three import lines to add to `main.py`:
```python
from routers.nodes import router as nodes_router
from routers.context import router as context_router
from routers.search import router as search_router

app.include_router(nodes_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(search_router, prefix="/api")
```
**DEV-A adds these** to `main.py` (since DEV-A owns that file) and pushes.

**DEV-B also adds** their model imports to `backend/models/__init__.py`.

**Cross-validation smoke test** (each dev tests the OTHER dev's endpoints):
- DEV-A validates DEV-B's work: `POST /api/nodes`, `GET /api/search?q=recipe`, `GET /api/branches/{a}/diverge/{b}`
- DEV-B validates DEV-A's work: `POST /api/conversations`, `GET /api/nodes/{id}/context?budget=5000`, `POST /api/agent/turn`

### Merge 3 (Hour 7:30)
**What:** Frontend merge. DEV-B's components plug into DEV-A's router and layout.
**DEV-B adds:**
- `/search` route to `App.jsx`
- Pin/Import buttons into `MessageThread.jsx` (DEV-A leaves a `{/* DEV-B: action buttons */}` placeholder)
- `PinsPanel` as a collapsible sidebar in `ConversationView`

**Golden path test (local):** create conversation -> send message -> branch -> pin a node -> search -> import from search results.

---

## Conflict Avoidance Rules

1. **DEV-A owns `main.py`, `db.py`, `api.js`, `App.jsx`** -- DEV-B never edits these directly, only imports from them
2. **DEV-B adds to `main.py` only at merge point 2** via `app.include_router()` lines
3. **DEV-A leaves placeholders** in `MessageThread.jsx` for DEV-B's buttons:
   ```jsx
   {/* DEV-B: action buttons -- pin, import */}
   ```
4. **Models are in separate files** -- `core.py` (DEV-A) and `context.py` (DEV-B), no conflicts
5. **Routers are in separate files** -- each dev owns their own, no conflicts
6. **Both can add to `requirements.txt` and `package.json`** -- merge manually if conflicts arise (unlikely with different deps)

---

## Communication Protocol

- Quick Slack/Discord message at each merge point: "backend ready, pushing now"
- If blocked waiting on the other dev: work on tests, docs, or deployment config instead of idling
- If something breaks in the other dev's code: fix it and tell them, don't wait for a PR review on a 1-day sprint
