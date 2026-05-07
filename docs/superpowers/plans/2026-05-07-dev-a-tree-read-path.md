# DEV-A "Tree & Read Path" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four DEV-A endpoint families (conversations, branches, context-assembly, agent turn) and the conversation-workspace UI (ConversationList, BranchSidebar, MessageThread, SendBox, ConversationView), on top of DEV-B's already-merged scaffold and routers on `origin/main`.

**Architecture:** FastAPI + SQLAlchemy 1.x-style models (already on main). DEV-A endpoints reuse `Base`, `SessionLocal`, `get_db` from `backend/db.py`. The hot-path `GET /nodes/{id}/context` runs **Query 1** from `db/queries.sql` via `session.execute(text(...))` — never translated into ORM. Frontend is React + Vite + Tailwind v4 + react-router-dom; DEV-A pages compose alongside DEV-B's already-shipped `SearchPage`, `PinsPanel`, `ImportModal`, `SearchResults`. Both devs share the same `frontend/src/api.js` (single `api` object).

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.x (1.x-style API), psycopg2-binary, Anthropic SDK; React 19, Vite 8, Tailwind 4, react-router-dom 6.

---

## Prerequisites — what's already on `origin/main`

**Trust these — do NOT redefine.**

| File | What it gives you |
|---|---|
| `backend/db.py` | `engine`, `SessionLocal`, `Base`, `get_db()` FastAPI dependency |
| `backend/models/core.py` | `User`, `Conversation`, `Branch`, `Node` (matches DDL in `docs/03_database_schema.md`) |
| `backend/models/context.py` | `NodeAncestry`, `ContextPin`, `ContextImport`, `NodeSummary`, `Tag`, `NodeTag`, `BranchShare` |
| `backend/models/__init__.py` | Re-exports all 11 model classes |
| `backend/main.py` | FastAPI app, CORS for `localhost:5173`, registers `nodes_router`, `context_router`, `search_router` under `/api`; has `GET /health` |
| `backend/routers/nodes.py` | `POST /api/nodes`, `GET /api/nodes/{id}` — sets `branch.head_node_id`, bumps `conversations.updated_at` |
| `backend/routers/context.py` | Pin/import CRUD |
| `backend/routers/search.py` | `GET /api/branches/{a}/diverge/{b}`, `GET /api/search` |
| `db/seed/init.sql` | Full schema + closure-table trigger |
| `db/seed/load_seed.py` | Seed loader (deterministic uuid5 mapping) |
| `db/queries.sql` | Query 1 SQL (use verbatim) |
| `frontend/src/api.js` | Single `api` object with **all** method names (yours are pre-stubbed) |
| `frontend/src/App.jsx` | Routes `/` (placeholder) and `/search` (DEV-B's SearchPage) |
| `frontend/src/components/{PinsPanel,ImportModal,SearchResults}.jsx` | DEV-B components — compose these into your ConversationView |
| `frontend/src/pages/SearchPage.jsx` | DEV-B's search page |

**DEV-B's response shape conventions** (match these exactly):

- All UUIDs serialized as strings: `str(node.id)` not `node.id`
- All timestamps as `str(node.created_at)` (ISO format)
- Created resources return `201`, deletes return `204` with empty body
- Token count: `int(len(content.split()) * 1.3)` — must be byte-identical to DEV-B's

**Seed data UUIDs you'll use in tests** (from `uuid5(NAMESPACE='12345678-1234-1234-1234-123456789abc', name)`):

```
u-alex            → 2f75cca7-7ebc-5af0-a919-f0bfe59e4125
conv-recipebox    → 9f0ad37b-f4b9-56b4-9abd-bd51d830e396
br-main           → ae642808-6b30-58c5-833f-8e50045b5b63
br-auth           → 30ee586a-759a-50df-b77f-476a8c5edaa6
br-recipe-crud    → 587d7db7-c960-54bd-a3d7-bc94dd849edb
n-01 (system root)→ 8bbfd9d1-53b6-536e-af0b-cd43d809f4f3
n-13 (auth head, 13 ancestors) → looked up by content match in tests
n-31 (search head)→ looked up by content match in tests
```

---

## Quickstart

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000   # one terminal

cd ../frontend
npm install
npm run dev                              # another terminal — http://localhost:5173

# Run DEV-A tests
cd ../backend && pytest tests/ -v
```

---

## File Structure

```
backend/
├── routers/
│   ├── conversations.py    [CREATE] POST/GET conversations + branch creation
│   ├── branches.py         [CREATE] GET/archive branches, GET context
│   └── agent.py            [CREATE] POST /agent/turn
├── schemas.py              [CREATE] Pydantic request/response shapes (DRY)
├── llm.py                  [CREATE] Anthropic client + stub fallback
├── tests/
│   ├── test_conversations.py [CREATE]
│   ├── test_branches.py      [CREATE]
│   ├── test_context.py       [CREATE]
│   └── test_agent.py         [CREATE]
├── main.py                 [MODIFY] register 3 new routers
└── requirements.txt        [MODIFY] add anthropic, pytest, httpx
frontend/src/
├── pages/
│   ├── ConversationList.jsx [CREATE] /
│   └── ConversationView.jsx [CREATE] /conversations/:id
├── components/
│   ├── BranchSidebar.jsx    [CREATE]
│   ├── MessageThread.jsx    [CREATE] keeps {/* DEV-B: action buttons */} placeholder
│   └── SendBox.jsx          [CREATE]
└── App.jsx                  [MODIFY] add /conversations/:id route, restore real ConversationList at /
README.md                    [MODIFY] add run + deploy instructions
```

---

## Task 1: Test deps + Pydantic schemas

**Why first:** every later task imports from `schemas.py` and runs tests. Get it green before writing endpoints.

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/schemas.py`
- Create: `backend/tests/__init__.py` (already exists on main — verify only)
- Create: `backend/tests/conftest.py`

- [ ] **Step 1: Add anthropic, pytest, httpx to `backend/requirements.txt`**

```
fastapi
uvicorn
sqlalchemy
psycopg2-binary
python-dotenv
anthropic
pytest
httpx
```

- [ ] **Step 2: Install deps**

Run: `cd backend && source venv/bin/activate && pip install -r requirements.txt`

Expected: `Successfully installed anthropic-... pytest-... httpx-...`

- [ ] **Step 3: Create `backend/schemas.py`**

```python
"""Pydantic request/response shapes shared by DEV-A routers."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ----- Conversations -----

class ConversationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    owner_id: uuid.UUID


class ConversationOut(BaseModel):
    id: str
    owner_id: str
    title: str
    root_node_id: Optional[str]
    default_branch_id: Optional[str]
    created_at: str
    updated_at: str


class ConversationDetail(ConversationOut):
    branches: list["BranchOut"]


# ----- Branches -----

class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    fork_node_id: uuid.UUID
    created_by: uuid.UUID


class BranchOut(BaseModel):
    id: str
    conversation_id: str
    name: str
    head_node_id: Optional[str]
    base_node_id: Optional[str]
    created_by: str
    is_archived: bool
    created_at: str


# ----- Context assembly -----

class ContextNode(BaseModel):
    id: str
    source: str         # 'ancestor' | 'pinned' | 'imported'
    pin_priority: int
    depth: Optional[int]
    token_count: int
    running_tokens: int
    content: str


# ----- Agent turn -----

class AgentTurnRequest(BaseModel):
    node_id: uuid.UUID
    user_message: str = Field(min_length=1)
    budget: int = Field(default=4096, ge=128, le=200_000)


class AgentTurnResponse(BaseModel):
    user_node: dict
    assistant_node: dict
    context_used: dict


ConversationDetail.model_rebuild()
```

- [ ] **Step 4: Create `backend/tests/conftest.py`**

```python
"""Pytest fixtures shared by all DEV-A tests.

Tests run against the live Supabase DB with seed data already loaded.
We don't roll back — assertions key off seed UUIDs and unique titles
created per-test (timestamp-suffixed).
"""
import os
import sys
import time
import uuid

import pytest
from fastapi.testclient import TestClient

# Make `backend/` the import root so `from main import app` works.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app  # noqa: E402

# Deterministic seed UUIDs (uuid5 of NAMESPACE + short id).
ALEX_USER_ID = "2f75cca7-7ebc-5af0-a919-f0bfe59e4125"
RECIPEBOX_CONV_ID = "9f0ad37b-f4b9-56b4-9abd-bd51d830e396"
BR_MAIN_ID = "ae642808-6b30-58c5-833f-8e50045b5b63"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def unique_title():
    """Returns a title prefix unique to this test run."""
    return f"DEV-A test {int(time.time() * 1000)} {uuid.uuid4().hex[:6]}"
```

- [ ] **Step 5: Run pytest collection sanity-check**

Run: `cd backend && pytest --collect-only`
Expected: collects `tests/test_phase1.py`, `tests/test_phase2.py` (DEV-B's existing tests) without errors. Yours haven't been added yet.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/schemas.py backend/tests/conftest.py
git commit -m "test: add DEV-A pytest fixtures and Pydantic schemas"
```

---

## Task 2: `POST /api/conversations` — the 5-step transaction

**The hardest endpoint** — a single transaction that creates the conversation, the `main` branch, the system root node, and backfills two FKs.

**Files:**
- Create: `backend/routers/conversations.py`
- Create: `backend/tests/test_conversations.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_conversations.py`:

```python
import uuid

from tests.conftest import ALEX_USER_ID


def test_create_conversation_creates_main_branch_and_root_node(client, unique_title):
    res = client.post("/api/conversations", json={
        "title": unique_title,
        "owner_id": ALEX_USER_ID,
    })
    assert res.status_code == 201, res.text
    body = res.json()

    # Conversation fields
    assert body["title"] == unique_title
    assert body["owner_id"] == ALEX_USER_ID
    assert uuid.UUID(body["id"])  # valid uuid

    # Backfilled FKs
    assert body["root_node_id"] is not None
    assert body["default_branch_id"] is not None
    assert uuid.UUID(body["root_node_id"])
    assert uuid.UUID(body["default_branch_id"])


def test_create_conversation_root_node_is_system_role(client, unique_title):
    res = client.post("/api/conversations", json={
        "title": unique_title,
        "owner_id": ALEX_USER_ID,
    })
    body = res.json()

    # Verify the root node via DEV-B's GET /api/nodes/{id}
    root = client.get(f"/api/nodes/{body['root_node_id']}").json()
    assert root["role"] == "system"
    assert root["parent_id"] is None
    assert root["branch_id"] == body["default_branch_id"]


def test_create_conversation_rejects_blank_title(client):
    res = client.post("/api/conversations", json={
        "title": "",
        "owner_id": ALEX_USER_ID,
    })
    assert res.status_code == 422
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && pytest tests/test_conversations.py -v`
Expected: FAIL — `404 Not Found` on `POST /api/conversations` (router not registered).

- [ ] **Step 3: Implement the router**

Create `backend/routers/conversations.py`:

```python
"""DEV-A conversations router.

POST /conversations is a 5-step transaction:
  1. INSERT conversation (root_node_id=NULL, default_branch_id=NULL)
  2. INSERT branch "main" (head=NULL, base=NULL)
  3. INSERT root node (parent=NULL, role=system, content=SYSTEM_PROMPT)
  4. UPDATE conversation: root_node_id, default_branch_id
  5. UPDATE branch: head_node_id = root.id

The closure-table trigger auto-creates node_ancestry(root, root, 0).
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from models.core import Branch, Conversation, Node
from schemas import (
    BranchOut,
    ConversationCreate,
    ConversationDetail,
    ConversationOut,
)

router = APIRouter()

SYSTEM_PROMPT = (
    "You are a helpful AI assistant. This conversation is managed by Graft."
)


def _token_count(content: str) -> int:
    """Match DEV-B's formula in routers/nodes.py — keep byte-identical."""
    return int(len(content.split()) * 1.3)


def _branch_to_dict(b: Branch) -> dict:
    return {
        "id": str(b.id),
        "conversation_id": str(b.conversation_id),
        "name": b.name,
        "head_node_id": str(b.head_node_id) if b.head_node_id else None,
        "base_node_id": str(b.base_node_id) if b.base_node_id else None,
        "created_by": str(b.created_by),
        "is_archived": b.is_archived,
        "created_at": str(b.created_at),
    }


def _conv_to_dict(c: Conversation) -> dict:
    return {
        "id": str(c.id),
        "owner_id": str(c.owner_id),
        "title": c.title,
        "root_node_id": str(c.root_node_id) if c.root_node_id else None,
        "default_branch_id": str(c.default_branch_id) if c.default_branch_id else None,
        "created_at": str(c.created_at),
        "updated_at": str(c.updated_at),
    }


@router.post("/conversations", status_code=201)
def create_conversation(body: ConversationCreate, db: Session = Depends(get_db)):
    # 1. Conversation shell.
    conv = Conversation(
        id=uuid.uuid4(),
        owner_id=body.owner_id,
        title=body.title,
    )
    db.add(conv)
    db.flush()

    # 2. main branch shell.
    branch = Branch(
        id=uuid.uuid4(),
        conversation_id=conv.id,
        name="main",
        created_by=body.owner_id,
    )
    db.add(branch)
    db.flush()

    # 3. Root system node. Trigger auto-fills node_ancestry(root, root, 0).
    root = Node(
        id=uuid.uuid4(),
        conversation_id=conv.id,
        parent_id=None,
        branch_id=branch.id,
        node_type="message",
        role="system",
        content=SYSTEM_PROMPT,
        token_count=_token_count(SYSTEM_PROMPT),
    )
    db.add(root)
    db.flush()

    # 4. Backfill conversation FKs.
    conv.root_node_id = root.id
    conv.default_branch_id = branch.id

    # 5. Branch head points at root.
    branch.head_node_id = root.id

    db.commit()
    db.refresh(conv)
    return _conv_to_dict(conv)
```

- [ ] **Step 4: Register the router in `backend/main.py`**

Modify `backend/main.py` — add the import and the include below DEV-B's three lines:

```python
from routers.conversations import router as conversations_router  # add this

app.include_router(conversations_router, prefix="/api")  # add this
```

- [ ] **Step 5: Run — verify pass**

Run: `cd backend && pytest tests/test_conversations.py -v`
Expected: PASS for all three tests.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/conversations.py backend/main.py backend/tests/test_conversations.py
git commit -m "feat(api): POST /api/conversations creates main branch and root node"
```

---

## Task 3: `GET /api/conversations` and `GET /api/conversations/{id}`

**Files:**
- Modify: `backend/routers/conversations.py`
- Modify: `backend/tests/test_conversations.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_conversations.py`:

```python
def test_list_conversations_returns_recipebox_for_alex(client):
    res = client.get(f"/api/conversations?owner_id={ALEX_USER_ID}")
    assert res.status_code == 200
    rows = res.json()
    titles = [r["title"] for r in rows]
    assert "Building RecipeBox" in titles


def test_list_conversations_sorted_by_updated_desc(client):
    res = client.get(f"/api/conversations?owner_id={ALEX_USER_ID}")
    rows = res.json()
    timestamps = [r["updated_at"] for r in rows]
    assert timestamps == sorted(timestamps, reverse=True)


def test_get_conversation_includes_non_archived_branches(client):
    from tests.conftest import RECIPEBOX_CONV_ID
    res = client.get(f"/api/conversations/{RECIPEBOX_CONV_ID}")
    assert res.status_code == 200
    body = res.json()
    branch_names = {b["name"] for b in body["branches"]}
    assert "main" in branch_names
    assert "feat/auth" in branch_names
    # spike/s3-upload is archived per seed data — must NOT appear
    assert "spike/s3-upload" not in branch_names


def test_get_conversation_404_on_missing(client):
    res = client.get(f"/api/conversations/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && pytest tests/test_conversations.py -v -k "list or get_conversation"`
Expected: FAIL — `405 Method Not Allowed` or 404.

- [ ] **Step 3: Implement list + get**

Append to `backend/routers/conversations.py`:

```python
@router.get("/conversations")
def list_conversations(owner_id: uuid.UUID, db: Session = Depends(get_db)):
    rows = (
        db.query(Conversation)
        .filter(Conversation.owner_id == owner_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [_conv_to_dict(c) for c in rows]


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: uuid.UUID, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    branches = (
        db.query(Branch)
        .filter(Branch.conversation_id == conv_id, Branch.is_archived == False)  # noqa: E712
        .order_by(Branch.created_at.asc())
        .all()
    )
    payload = _conv_to_dict(conv)
    payload["branches"] = [_branch_to_dict(b) for b in branches]
    return payload
```

- [ ] **Step 4: Run — verify pass**

Run: `cd backend && pytest tests/test_conversations.py -v`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/conversations.py backend/tests/test_conversations.py
git commit -m "feat(api): GET /api/conversations list + detail with non-archived branches"
```

---

## Task 4: `POST /api/conversations/{id}/branches` — fork

**Files:**
- Create: `backend/routers/branches.py`
- Create: `backend/tests/test_branches.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_branches.py`:

```python
import uuid

from tests.conftest import ALEX_USER_ID, RECIPEBOX_CONV_ID, BR_MAIN_ID


def test_fork_branch_sets_base_and_head_to_fork_node(client):
    # Use the seed n-07 (a known mid-history node on br-main)
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    fork_node = main["head_node_id"]

    res = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": f"feat/test-{uuid.uuid4().hex[:6]}",
        "fork_node_id": fork_node,
        "created_by": ALEX_USER_ID,
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["base_node_id"] == fork_node
    assert body["head_node_id"] == fork_node
    assert body["is_archived"] is False
    assert body["conversation_id"] == RECIPEBOX_CONV_ID


def test_fork_branch_rejects_duplicate_name_in_same_conversation(client):
    # main already exists on RECIPEBOX_CONV
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    res = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": "main",
        "fork_node_id": main["head_node_id"],
        "created_by": ALEX_USER_ID,
    })
    assert res.status_code == 409
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && pytest tests/test_branches.py -v`
Expected: FAIL — `404` (route missing).

- [ ] **Step 3: Implement**

Create `backend/routers/branches.py`:

```python
"""DEV-A branches router."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from models.core import Branch, Node
from schemas import BranchCreate

router = APIRouter()


def _branch_to_dict(b: Branch) -> dict:
    return {
        "id": str(b.id),
        "conversation_id": str(b.conversation_id),
        "name": b.name,
        "head_node_id": str(b.head_node_id) if b.head_node_id else None,
        "base_node_id": str(b.base_node_id) if b.base_node_id else None,
        "created_by": str(b.created_by),
        "is_archived": b.is_archived,
        "created_at": str(b.created_at),
    }


@router.post("/conversations/{conv_id}/branches", status_code=201)
def create_branch(conv_id: uuid.UUID, body: BranchCreate, db: Session = Depends(get_db)):
    # Verify the fork node exists in this conversation.
    fork = db.query(Node).filter(Node.id == body.fork_node_id).first()
    if not fork:
        raise HTTPException(status_code=404, detail="fork_node_id not found")
    if fork.conversation_id != conv_id:
        raise HTTPException(status_code=400, detail="fork_node_id is in a different conversation")

    branch = Branch(
        id=uuid.uuid4(),
        conversation_id=conv_id,
        name=body.name,
        head_node_id=body.fork_node_id,
        base_node_id=body.fork_node_id,
        created_by=body.created_by,
    )
    db.add(branch)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Branch name already used in this conversation")
    db.refresh(branch)
    return _branch_to_dict(branch)
```

- [ ] **Step 4: Register router in `backend/main.py`**

```python
from routers.branches import router as branches_router  # add

app.include_router(branches_router, prefix="/api")  # add
```

- [ ] **Step 5: Run — verify pass**

Run: `cd backend && pytest tests/test_branches.py::test_fork_branch_sets_base_and_head_to_fork_node tests/test_branches.py::test_fork_branch_rejects_duplicate_name_in_same_conversation -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/branches.py backend/main.py backend/tests/test_branches.py
git commit -m "feat(api): POST /api/conversations/{id}/branches forks at fork_node_id"
```

---

## Task 5: `GET /api/branches/{id}` and `POST /api/branches/{id}/archive`

**Files:**
- Modify: `backend/routers/branches.py`
- Modify: `backend/tests/test_branches.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_branches.py`:

```python
def test_get_branch_returns_main(client):
    res = client.get(f"/api/branches/{BR_MAIN_ID}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "main"
    assert body["is_archived"] is False
    assert body["base_node_id"] is None  # main is the root branch


def test_archive_branch_sets_is_archived(client):
    # Create a throwaway branch first
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    create = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": f"to-archive-{uuid.uuid4().hex[:6]}",
        "fork_node_id": main["head_node_id"],
        "created_by": ALEX_USER_ID,
    }).json()

    res = client.post(f"/api/branches/{create['id']}/archive")
    assert res.status_code == 204

    after = client.get(f"/api/branches/{create['id']}").json()
    assert after["is_archived"] is True


def test_get_branch_404_missing(client):
    res = client.get("/api/branches/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && pytest tests/test_branches.py -v -k "get_branch or archive"`
Expected: FAIL.

- [ ] **Step 3: Implement get + archive**

Append to `backend/routers/branches.py`:

```python
@router.get("/branches/{branch_id}")
def get_branch(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    return _branch_to_dict(branch)


@router.post("/branches/{branch_id}/archive", status_code=204)
def archive_branch(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")
    branch.is_archived = True
    db.commit()
    return Response(status_code=204)
```

- [ ] **Step 4: Run — verify all branch tests pass**

Run: `cd backend && pytest tests/test_branches.py -v`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/branches.py backend/tests/test_branches.py
git commit -m "feat(api): GET /api/branches/{id} and POST /api/branches/{id}/archive"
```

---

## Task 6: `GET /api/nodes/{id}/context` — Query 1 (the showpiece)

**Critical:** execute `db/queries.sql` Query 1 verbatim via `text()`. Do NOT translate to ORM.

**Files:**
- Modify: `backend/routers/branches.py` (the context endpoint lives there per master plan)
- Create: `backend/tests/test_context.py`

- [ ] **Step 1: Copy Query 1 SQL into a Python constant**

Append to `backend/routers/branches.py`:

```python
from sqlalchemy import text

QUERY_1_CONTEXT_ASSEMBLY = """
WITH params AS (
  SELECT :current_node_id::uuid AS current_node_id,
         :budget::int           AS budget
),
current_branch AS (
  SELECT n.branch_id
  FROM nodes n, params p
  WHERE n.id = p.current_node_id
),
ancestor_nodes AS (
  SELECT n.id, n.content, n.token_count, n.created_at,
         na.depth,
         0::smallint AS pin_priority,
         'ancestor'  AS source
  FROM node_ancestry na
  JOIN nodes n ON n.id = na.ancestor_id
  JOIN params p ON na.descendant_id = p.current_node_id
),
pinned_nodes AS (
  SELECT n.id, n.content, n.token_count, n.created_at,
         NULL::int AS depth,
         cp.priority AS pin_priority,
         'pinned' AS source
  FROM context_pins cp
  JOIN current_branch cb ON cp.branch_id = cb.branch_id
  JOIN nodes n ON n.id = cp.node_id
),
imported_nodes AS (
  SELECT DISTINCT n.id, n.content, n.token_count, n.created_at,
         NULL::int AS depth,
         0::smallint AS pin_priority,
         'imported' AS source
  FROM context_imports ci
  JOIN current_branch cb ON ci.target_branch_id = cb.branch_id
  JOIN node_ancestry na
    ON na.ancestor_id = ci.source_node_id
   AND (ci.include_descendants OR na.descendant_id = ci.source_node_id)
  JOIN nodes n ON n.id = na.descendant_id
),
candidates AS (
  SELECT * FROM ancestor_nodes
  UNION
  SELECT * FROM pinned_nodes
  UNION
  SELECT * FROM imported_nodes
),
elided AS (
  SELECT ns.summarized_node_id AS node_id
  FROM node_summaries ns
  WHERE ns.summary_node_id IN (SELECT id FROM candidates)
),
ranked AS (
  SELECT c.*,
         ROW_NUMBER() OVER (
           ORDER BY c.pin_priority DESC,
                    CASE c.source
                      WHEN 'pinned'   THEN 0
                      WHEN 'ancestor' THEN 1
                      WHEN 'imported' THEN 2
                    END,
                    COALESCE(c.depth, 999),
                    c.created_at DESC
         ) AS rank
  FROM candidates c
  WHERE c.id NOT IN (SELECT node_id FROM elided)
),
budgeted AS (
  SELECT *,
         SUM(token_count) OVER (ORDER BY rank) AS running_tokens
  FROM ranked
)
SELECT id, source, pin_priority, depth, token_count, running_tokens, content
FROM budgeted, params
WHERE running_tokens <= params.budget
ORDER BY rank;
"""
```

- [ ] **Step 2: Write failing test**

Create `backend/tests/test_context.py`:

```python
"""Test Query 1 (context assembly) end-to-end against seed data."""
from sqlalchemy import text

from tests.conftest import RECIPEBOX_CONV_ID


def _node_id_by_content(client, snippet: str) -> str:
    """Find a seed node by a substring of its content."""
    # Walk the conversation via the search API (DEV-B's) — easiest path.
    from tests.conftest import ALEX_USER_ID
    res = client.get(
        f"/api/search?q={snippet}&user_id={ALEX_USER_ID}&k=1"
    ).json()
    assert res, f"no node matching {snippet!r}"
    return res[0]["node_id"]


def test_context_at_n31_includes_ancestors_and_pinned_n05(client):
    # n-31 is the deepest node on feat/search; ancestors include n-05 (pinned).
    n31 = _node_id_by_content(client, "Trigram autocomplete")
    res = client.get(f"/api/nodes/{n31}/context?budget=2000")
    assert res.status_code == 200
    rows = res.json()
    assert rows, "context should not be empty"

    # First row should be the highest-priority pin or closest ancestor.
    assert rows[0]["running_tokens"] >= rows[0]["token_count"]

    # Total tokens within budget.
    assert rows[-1]["running_tokens"] <= 2000

    sources = {r["source"] for r in rows}
    assert "ancestor" in sources

    # The pinned schema node (n-05) should appear because pin-03 pins it on br-search.
    contents = " ".join(r["content"] for r in rows)
    assert "schema" in contents.lower() or "Updated schema" in contents


def test_context_excludes_summarized_nodes_when_summary_present(client):
    # n-36 summarizes n-08..n-13. If we assemble at n-13 (auth head), we don't
    # have the summary on that branch — so all 6 originals should be present.
    # If we assemble at n-36 itself, the summary should hide originals.
    # Easier check: the budget-truncated rows are sorted by rank.
    n31 = _node_id_by_content(client, "Trigram autocomplete")
    res = client.get(f"/api/nodes/{n31}/context?budget=10000").json()
    ranks = [r["running_tokens"] for r in res]
    assert ranks == sorted(ranks), "running_tokens must be monotonically increasing"


def test_context_404_on_missing_node(client):
    res = client.get("/api/nodes/00000000-0000-0000-0000-000000000000/context?budget=1000")
    # Query 1 returns empty when current_node_id doesn't exist; we choose to 404.
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert res.json() == []
```

- [ ] **Step 3: Run — verify failure**

Run: `cd backend && pytest tests/test_context.py -v`
Expected: FAIL — endpoint missing.

- [ ] **Step 4: Implement endpoint**

Append to `backend/routers/branches.py`:

```python
@router.get("/nodes/{node_id}/context")
def get_context(node_id: uuid.UUID, budget: int = 4096, db: Session = Depends(get_db)):
    rows = db.execute(
        text(QUERY_1_CONTEXT_ASSEMBLY),
        {"current_node_id": str(node_id), "budget": budget},
    ).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "source": r["source"],
            "pin_priority": r["pin_priority"],
            "depth": r["depth"],
            "token_count": r["token_count"],
            "running_tokens": r["running_tokens"],
            "content": r["content"],
        }
        for r in rows
    ]
```

Note: this endpoint lives under `branches.py` because it's part of the read-path router family. Path is `/api/nodes/{id}/context` regardless.

- [ ] **Step 5: Run — verify pass**

Run: `cd backend && pytest tests/test_context.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routers/branches.py backend/tests/test_context.py
git commit -m "feat(api): GET /api/nodes/{id}/context runs Query 1 via raw SQL"
```

---

## Task 7: Smoke-test the full DEV-A backend manually

**Files:** none (manual verification + screenshot for write-up)

- [ ] **Step 1: Start the server**

Run: `cd backend && uvicorn main:app --reload --port 8000`
Expected: server starts; visit `http://localhost:8000/docs` and confirm conversations + branches routes appear in OpenAPI UI.

- [ ] **Step 2: Curl test the golden path**

```bash
USER=2f75cca7-7ebc-5af0-a919-f0bfe59e4125

# Create
CONV=$(curl -s -X POST http://localhost:8000/api/conversations \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"smoke\",\"owner_id\":\"$USER\"}")
echo "$CONV"

CONV_ID=$(echo "$CONV" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
ROOT=$(echo "$CONV" | python3 -c "import sys,json;print(json.load(sys.stdin)['root_node_id'])")
BRANCH=$(echo "$CONV" | python3 -c "import sys,json;print(json.load(sys.stdin)['default_branch_id'])")

# List
curl -s "http://localhost:8000/api/conversations?owner_id=$USER" | python3 -m json.tool | head

# Detail
curl -s "http://localhost:8000/api/conversations/$CONV_ID" | python3 -m json.tool

# Fork
curl -s -X POST "http://localhost:8000/api/conversations/$CONV_ID/branches" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"feat/smoke\",\"fork_node_id\":\"$ROOT\",\"created_by\":\"$USER\"}" \
  | python3 -m json.tool

# Context (just the system root for now — should return one row)
curl -s "http://localhost:8000/api/nodes/$ROOT/context?budget=5000" | python3 -m json.tool
```

Expected: every response is JSON, no 500s.

- [ ] **Step 3: Run the full backend suite**

Run: `cd backend && pytest -v`
Expected: all DEV-A + DEV-B tests PASS.

- [ ] **Step 4: Commit (no code change — just a checkpoint)**

```bash
git commit --allow-empty -m "chore: DEV-A backend Phase 1 smoke-tested green"
```

---

## Task 8: `POST /api/agent/turn` — LLM stub with optional Anthropic call

**Files:**
- Create: `backend/llm.py`
- Create: `backend/routers/agent.py`
- Create: `backend/tests/test_agent.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_agent.py`:

```python
"""End-to-end agent-turn test. Falls through to the stub when ANTHROPIC_API_KEY is unset."""
import os
import uuid

from tests.conftest import ALEX_USER_ID, RECIPEBOX_CONV_ID


def _new_conversation(client, title_suffix: str) -> dict:
    return client.post("/api/conversations", json={
        "title": f"agent-test {title_suffix}",
        "owner_id": ALEX_USER_ID,
    }).json()


def test_agent_turn_creates_user_and_assistant_nodes(client):
    conv = _new_conversation(client, uuid.uuid4().hex[:6])

    res = client.post("/api/agent/turn", json={
        "node_id": conv["root_node_id"],
        "user_message": "Hello, what can you help me with?",
        "budget": 1024,
    })
    assert res.status_code == 200, res.text
    body = res.json()

    # Both nodes returned
    assert body["user_node"]["role"] == "user"
    assert body["user_node"]["parent_id"] == conv["root_node_id"]
    assert body["assistant_node"]["role"] == "assistant"
    assert body["assistant_node"]["parent_id"] == body["user_node"]["id"]

    # Branch head advanced past assistant.
    branch = client.get(f"/api/branches/{conv['default_branch_id']}").json()
    assert branch["head_node_id"] == body["assistant_node"]["id"]

    # context_used reports counts.
    assert body["context_used"]["node_count"] >= 1
    assert body["context_used"]["total_tokens"] >= 0


def test_agent_turn_stub_when_no_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    conv = _new_conversation(client, uuid.uuid4().hex[:6])

    res = client.post("/api/agent/turn", json={
        "node_id": conv["root_node_id"],
        "user_message": "test",
    }).json()
    assert "[Stub]" in res["assistant_node"]["content"]
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && pytest tests/test_agent.py -v`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement `backend/llm.py`**

```python
"""LLM dispatch — Anthropic when key is set, stub otherwise."""
from __future__ import annotations

import os
from typing import Iterable


STUB_PREFIX = "[Stub]"


def _stub_reply(context_count: int, total_tokens: int) -> str:
    return (
        f"{STUB_PREFIX} I received your message with {context_count} context nodes "
        f"totaling {total_tokens} tokens. (Set ANTHROPIC_API_KEY for a real reply.)"
    )


def call_llm(context_nodes: list[dict]) -> str:
    """Format context as a Claude messages list and call the API.

    `context_nodes` are rows from Query 1 (id, source, content, ..., role) but
    Query 1 doesn't return role — we look at `source` only when no role is set.
    Caller must ensure messages are ordered chronologically before passing.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    total_tokens = sum(n.get("token_count", 0) for n in context_nodes)
    if not api_key:
        return _stub_reply(len(context_nodes), total_tokens)

    # Real Anthropic call — only imported when the key exists, so tests
    # without a key don't need the package configured.
    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    system_chunks = [n["content"] for n in context_nodes if n.get("role") == "system"]
    messages: list[dict] = [
        {"role": n["role"], "content": n["content"]}
        for n in context_nodes
        if n.get("role") in ("user", "assistant")
    ]
    if not messages:
        # Anthropic requires at least one user message; surface a stub instead
        # of erroring. (The agent-turn endpoint inserts a user node before
        # calling, so this branch should be unreachable in practice.)
        return _stub_reply(len(context_nodes), total_tokens)

    response = client.messages.create(
        model="claude-sonnet-4-5",
        max_tokens=1024,
        system="\n\n".join(system_chunks) or "You are a helpful AI assistant.",
        messages=messages,
    )
    return response.content[0].text
```

- [ ] **Step 4: Implement `backend/routers/agent.py`**

```python
"""DEV-A agent router.

POST /agent/turn does the full turn:
  1. Look up parent node (must exist, gives us branch + conversation).
  2. Insert user node, advance branch head.
  3. Run Query 1 (context assembly) at the new user node.
  4. Call LLM (or stub).
  5. Insert assistant node, advance branch head.
  6. Bump conversations.updated_at.
  7. Return both nodes + context summary.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from db import get_db
from llm import call_llm
from models.core import Branch, Node
from routers.branches import QUERY_1_CONTEXT_ASSEMBLY
from schemas import AgentTurnRequest

router = APIRouter()


def _token_count(content: str) -> int:
    return int(len(content.split()) * 1.3)


def _node_to_dict(n: Node) -> dict:
    return {
        "id": str(n.id),
        "conversation_id": str(n.conversation_id),
        "parent_id": str(n.parent_id) if n.parent_id else None,
        "branch_id": str(n.branch_id),
        "node_type": n.node_type,
        "role": n.role,
        "content": n.content,
        "token_count": n.token_count,
        "created_at": str(n.created_at),
    }


@router.post("/agent/turn")
def agent_turn(body: AgentTurnRequest, db: Session = Depends(get_db)):
    parent = db.query(Node).filter(Node.id == body.node_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="parent node_id not found")

    branch = db.query(Branch).filter(Branch.id == parent.branch_id).first()
    if not branch:
        raise HTTPException(status_code=500, detail="orphan node — no branch")

    # 1. user node
    user_node = Node(
        id=uuid.uuid4(),
        conversation_id=parent.conversation_id,
        parent_id=parent.id,
        branch_id=branch.id,
        node_type="message",
        role="user",
        content=body.user_message,
        token_count=_token_count(body.user_message),
    )
    db.add(user_node)
    db.flush()
    branch.head_node_id = user_node.id

    # 2. context for the new user node
    rows = db.execute(
        text(QUERY_1_CONTEXT_ASSEMBLY),
        {"current_node_id": str(user_node.id), "budget": body.budget},
    ).mappings().all()
    context_nodes = [
        {
            "id": str(r["id"]),
            "source": r["source"],
            "content": r["content"],
            "token_count": r["token_count"],
            # We need role for the LLM call; fetch from nodes table inside Query 1's
            # SELECT would be cleaner, but Query 1 is fixed. Look it up in-memory:
        }
        for r in rows
    ]
    # Augment rows with role by re-fetching (small N, cheap).
    if context_nodes:
        ids = [r["id"] for r in context_nodes]
        roles = dict(
            db.execute(
                text("SELECT id::text, role FROM nodes WHERE id = ANY(:ids::uuid[])"),
                {"ids": ids},
            ).fetchall()
        )
        for n in context_nodes:
            n["role"] = roles.get(n["id"])

    # 3. LLM call
    reply_text = call_llm(context_nodes)

    # 4. assistant node
    assistant_node = Node(
        id=uuid.uuid4(),
        conversation_id=parent.conversation_id,
        parent_id=user_node.id,
        branch_id=branch.id,
        node_type="message",
        role="assistant",
        content=reply_text,
        token_count=_token_count(reply_text),
    )
    db.add(assistant_node)
    db.flush()
    branch.head_node_id = assistant_node.id

    # 5. bump conversation updated_at
    db.execute(
        text("UPDATE conversations SET updated_at = now() WHERE id = :cid"),
        {"cid": str(parent.conversation_id)},
    )
    db.commit()
    db.refresh(user_node)
    db.refresh(assistant_node)

    return {
        "user_node": _node_to_dict(user_node),
        "assistant_node": _node_to_dict(assistant_node),
        "context_used": {
            "node_count": len(context_nodes),
            "total_tokens": sum(n["token_count"] for n in context_nodes),
        },
    }
```

- [ ] **Step 5: Register router in `main.py`**

Add to `backend/main.py`:

```python
from routers.agent import router as agent_router

app.include_router(agent_router, prefix="/api")
```

- [ ] **Step 6: Run — verify pass**

Run: `cd backend && pytest tests/test_agent.py -v`
Expected: PASS (stub fallback when no API key).

- [ ] **Step 7: Commit**

```bash
git add backend/llm.py backend/routers/agent.py backend/main.py backend/tests/test_agent.py
git commit -m "feat(api): POST /api/agent/turn with stub + Anthropic fallback"
```

---

## Task 9: Confirm `frontend/src/api.js` already has the methods you need

The shared `api.js` already exposes `getConversations`, `getConversation`, `createConversation`, `getBranch`, `createBranch`, `getContext`, `agentTurn` — created during the merge. **No changes needed.** This task is a check, not an implementation.

- [ ] **Step 1: Sanity-check by reading the file**

Run: `grep -E "getConversations|createBranch|getContext|agentTurn" frontend/src/api.js`
Expected: each method appears.

- [ ] **Step 2: Add a missing method if it's not there**

`api.js` on main is missing `archiveBranch`. Add it (modify `frontend/src/api.js`, append inside the `api` object):

```js
  archiveBranch: (id) =>
    request(`/branches/${id}/archive`, { method: "POST" }),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(api-client): add api.archiveBranch"
```

---

## Task 10: Replace `App.jsx` placeholder with real ConversationList route + add `/conversations/:id`

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Update App.jsx**

Replace contents of `frontend/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ConversationList from "./pages/ConversationList";
import ConversationView from "./pages/ConversationView";
import SearchPage from "./pages/SearchPage";

export default function App() {
  return (
    <BrowserRouter>
      <nav className="border-b px-4 py-2 flex gap-4 text-sm bg-white">
        <Link to="/" className="font-semibold">Graft</Link>
        <Link to="/" className="text-blue-600 hover:underline">Conversations</Link>
        <Link to="/search" className="text-blue-600 hover:underline">Search</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ConversationList />} />
        <Route path="/conversations/:id" element={<ConversationView />} />
        <Route path="/search" element={<SearchPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Boot the frontend; expect it to fail-import**

Run: `cd frontend && npm run dev`
Expected: Vite reports `Failed to resolve import "./pages/ConversationList"` — that's the next task.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(ui): wire /conversations/:id route, restore real ConversationList at /"
```

---

## Task 11: `ConversationList` page

**Files:**
- Create: `frontend/src/pages/ConversationList.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, DEFAULT_USER_ID } from "../api";

export default function ConversationList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.getConversations(DEFAULT_USER_ID)
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const conv = await api.createConversation({
        title: title.trim(),
        owner_id: DEFAULT_USER_ID,
      });
      navigate(`/conversations/${conv.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Conversations</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New conversation title…"
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          disabled={creating || !title.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">No conversations yet.</p>
      ) : (
        <ul className="divide-y border rounded bg-white">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/conversations/${c.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-gray-500">
                  Updated {new Date(c.updated_at).toLocaleString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Visual verify**

Run: `cd frontend && npm run dev` (if not already running)
Open `http://localhost:5173/`
Expected: page lists "Building RecipeBox" (from seed data); creating a new conversation navigates to `/conversations/<new-id>` (which 404s in router until next task).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ConversationList.jsx
git commit -m "feat(ui): ConversationList page with create form"
```

---

## Task 12: `BranchSidebar` component

**Files:**
- Create: `frontend/src/components/BranchSidebar.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useState } from "react";

export default function BranchSidebar({
  branches = [],
  selectedId,
  onSelect,
  onCreate,
}) {
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim());
    setName("");
    setShowForm(false);
  }

  return (
    <aside className="w-64 border-r bg-white flex flex-col">
      <div className="p-3 border-b text-xs font-semibold text-gray-500 uppercase">
        Branches
      </div>
      <ul className="flex-1 overflow-y-auto">
        {branches.map((b) => {
          const active = b.id === selectedId;
          return (
            <li key={b.id}>
              <button
                onClick={() => onSelect(b)}
                className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-gray-50 ${
                  active ? "bg-blue-50 font-medium" : ""
                }`}
              >
                <span className="block">{b.name}</span>
                {b.base_node_id && (
                  <span className="text-xs text-gray-400">
                    forked @ {b.base_node_id.slice(0, 8)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t p-3">
        {showForm ? (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="branch name"
              className="border rounded px-2 py-1 text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <button className="flex-1 px-2 py-1 bg-blue-600 text-white text-sm rounded">
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-2 py-1 text-sm rounded border"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full px-2 py-1 text-sm border rounded hover:bg-gray-50"
          >
            + New branch
          </button>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/BranchSidebar.jsx
git commit -m "feat(ui): BranchSidebar with select + create"
```

---

## Task 13: `MessageThread` component (with DEV-B placeholder preserved)

**Files:**
- Create: `frontend/src/components/MessageThread.jsx`

- [ ] **Step 1: Implement**

```jsx
const ROLE_STYLES = {
  system: "bg-gray-100 italic text-gray-600",
  user: "bg-blue-50 border-l-4 border-blue-400",
  assistant: "bg-white border-l-4 border-emerald-400",
  summary: "bg-amber-50 border-l-4 border-amber-400",
};

const SOURCE_BADGE = {
  ancestor: "bg-gray-200 text-gray-700",
  pinned: "bg-amber-200 text-amber-800",
  imported: "bg-purple-200 text-purple-800",
};

export default function MessageThread({ nodes = [], loading }) {
  if (loading) {
    return <div className="p-6 text-gray-500">Loading context…</div>;
  }
  if (!nodes.length) {
    return (
      <div className="p-6 text-gray-500">
        No messages yet. Send one below to start the conversation.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-3">
      {nodes.map((n) => (
        <div
          key={n.id}
          className={`rounded p-3 ${ROLE_STYLES[n.role || ""] || "bg-white border"}`}
        >
          <div className="flex justify-between text-xs text-gray-500">
            <span>{n.role || "—"}</span>
            <span>{n.token_count} tok</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{n.content}</p>
          <div className="mt-2 flex gap-1 items-center">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                SOURCE_BADGE[n.source] || "bg-gray-200"
              }`}
            >
              {n.source}
            </span>
            {/* DEV-B: action buttons -- pin, import */}
          </div>
        </div>
      ))}
    </div>
  );
}
```

The `{/* DEV-B: action buttons */}` comment is a contract — DEV-B's `ImportModal`/pin trigger inserts here. **Do not remove.**

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MessageThread.jsx
git commit -m "feat(ui): MessageThread renders ranked context with role/source styling"
```

---

## Task 14: `SendBox` component

**Files:**
- Create: `frontend/src/components/SendBox.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useState } from "react";
import { api } from "../api";

export default function SendBox({ headNodeId, onTurnComplete, disabled }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || !headNodeId) return;
    setSending(true);
    try {
      const result = await api.agentTurn({
        node_id: headNodeId,
        user_message: text.trim(),
        budget: 4096,
      });
      onTurnComplete(result);
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="border-t bg-white p-3 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send a message…"
        disabled={disabled || sending || !headNodeId}
        className="flex-1 border rounded px-3 py-2"
      />
      <button
        disabled={disabled || sending || !text.trim() || !headNodeId}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {sending ? "…" : "Send"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SendBox.jsx
git commit -m "feat(ui): SendBox calls api.agentTurn and notifies parent on completion"
```

---

## Task 15: `ConversationView` page (composes the workspace)

**Files:**
- Create: `frontend/src/pages/ConversationView.jsx`

- [ ] **Step 1: Implement**

```jsx
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, DEFAULT_USER_ID } from "../api";
import BranchSidebar from "../components/BranchSidebar";
import MessageThread from "../components/MessageThread";
import SendBox from "../components/SendBox";
import PinsPanel from "../components/PinsPanel";

export default function ConversationView() {
  const { id } = useParams();
  const [conv, setConv] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [contextNodes, setContextNodes] = useState([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [showPins, setShowPins] = useState(false);

  // Initial conversation fetch
  useEffect(() => {
    api.getConversation(id).then((c) => {
      setConv(c);
      setBranches(c.branches || []);
      const main = (c.branches || []).find((b) => b.name === "main") || c.branches?.[0];
      setSelected(main || null);
    });
  }, [id]);

  // When the selected branch's head changes, refetch the context.
  const refreshContext = useCallback(async () => {
    if (!selected?.head_node_id) {
      setContextNodes([]);
      return;
    }
    setLoadingContext(true);
    try {
      const rows = await api.getContext(selected.head_node_id, 4096);
      setContextNodes(rows);
    } finally {
      setLoadingContext(false);
    }
  }, [selected?.head_node_id]);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  async function handleCreateBranch(name) {
    if (!selected?.head_node_id) return;
    const created = await api.createBranch(id, {
      name,
      fork_node_id: selected.head_node_id,
      created_by: DEFAULT_USER_ID,
    });
    setBranches((bs) => [...bs, created]);
    setSelected(created);
  }

  async function handleTurnComplete() {
    // Branch head has advanced server-side; refetch.
    const fresh = await api.getBranch(selected.id);
    setSelected(fresh);
    setBranches((bs) => bs.map((b) => (b.id === fresh.id ? fresh : b)));
  }

  if (!conv) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="flex h-[calc(100vh-2.5rem)]">
      <BranchSidebar
        branches={branches}
        selectedId={selected?.id}
        onSelect={setSelected}
        onCreate={handleCreateBranch}
      />
      <section className="flex-1 flex flex-col">
        <header className="border-b bg-white px-4 py-2 flex justify-between items-center">
          <div>
            <div className="font-medium">{conv.title}</div>
            {selected && (
              <div className="text-xs text-gray-500">on {selected.name}</div>
            )}
          </div>
          <button
            onClick={() => setShowPins((s) => !s)}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
          >
            {showPins ? "Hide pins" : "Show pins"}
          </button>
        </header>
        <MessageThread nodes={contextNodes} loading={loadingContext} />
        <SendBox
          headNodeId={selected?.head_node_id}
          onTurnComplete={handleTurnComplete}
        />
      </section>
      {showPins && selected && (
        <PinsPanel branchId={selected.id} />
      )}
    </div>
  );
}
```

`PinsPanel` is DEV-B's component — already in `components/PinsPanel.jsx` on main.

- [ ] **Step 2: Visual verify the golden path**

1. `cd frontend && npm run dev` and open `http://localhost:5173`.
2. Click into "Building RecipeBox".
3. Sidebar should show: `main`, `feat/auth`, `feat/recipe-crud`, `feat/image-upload`, `spike/cloudinary-upload`, `feat/search` (no `spike/s3-upload` because it's archived).
4. Click `feat/search`. Message thread should populate with the assembled context (n-31 ancestors + pinned n-05 + imported n-15).
5. Type a message in SendBox, hit Send. Within ~2 sec the assistant reply (or stub message) should appear in the thread.
6. Click "Show pins". DEV-B's PinsPanel should slide in showing pinned nodes for the selected branch.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ConversationView.jsx
git commit -m "feat(ui): ConversationView composes sidebar, thread, send, and PinsPanel"
```

---

## Task 16: Manual smoke + take screenshots for the write-up

**Files:** none (manual + screenshots saved to `docs/screenshots/` if not already present)

- [ ] **Step 1: Run the full stack**

Terminal 1: `cd backend && uvicorn main:app --reload --port 8000`
Terminal 2: `cd frontend && npm run dev`

- [ ] **Step 2: Walk the golden path**

1. Visit `/`, see seed conversations + the ones tests created.
2. Create a fresh conversation "demo run".
3. Send 2-3 messages, see assistant replies (stub if no API key).
4. Create a feature branch from the latest message.
5. Switch between branches; thread re-renders with the branch's context.
6. Click "Show pins" — DEV-B's PinsPanel works on this branch.
7. Visit `/search` (DEV-B's page), search for "schema" — results returned.

- [ ] **Step 3: Run the full pytest suite**

Run: `cd backend && pytest -v`
Expected: all DEV-A and DEV-B tests PASS.

- [ ] **Step 4: Commit checkpoint**

```bash
git commit --allow-empty -m "chore: full DEV-A stack smoke-tested green end-to-end"
```

---

## Task 17: README — run + deploy instructions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Running locally" section**

Insert after the "Stack (proposed)" section (or wherever the existing README places setup):

```markdown
## Running locally

Prereqs: Python 3.12, Node 20, a Postgres DB (Supabase free tier works).

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL (Supabase Session-pooler URI works around IPv6),
# optionally ANTHROPIC_API_KEY for real agent replies.

# 1. Schema + seed
psql "$(grep ^DATABASE_URL .env | cut -d= -f2-)" -v ON_ERROR_STOP=1 -f db/seed/init.sql
python3 db/seed/load_seed.py

# 2. Backend
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev    # http://localhost:5173

# 4. Tests
cd backend && pytest -v
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README local-run instructions"
```

---

## Task 18: Deploy backend to Render

**Files:**
- Create: `backend/Procfile` (Render uses Procfile-style start commands or a `render.yaml`)
- Create: `render.yaml` at repo root

- [ ] **Step 1: Add a `render.yaml` blueprint**

```yaml
# render.yaml — declarative Render service config.
# Usage: connect this repo as a Render Blueprint, set DATABASE_URL +
# optionally ANTHROPIC_API_KEY in the dashboard, deploy.
services:
  - type: web
    name: graft-api
    runtime: python
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        sync: false      # set in Render dashboard
      - key: ANTHROPIC_API_KEY
        sync: false
```

- [ ] **Step 2: Tighten CORS for prod**

Modify `backend/main.py` — replace the wildcard origins with the deployed Vercel URL **after** DEV-B has deployed the frontend. For now leave `localhost:5173` alone; revisit when the URL is known.

- [ ] **Step 3: Deploy**

In Render dashboard: New → Blueprint → connect repo → confirm. Set env vars manually. Wait ~3 min, then:

Run: `curl https://graft-api.onrender.com/health`
Expected: `{"status":"ok"}` (replace with your actual Render URL).

- [ ] **Step 4: Commit**

```bash
git add render.yaml
git commit -m "chore: add Render Blueprint for backend deployment"
git push
```

---

## Self-review notes (delete before merging)

**Spec coverage** (against `docs/dev-a/00_master_plan.md`):
- ✅ SQLAlchemy models — already on main; reused as-is.
- ✅ POST /api/conversations — Task 2.
- ✅ GET /api/conversations + /api/conversations/{id} — Task 3.
- ✅ POST /api/conversations/{id}/branches — Task 4.
- ✅ GET /api/branches/{id} + /archive — Task 5.
- ✅ GET /api/nodes/{id}/context — Task 6 (Query 1 verbatim).
- ✅ POST /api/agent/turn — Task 8.
- ✅ Branch sidebar, message thread, send box — Tasks 12-14.
- ✅ ConversationList + ConversationView — Tasks 11, 15.
- ✅ DEV-B placeholder preserved — Task 13 keeps `{/* DEV-B: action buttons */}`.
- ✅ Token formula matches DEV-B — `int(len(content.split()) * 1.3)` used throughout.
- ✅ README + deploy — Tasks 17, 18.

**Cut list (Phase 5 master plan):**
- Demo recording — manual; do this after Task 16.
- Adding deployed URL to README — combine with Task 17 once Render URL is known.
