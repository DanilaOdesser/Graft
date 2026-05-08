# Commit, SSE, Graph Search, Branch-from-Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add commit/summarize, SSE live graph updates, in-graph node search, and branch-from-any-node to the Graft conversation graph.

**Architecture:** Backend gains a `sse.py` pub/sub module + a streaming endpoint; every mutation endpoint becomes `async` and calls `await publish(...)` after committing. The commit endpoint creates a summary node via LLM and inserts `node_summaries` rows. The frontend subscribes via `EventSource` and merges payloads directly into React state — no re-fetches needed. Search and branch-from-node are pure frontend additions reusing existing API endpoints.

**Tech Stack:** FastAPI (async), SQLAlchemy sync sessions in async handlers, `asyncio.Queue` for SSE, React `EventSource`, `useReactFlow` for fitView.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/sse.py` | Create | In-process pub/sub: `subscribe`, `publish`, `event_generator` |
| `backend/routers/conversations.py` | Modify | Add `GET /{conv_id}/stream` SSE endpoint |
| `backend/llm.py` | Modify | Add `summarize_nodes(nodes) -> str` |
| `backend/routers/branches.py` | Modify | Add `POST /{branch_id}/commit`; make `create_branch` async + publish |
| `backend/routers/context.py` | Modify | Make pin/import mutations async + publish |
| `backend/routers/agent.py` | Modify | Make `agent_turn` async + publish nodes + branch |
| `backend/tests/test_commit_sse.py` | Create | Tests for SSE module, commit endpoint |
| `frontend/src/api.js` | Modify | Add `commitBranch` |
| `frontend/src/pages/ConversationView.jsx` | Modify | EventSource hook; branch-from-node panel form |
| `frontend/src/components/SendBox.jsx` | Modify | Add commit message row |
| `frontend/src/components/ConversationGraph.jsx` | Modify | Summary node visual; search overlay with `useReactFlow` |

---

## Task 1: SSE pub/sub module + stream endpoint

**Files:**
- Create: `backend/sse.py`
- Modify: `backend/routers/conversations.py`
- Create: `backend/tests/test_commit_sse.py`

- [ ] **Step 1: Write failing test for pub/sub**

```python
# backend/tests/test_commit_sse.py
import asyncio
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sse import subscribe, publish, unsubscribe, _channels

@pytest.mark.asyncio
async def test_publish_delivers_to_subscriber():
    q = await subscribe("conv-abc")
    await publish("conv-abc", "node_created", {"node": {"id": "x"}})
    msg = q.get_nowait()
    assert "node_created" in msg
    assert '"id": "x"' in msg
    unsubscribe("conv-abc", q)

@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery():
    q = await subscribe("conv-xyz")
    unsubscribe("conv-xyz", q)
    await publish("conv-xyz", "test_event", {})
    assert q.empty()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_commit_sse.py -v
```
Expected: `ModuleNotFoundError: No module named 'sse'`

- [ ] **Step 3: Create `backend/sse.py`**

```python
"""In-process SSE pub/sub.

publish() is async — call it with `await` from async route handlers.
Each subscriber gets its own asyncio.Queue. The event_generator
yields SSE-formatted strings and sends a heartbeat comment every 30s
to keep the connection alive through proxies.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

_channels: dict[str, list[asyncio.Queue]] = {}


async def subscribe(conv_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _channels.setdefault(conv_id, []).append(q)
    return q


def unsubscribe(conv_id: str, q: asyncio.Queue) -> None:
    ch = _channels.get(conv_id, [])
    if q in ch:
        ch.remove(q)


async def publish(conv_id: str, event_type: str, payload: dict) -> None:
    msg = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
    for q in list(_channels.get(conv_id, [])):
        await q.put(msg)


async def event_generator(conv_id: str, q: asyncio.Queue) -> AsyncIterator[str]:
    try:
        while True:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=30.0)
                yield msg
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        unsubscribe(conv_id, q)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && python -m pytest tests/test_commit_sse.py -v
```
Expected: 2 PASSED

- [ ] **Step 5: Add stream endpoint to `conversations.py`**

Add these imports at the top of `backend/routers/conversations.py`:
```python
from fastapi.responses import StreamingResponse
from sse import subscribe, event_generator
```

Add this route (after the existing routes):
```python
@router.get("/conversations/{conv_id}/stream")
async def stream_conversation(conv_id: uuid.UUID):
    """SSE stream for live graph updates in this conversation."""
    q = await subscribe(str(conv_id))
    return StreamingResponse(
        event_generator(str(conv_id), q),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
```

- [ ] **Step 6: Verify endpoint responds with correct content-type**

```bash
curl -s -N --max-time 3 http://localhost:8000/api/conversations/9f0ad37b-f4b9-56b4-9abd-bd51d830e396/stream &
sleep 2 && kill %1
```
Expected output includes `: heartbeat` within 30s (or just verify no 404/500).

- [ ] **Step 7: Commit**

```bash
git add backend/sse.py backend/routers/conversations.py backend/tests/test_commit_sse.py
git commit -m "feat: SSE pub/sub module and /conversations/{id}/stream endpoint"
```

---

## Task 2: LLM summarize function

**Files:**
- Modify: `backend/llm.py`
- Modify: `backend/tests/test_commit_sse.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_commit_sse.py`:
```python
from llm import summarize_nodes

def test_summarize_nodes_stub_when_no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    nodes = [
        {"role": "user", "content": "How do I reverse a list in Python?"},
        {"role": "assistant", "content": "Use list[::-1] or list.reverse()."},
    ]
    result = summarize_nodes(nodes)
    assert isinstance(result, str)
    assert len(result) > 0

def test_summarize_nodes_empty():
    result = summarize_nodes([])
    assert isinstance(result, str)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_commit_sse.py::test_summarize_nodes_stub_when_no_key -v
```
Expected: `ImportError` or `AttributeError: module 'llm' has no attribute 'summarize_nodes'`

- [ ] **Step 3: Add `summarize_nodes` to `backend/llm.py`**

Add after the existing `call_llm` function:

```python
def summarize_nodes(nodes: list[dict]) -> str:
    """Generate a 1-2 sentence summary of a list of conversation nodes.

    Used by the commit endpoint. Falls back to a stub if ANTHROPIC_API_KEY
    is not set or if the API call fails.
    """
    if not nodes:
        return "Empty commit — no messages to summarize."

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        preview = " | ".join(
            (n.get("content") or "")[:60] for n in nodes[:3]
        )
        return f"[Stub] Recent turns: {preview[:200]}"

    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    combined = "\n\n".join(
        f"[{n.get('role', 'unknown')}]: {n.get('content', '')}"
        for n in nodes
    )
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system=(
                "Summarize the following conversation turns in 1-2 sentences. "
                "Be concise and factual. Do not start with 'The conversation'."
            ),
            messages=[{"role": "user", "content": combined}],
        )
        return response.content[0].text
    except Exception as exc:
        import sys as _sys
        print(f"[llm.summarize_nodes] fallback: {type(exc).__name__}: {exc}",
              file=_sys.stderr)
        return f"[Summary unavailable: {type(exc).__name__}]"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_commit_sse.py::test_summarize_nodes_stub_when_no_key tests/test_commit_sse.py::test_summarize_nodes_empty -v
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/llm.py backend/tests/test_commit_sse.py
git commit -m "feat: add summarize_nodes() to llm.py for commit summarization"
```

---

## Task 3: Commit endpoint

**Files:**
- Modify: `backend/routers/branches.py`
- Modify: `backend/tests/test_commit_sse.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_commit_sse.py`:
```python
from fastapi.testclient import TestClient
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from main import app

ALEX_USER_ID = "2f75cca7-7ebc-5af0-a919-f0bfe59e4125"
RECIPEBOX_CONV_ID = "9f0ad37b-f4b9-56b4-9abd-bd51d830e396"
BR_MAIN_ID = "ae642808-6b30-58c5-833f-8e50045b5b63"

@pytest.fixture
def client():
    return TestClient(app)

def test_commit_creates_summary_node(client):
    # Create a fresh conversation with some turns first
    conv = client.post("/api/conversations", json={
        "title": f"commit-test-{os.urandom(4).hex()}",
        "owner_id": ALEX_USER_ID,
    }).json()
    conv_id = conv["id"]
    branch_id = conv["branches"][0]["id"] if "branches" in conv else \
        client.get(f"/api/conversations/{conv_id}").json()["branches"][0]["id"]
    head_id = client.get(f"/api/conversations/{conv_id}").json()["branches"][0]["head_node_id"]

    # Send a turn
    turn = client.post("/api/agent/turn", json={
        "node_id": head_id,
        "branch_id": branch_id,
        "user_message": "What is 2+2?",
        "budget": 4096,
    }).json()
    new_head = turn["assistant_node"]["id"]

    # Commit
    res = client.post(f"/api/branches/{branch_id}/commit", json={
        "commit_message": "First math question",
    })
    assert res.status_code == 201
    body = res.json()
    assert "node" in body
    assert body["node"]["node_type"] == "summary"
    assert body["node"]["role"] == "summary"
    assert body["commit_message"] == "First math question"
    assert "llm_summary" in body
    # Branch head should now point to the summary node
    branch = client.get(f"/api/branches/{branch_id}").json()
    assert branch["head_node_id"] == body["node"]["id"]

def test_commit_returns_400_when_head_is_already_summary(client):
    # Use RecipeBox main which likely has no summary; create one first
    # then try to commit again
    conv = client.post("/api/conversations", json={
        "title": f"commit-idempotent-{os.urandom(4).hex()}",
        "owner_id": ALEX_USER_ID,
    }).json()
    conv_id = conv["id"]
    branch_id = client.get(f"/api/conversations/{conv_id}").json()["branches"][0]["id"]
    head_id = client.get(f"/api/conversations/{conv_id}").json()["branches"][0]["head_node_id"]
    client.post("/api/agent/turn", json={
        "node_id": head_id, "branch_id": branch_id,
        "user_message": "hello", "budget": 4096,
    })
    # First commit succeeds
    r1 = client.post(f"/api/branches/{branch_id}/commit", json={"commit_message": "init"})
    assert r1.status_code == 201
    # Second commit with nothing new should fail
    r2 = client.post(f"/api/branches/{branch_id}/commit", json={"commit_message": "empty"})
    assert r2.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python -m pytest tests/test_commit_sse.py::test_commit_creates_summary_node -v
```
Expected: 404 or 422 (endpoint not found)

- [ ] **Step 3: Add CommitRequest schema and commit endpoint to `backend/routers/branches.py`**

Add imports at the top (after existing imports):
```python
from pydantic import BaseModel
from models.context import NodeSummary
from llm import summarize_nodes
from sse import publish
```

Add schema class (after existing imports, before routes):
```python
class CommitRequest(BaseModel):
    commit_message: str
```

Add the endpoint (after `archive_branch`, before `get_context`):
```python
@router.post("/branches/{branch_id}/commit", status_code=201)
async def commit_branch(
    branch_id: uuid.UUID,
    body: CommitRequest,
    db: Session = Depends(get_db),
):
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="Branch not found")

    head = db.query(Node).filter(Node.id == branch.head_node_id).first()
    if not head:
        raise HTTPException(status_code=400, detail="Branch has no head node")
    if head.node_type == "summary":
        raise HTTPException(status_code=400, detail="Nothing to commit — HEAD is already a summary node")

    # Walk ancestors back to the last summary node (exclusive) or root
    uncommitted: list[Node] = []
    current: Node | None = head
    while current:
        uncommitted.append(current)
        if current.parent_id is None:
            break
        parent = db.query(Node).filter(Node.id == current.parent_id).first()
        if parent is None or parent.node_type == "summary":
            break
        current = parent

    if not uncommitted:
        raise HTTPException(status_code=400, detail="Nothing to commit")

    # Build ordered context for LLM (oldest first, user/assistant only)
    context = [
        {"role": n.role or n.node_type, "content": n.content}
        for n in reversed(uncommitted)
        if n.role in ("user", "assistant")
    ]
    llm_summary = summarize_nodes(context)
    content = f"{body.commit_message}\n\n{llm_summary}"

    summary_node = Node(
        id=uuid.uuid4(),
        conversation_id=branch.conversation_id,
        parent_id=head.id,
        branch_id=branch.id,
        node_type="summary",
        role="summary",
        content=content,
        token_count=int(len(content.split()) * 1.3),
    )
    db.add(summary_node)
    db.flush()

    for n in uncommitted:
        db.add(NodeSummary(
            summary_node_id=summary_node.id,
            summarized_node_id=n.id,
        ))

    branch.head_node_id = summary_node.id
    db.execute(
        text("UPDATE conversations SET updated_at = now() WHERE id = :cid"),
        {"cid": str(branch.conversation_id)},
    )
    db.commit()
    db.refresh(summary_node)
    db.refresh(branch)

    node_dict = {
        "id": str(summary_node.id),
        "conversation_id": str(summary_node.conversation_id),
        "parent_id": str(summary_node.parent_id),
        "branch_id": str(summary_node.branch_id),
        "node_type": summary_node.node_type,
        "role": summary_node.role,
        "content": summary_node.content,
        "token_count": summary_node.token_count,
        "created_at": str(summary_node.created_at),
    }
    await publish(str(branch.conversation_id), "commit_created", {
        "node": node_dict,
        "branch": _branch_to_dict(branch),
    })

    return {"node": node_dict, "commit_message": body.commit_message, "llm_summary": llm_summary}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python -m pytest tests/test_commit_sse.py::test_commit_creates_summary_node tests/test_commit_sse.py::test_commit_returns_400_when_head_is_already_summary -v
```
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add backend/routers/branches.py backend/tests/test_commit_sse.py
git commit -m "feat: POST /branches/{id}/commit — create summary node with LLM summary"
```

---

## Task 4: Wire SSE publish to all mutation endpoints

**Files:**
- Modify: `backend/routers/context.py`
- Modify: `backend/routers/branches.py`
- Modify: `backend/routers/agent.py`

All endpoints that mutate state need to become `async def` and call `await publish(...)` after the DB commit.

- [ ] **Step 1: Update `backend/routers/context.py`**

Replace the entire file with:

```python
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from models.core import Branch
from models.context import ContextPin, ContextImport
from sse import publish

router = APIRouter()


class PinCreate(BaseModel):
    node_id: uuid.UUID
    pinned_by: uuid.UUID
    priority: int = 0
    reason: Optional[str] = None


class ImportCreate(BaseModel):
    source_node_id: uuid.UUID
    imported_by: uuid.UUID
    include_descendants: bool = False


def _get_conv_id(branch_id: uuid.UUID, db: Session) -> str | None:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    return str(branch.conversation_id) if branch else None


@router.post("/branches/{branch_id}/pins", status_code=201)
async def create_pin(branch_id: uuid.UUID, body: PinCreate, db: Session = Depends(get_db)):
    pin = ContextPin(
        id=uuid.uuid4(),
        branch_id=branch_id,
        node_id=body.node_id,
        pinned_by=body.pinned_by,
        reason=body.reason,
        priority=body.priority,
    )
    try:
        db.add(pin)
        db.commit()
        db.refresh(pin)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Node already pinned on this branch")
    pin_dict = {
        "id": str(pin.id),
        "branch_id": str(pin.branch_id),
        "node_id": str(pin.node_id),
        "pinned_by": str(pin.pinned_by),
        "reason": pin.reason,
        "priority": pin.priority,
        "created_at": str(pin.created_at),
    }
    conv_id = _get_conv_id(branch_id, db)
    if conv_id:
        await publish(conv_id, "pin_created", {"pin": pin_dict})
    return pin_dict


@router.get("/branches/{branch_id}/pins")
def list_pins(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    pins = (
        db.query(ContextPin)
        .filter(ContextPin.branch_id == branch_id)
        .order_by(ContextPin.priority.desc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "branch_id": str(p.branch_id),
            "node_id": str(p.node_id),
            "pinned_by": str(p.pinned_by),
            "reason": p.reason,
            "priority": p.priority,
            "created_at": str(p.created_at),
        }
        for p in pins
    ]


@router.delete("/pins/{pin_id}", status_code=204)
async def delete_pin(pin_id: uuid.UUID, db: Session = Depends(get_db)):
    pin = db.query(ContextPin).filter(ContextPin.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    conv_id = _get_conv_id(pin.branch_id, db)
    branch_id = str(pin.branch_id)
    stored_pin_id = str(pin.id)
    db.delete(pin)
    db.commit()
    if conv_id:
        await publish(conv_id, "pin_deleted", {"pin_id": stored_pin_id, "branch_id": branch_id})
    return Response(status_code=204)


@router.post("/branches/{branch_id}/imports", status_code=201)
async def create_import(branch_id: uuid.UUID, body: ImportCreate, db: Session = Depends(get_db)):
    imp = ContextImport(
        id=uuid.uuid4(),
        target_branch_id=branch_id,
        source_node_id=body.source_node_id,
        include_descendants=body.include_descendants,
        imported_by=body.imported_by,
    )
    db.add(imp)
    db.commit()
    db.refresh(imp)
    imp_dict = {
        "id": str(imp.id),
        "target_branch_id": str(imp.target_branch_id),
        "source_node_id": str(imp.source_node_id),
        "include_descendants": imp.include_descendants,
        "imported_by": str(imp.imported_by),
        "imported_at": str(imp.imported_at),
    }
    conv_id = _get_conv_id(branch_id, db)
    if conv_id:
        await publish(conv_id, "import_created", {"import": imp_dict})
    return imp_dict


@router.get("/branches/{branch_id}/imports")
def list_imports(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    imports = (
        db.query(ContextImport)
        .filter(ContextImport.target_branch_id == branch_id)
        .order_by(ContextImport.imported_at.desc())
        .all()
    )
    return [
        {
            "id": str(i.id),
            "target_branch_id": str(i.target_branch_id),
            "source_node_id": str(i.source_node_id),
            "include_descendants": i.include_descendants,
            "imported_by": str(i.imported_by),
            "imported_at": str(i.imported_at),
        }
        for i in imports
    ]


@router.delete("/imports/{import_id}", status_code=204)
async def delete_import(import_id: uuid.UUID, db: Session = Depends(get_db)):
    imp = db.query(ContextImport).filter(ContextImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found")
    conv_id = _get_conv_id(imp.target_branch_id, db)
    stored_import_id = str(imp.id)
    branch_id = str(imp.target_branch_id)
    db.delete(imp)
    db.commit()
    if conv_id:
        await publish(conv_id, "import_deleted", {"import_id": stored_import_id, "branch_id": branch_id})
    return Response(status_code=204)
```

- [ ] **Step 2: Update `create_branch` in `backend/routers/branches.py`**

Change `create_branch` from `def` to `async def` and add publish after commit:

```python
# At top of branches.py, add:
from sse import publish

# Change the function signature and add publish:
@router.post("/conversations/{conv_id}/branches", status_code=201)
async def create_branch(conv_id: uuid.UUID, body: BranchCreate, db: Session = Depends(get_db)):
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
    branch_dict = _branch_to_dict(branch)
    await publish(str(conv_id), "branch_updated", {"branch": branch_dict})
    return branch_dict
```

- [ ] **Step 3: Update `agent_turn` in `backend/routers/agent.py`**

Change `agent_turn` to `async def` and publish after commit:

```python
# Add import at top of agent.py:
from sse import publish

# Change signature:
@router.post("/agent/turn")
async def agent_turn(body: AgentTurnRequest, db: Session = Depends(get_db)):
    # ... (all existing logic unchanged until the return statement) ...

    # After db.commit() and db.refresh() calls, add:
    db.refresh(branch)
    await publish(str(parent.conversation_id), "node_created", {"node": _node_to_dict(user_node)})
    await publish(str(parent.conversation_id), "node_created", {"node": _node_to_dict(assistant_node)})
    await publish(str(parent.conversation_id), "branch_updated", {"branch": _branch_to_dict(branch)})

    return { ... }  # existing return unchanged
```

Note: `_branch_to_dict` doesn't exist in `agent.py`. Add it:
```python
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
```

- [ ] **Step 4: Verify existing tests still pass**

```bash
cd backend && python -m pytest tests/ -v --ignore=tests/test_commit_sse.py -x
```
Expected: all existing tests pass (the async change is backward-compatible with TestClient)

- [ ] **Step 5: Commit**

```bash
git add backend/routers/context.py backend/routers/branches.py backend/routers/agent.py
git commit -m "feat: wire SSE publish to all mutation endpoints (pin, import, branch, agent turn)"
```

---

## Task 5: Frontend api.js + EventSource in ConversationView

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/pages/ConversationView.jsx`

- [ ] **Step 1: Add `commitBranch` to `frontend/src/api.js`**

In the `api` object, after `getImports`:
```javascript
commitBranch: (branchId, data) =>
  request(`/branches/${branchId}/commit`, { method: "POST", body: JSON.stringify(data) }),
```

- [ ] **Step 2: Add SSE EventSource hook to `ConversationView.jsx`**

Add this `useEffect` (after the existing `refreshPinsAndImports` effect, before any handler functions). It handles all SSE events with targeted state merges:

```javascript
// SSE live updates
useEffect(() => {
  const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
  const es = new EventSource(`${API_URL}/conversations/${id}/stream`);

  es.addEventListener("node_created", (e) => {
    const { node } = JSON.parse(e.data);
    setAllNodes((prev) => prev.some((n) => n.id === node.id) ? prev : [...prev, node]);
  });

  es.addEventListener("branch_updated", (e) => {
    const { branch } = JSON.parse(e.data);
    setBranches((prev) => {
      const exists = prev.some((b) => b.id === branch.id);
      return exists
        ? prev.map((b) => (b.id === branch.id ? branch : b))
        : [...prev, branch];
    });
    setSelected((prev) => (prev?.id === branch.id ? branch : prev));
  });

  es.addEventListener("pin_created", (e) => {
    const { pin } = JSON.parse(e.data);
    setAllPins((prev) => prev.some((p) => p.id === pin.id) ? prev : [...prev, pin]);
  });

  es.addEventListener("pin_deleted", (e) => {
    const { pin_id } = JSON.parse(e.data);
    setAllPins((prev) => prev.filter((p) => p.id !== pin_id));
  });

  es.addEventListener("import_created", (e) => {
    const { import: imp } = JSON.parse(e.data);
    setAllImports((prev) => prev.some((i) => i.id === imp.id) ? prev : [...prev, imp]);
  });

  es.addEventListener("import_deleted", (e) => {
    const { import_id } = JSON.parse(e.data);
    setAllImports((prev) => prev.filter((i) => i.id !== import_id));
  });

  es.addEventListener("commit_created", (e) => {
    const { node, branch } = JSON.parse(e.data);
    setAllNodes((prev) => prev.some((n) => n.id === node.id) ? prev : [...prev, node]);
    setBranches((prev) => prev.map((b) => (b.id === branch.id ? branch : b)));
    setSelected((prev) => (prev?.id === branch.id ? branch : prev));
  });

  es.onerror = () => { /* SSE auto-reconnects; suppress console noise */ };

  return () => es.close();
}, [id]);
```

- [ ] **Step 3: Remove manual refreshes that SSE now covers**

In `handleTurnComplete`, remove the `api.getBranch` + `setSelected` + `setBranches` logic since SSE now handles branch state. Replace with an empty function (or keep `refreshContext` for thread view):

```javascript
const handleTurnComplete = () => {
  refreshContext();   // still needed for thread view
};
```

- [ ] **Step 4: Verify in browser**

Start dev server (`npm run dev` in frontend/). Open the RecipeBox conversation. Open graph tab. In another terminal, hit the pin endpoint manually:
```bash
curl -s -X POST http://localhost:8000/api/branches/ae642808-6b30-58c5-833f-8e50045b5b63/pins \
  -H "Content-Type: application/json" \
  -d '{"node_id":"1c43c0c9-05cc-5f6f-8522-6e3d167a1e20","pinned_by":"2f75cca7-7ebc-5af0-a919-f0bfe59e4125","priority":5}'
```
Expected: graph updates immediately showing pin indicator without page refresh.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/ConversationView.jsx
git commit -m "feat: SSE EventSource in ConversationView — live graph updates on all mutations"
```

---

## Task 6: SendBox commit UI

**Files:**
- Modify: `frontend/src/components/SendBox.jsx`
- Modify: `frontend/src/pages/ConversationView.jsx`

- [ ] **Step 1: Update `SendBox.jsx` to add commit row**

Replace the entire file:

```jsx
import { useState } from "react";
import { api } from "../api";

export default function SendBox({ headNodeId, branchId, conversationId, onTurnComplete, isHeadSummary }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || !headNodeId) return;
    setSending(true);
    try {
      await api.agentTurn({ node_id: headNodeId, branch_id: branchId, user_message: message.trim(), budget: 4096 });
      setMessage("");
      onTurnComplete?.();
    } catch (err) { console.error("Send failed:", err); }
    setSending(false);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || !branchId) return;
    setCommitting(true);
    try {
      await api.commitBranch(branchId, { commit_message: commitMsg.trim() });
      setCommitMsg("");
      onTurnComplete?.();
    } catch (err) { console.error("Commit failed:", err); }
    setCommitting(false);
  };

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 space-y-2">
      {/* Chat row */}
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={headNodeId ? "Send a message..." : "Select a branch first"}
          disabled={!headNodeId || sending}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)] focus:ring-2 focus:ring-[var(--color-blue-ring)] disabled:opacity-50 transition-all"
        />
        <button
          onClick={handleSend}
          disabled={!headNodeId || !message.trim() || sending}
          className="px-4 py-2 rounded-lg bg-[var(--color-blue)] text-white text-sm font-medium hover:brightness-95 disabled:opacity-40 transition-all"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>

      {/* Commit row */}
      <div className="flex gap-2">
        <input
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCommit()}
          placeholder="Commit message..."
          disabled={!branchId || committing || isHeadSummary}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-amber)] focus:ring-2 focus:ring-[var(--color-amber-dim)] disabled:opacity-50 transition-all"
        />
        <button
          onClick={handleCommit}
          disabled={!branchId || !commitMsg.trim() || committing || isHeadSummary}
          title={isHeadSummary ? "Nothing to commit — HEAD is already a summary" : "Commit recent messages"}
          className="px-4 py-2 rounded-lg bg-[var(--color-amber)] text-white text-sm font-medium hover:brightness-95 disabled:opacity-40 transition-all"
        >
          {committing ? "..." : "Commit"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pass `isHeadSummary` from `ConversationView.jsx`**

In `ConversationView.jsx`, compute `isHeadSummary` from `allNodes`:

```javascript
const isHeadSummary = useMemo(
  () => allNodes.find((n) => n.id === selected?.head_node_id)?.node_type === "summary",
  [allNodes, selected]
);
```

Add `useMemo` to the import if not already there.

Then update the `<SendBox>` render:
```jsx
<SendBox
  headNodeId={selected?.head_node_id}
  branchId={selected?.id}
  conversationId={id}
  onTurnComplete={handleTurnComplete}
  isHeadSummary={isHeadSummary}
/>
```

- [ ] **Step 3: Verify in browser**

Send a message. The Commit button should be enabled. Type a commit message and click Commit. Expected:
- The graph auto-updates with a `Σ` node at the tip of the branch
- The Commit input clears
- The Commit button becomes disabled (HEAD is now summary)
- Sending another message re-enables the Commit button

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SendBox.jsx frontend/src/pages/ConversationView.jsx
git commit -m "feat: commit row in SendBox — commit message input triggers branch summarization"
```

---

## Task 7: Summary node visual + in-graph search overlay

**Files:**
- Modify: `frontend/src/components/ConversationGraph.jsx`

- [ ] **Step 1: Update `GraphNode` to render summary nodes with double-ring shadow**

In `GraphNode`, add `isSummary` detection and update the `boxShadow` style:

```jsx
function GraphNode({ data, selected }) {
  const c = data._colors;
  const icon = roleIcons[data.role] || roleIcons[data.node_type] || "?";
  const isHead = data._isHead;
  const isPinned = data._isPinned;
  const isImportSource = data._isImportSource;
  const isSummary = data.node_type === "summary" || data.role === "summary";

  return (
    <>
      {/* ... handles + NodeToolbar unchanged ... */}
      <div
        className="rounded-lg border-2 px-2 py-1.5 text-left cursor-pointer transition-all duration-150"
        style={{
          width: NODE_W,
          background: selected ? c.light : "white",
          borderColor: selected ? c.main : isPinned ? PIN_COLOR : `${c.main}25`,
          boxShadow: selected
            ? `0 0 0 3px ${c.ring}`
            : isSummary
            ? `0 0 0 2px ${c.main}50, 0 0 0 5px ${c.ring}`
            : isHead
            ? `0 2px 8px ${c.main}20`
            : "0 1px 3px rgba(0,0,0,0.04)",
          outline: isImportSource ? `2px dashed ${IMPORT_COLOR}40` : undefined,
          outlineOffset: "2px",
        }}
      >
        {/* ... inner content unchanged ... */}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Update label computation for summary nodes to use commit message (first line)**

In the `flowNodeList` building block inside the `useMemo`, change the label logic:

```javascript
// Replace the existing label computation:
const isSummaryNode = n.node_type === "summary";
const rawLabel = isSummaryNode
  ? (n.content || "").split("\n")[0]   // first line = commit message
  : (n.content || "").split(/\s+/).slice(0, 5).join(" ");
const label = rawLabel.length > 32 ? rawLabel.slice(0, 32) + "…" : rawLabel;
```

Also pass `isSummaryNode` into data so `GraphNode` can read it as `node_type`:
```javascript
flowNodeList.push({
  id: n.id,
  type: "graphNode",
  data: {
    ...n,
    _branchName: branchName,
    _colors: colors,
    _isHead: isHead,
    _label: label,
    _hovered: false,
    _isPinned: !!pinnedOnBranches,
    _pinnedOnBranches: pinnedOnBranches || [],
    _isImportSource: !!importedByBranches,
    _importedByBranches: importedByBranches || [],
  },
  position: { x: 0, y: 0 },
});
```
(No change needed here — `node_type` is already spread from `...n`.)

- [ ] **Step 3: Add `SearchOverlay` component inside `ConversationGraph.jsx`**

Add this component definition before `ConversationGraph` (after `nodeTypes`). It uses `useReactFlow` which requires being rendered as a child of `<ReactFlow>`:

```jsx
import { api } from "../api";

function SearchOverlay({ conversationId, userId, onNodeSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const { fitView } = useReactFlow();
  const inputRef = useCallback((el) => el && (el._timer = undefined), []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(query, userId, 20);
        const rows = Array.isArray(data) ? data : [];
        const filtered = rows.filter((r) => r.conversation_id === conversationId);
        setResults(filtered.slice(0, 8));
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, conversationId, userId]);

  const handleSelect = (r) => {
    onNodeSelect({ id: r.node_id, ...r });
    fitView({ nodes: [{ id: r.node_id }], padding: 0.4, duration: 300 });
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="absolute top-3 right-3 z-10 w-64">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setQuery(""))}
        placeholder="Search nodes…"
        className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-white shadow-sm focus:outline-none focus:border-[var(--color-blue)] focus:ring-1 focus:ring-[var(--color-blue-ring)]"
      />
      {open && (
        <div className="mt-1 bg-white border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">No matches in this conversation</div>
          ) : results.map((r) => (
            <button
              key={r.node_id}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-2)] border-b border-[var(--color-border)] last:border-0"
            >
              <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded text-white mr-1.5" style={{ background: "#6b7280" }}>
                {r.role || "?"}
              </span>
              <span className="text-[11px] text-gray-600">{(r.content || "").slice(0, 60)}…</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `ConversationGraph` component signature and render `SearchOverlay` inside `<ReactFlow>`**

Change the component signature:
```jsx
export default function ConversationGraph({
  allNodes, branches, pins = [], imports = [],
  onNodeSelect, selectedNodeId,
  conversationId, userId,
}) {
```

Inside the `<ReactFlow>` block, add `SearchOverlay` as a child (it renders as a positioned element within the ReactFlow context):
```jsx
<ReactFlow ...>
  <Background color="#e5e5e5" gap={20} size={1} />
  <Controls ... />
  <MiniMap ... />
  {conversationId && userId && (
    <SearchOverlay
      conversationId={conversationId}
      userId={userId}
      onNodeSelect={onNodeSelect}
    />
  )}
</ReactFlow>
```

- [ ] **Step 5: Pass new props from `ConversationView.jsx`**

```jsx
import { DEFAULT_USER_ID } from "../api";

// In the render:
<ConversationGraph
  allNodes={allNodes}
  branches={branches}
  pins={allPins}
  imports={allImports}
  onNodeSelect={handleGraphNodeSelect}
  selectedNodeId={selectedGraphNode?.id}
  conversationId={id}
  userId={DEFAULT_USER_ID}
/>
```

- [ ] **Step 6: Verify in browser**

Open graph tab. Type a word that appears in a node content in the search box. Expected: dropdown appears with matching nodes. Click one: the graph pans/zooms to that node and the detail panel opens on the right.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ConversationGraph.jsx frontend/src/pages/ConversationView.jsx
git commit -m "feat: summary node double-ring visual, commit message label, and in-graph search overlay"
```

---

## Task 8: Branch from any node in detail panel

**Files:**
- Modify: `frontend/src/pages/ConversationView.jsx`

- [ ] **Step 1: Add branch-creation state to `ConversationView.jsx`**

Add these state variables (near the other graph-related state):
```javascript
const [makingBranch, setMakingBranch] = useState(false);
const [newBranchName, setNewBranchName] = useState("");
const [branchCreateError, setBranchCreateError] = useState("");
```

- [ ] **Step 2: Add `handleCreateBranchFromNode` handler**

```javascript
const handleCreateBranchFromNode = async () => {
  if (!newBranchName.trim() || !selectedGraphNode) return;
  setBranchCreateError("");
  try {
    const br = await api.createBranch(id, {
      name: newBranchName.trim(),
      fork_node_id: selectedGraphNode.id,
      created_by: DEFAULT_USER_ID,
    });
    // SSE branch_updated will add to branches, but pre-emptively select the new one
    setSelected(br);
    setBranches((prev) => {
      const exists = prev.some((b) => b.id === br.id);
      return exists ? prev : [...prev, br];
    });
    setMakingBranch(false);
    setNewBranchName("");
  } catch (err) {
    const detail = await err?.json?.().catch(() => null);
    if (detail?.detail?.includes("already")) {
      setBranchCreateError("Branch name already exists.");
    } else {
      setBranchCreateError("Failed to create branch.");
    }
  }
};
```

- [ ] **Step 3: Add "Create branch here" UI in the node detail panel**

In the `{tab === "graph" && selectedGraphNode && ...}` panel, in the Actions section, add after the Import button:

```jsx
{/* Branch creation */}
<div className="mt-1 pt-1 border-t border-[var(--color-border)]">
  {!makingBranch ? (
    <button
      onClick={() => { setMakingBranch(true); setBranchCreateError(""); }}
      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-dim)] hover:border-[var(--color-blue)] hover:text-[var(--color-blue)] hover:bg-[var(--color-blue-dim)] transition-colors text-left"
    >
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      Create branch here
    </button>
  ) : (
    <div className="space-y-1.5">
      <input
        value={newBranchName}
        onChange={(e) => setNewBranchName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleCreateBranchFromNode()}
        placeholder="Branch name…"
        autoFocus
        className="w-full px-2 py-1.5 text-xs rounded border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-blue)]"
      />
      {branchCreateError && (
        <p className="text-[10px] text-[var(--color-red)]">{branchCreateError}</p>
      )}
      <div className="flex gap-1.5">
        <button
          onClick={handleCreateBranchFromNode}
          disabled={!newBranchName.trim()}
          className="flex-1 px-2 py-1 text-xs rounded bg-[var(--color-blue)] text-white font-medium disabled:opacity-40"
        >
          Create
        </button>
        <button
          onClick={() => { setMakingBranch(false); setNewBranchName(""); setBranchCreateError(""); }}
          className="px-2 py-1 text-xs rounded border border-[var(--color-border)] text-[var(--color-text-dim)]"
        >
          Cancel
        </button>
      </div>
    </div>
  )}
</div>
```

- [ ] **Step 4: Reset branch form when selected node changes**

Add to the `handleGraphNodeSelect` function:
```javascript
const handleGraphNodeSelect = (nodeData) => {
  setSelectedGraphNode(nodeData);
  setMakingBranch(false);
  setNewBranchName("");
  setBranchCreateError("");
};
```

- [ ] **Step 5: Verify in browser**

Open graph tab. Click any node (not HEAD). The right panel shows "Create branch here". Click it, type a branch name, press Create. Expected:
- New branch appears in the sidebar immediately
- New branch is auto-selected
- Graph updates with the new fork edge (via SSE `branch_updated`)
- Trying a duplicate name shows "Branch name already exists."

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ConversationView.jsx
git commit -m "feat: branch-from-any-node button in graph node detail panel"
```

---

## Self-Review

**Spec coverage:**
- ✅ Commit: Task 3 (endpoint) + Task 6 (SendBox UI)
- ✅ Node summarizer: Task 2 (`summarize_nodes`) + Task 7 (graph visual)
- ✅ SSE real-time updates: Task 1 (infra) + Task 4 (wire to mutations) + Task 5 (frontend EventSource)
- ✅ Search in graph: Task 7 (`SearchOverlay` + `fitView`)
- ✅ Branch from any node: Task 8
- ✅ Summary node label = commit message (Task 7 Step 2)
- ✅ Summary node 1-2 sentence panel detail (stored as second paragraph in content)
- ✅ Commit button disabled when HEAD is summary (Task 6)
- ✅ 409 duplicate branch name handled (Task 8 Step 2)

**Placeholder scan:** None found.

**Type consistency:**
- `publish(conv_id, event_type, payload)` — same signature throughout Tasks 1, 3, 4
- `_branch_to_dict(branch)` — used in branches.py (already exists) and agent.py (added in Task 4)
- `SearchOverlay` receives `conversationId`, `userId`, `onNodeSelect` — passed correctly in Task 7 Step 4-5
- `isHeadSummary` prop flows from ConversationView (Task 6 Step 2) → SendBox (Task 6 Step 1) ✅
- SSE event `branch_updated` used both for creation and update — frontend handler handles both cases (Task 5 Step 2) ✅
