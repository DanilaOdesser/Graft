# DEV-B "Edits & Search Path" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all DEV-B-owned backend models (7 tables), API endpoints (nodes, pins, imports, search, divergence), CLI ingestion tool, integration tests, frontend components (search page, cherry-pick modal, pins panel), deploy frontend to Vercel, and write the project documentation.

**Architecture:** FastAPI backend with SQLAlchemy 2.0 ORM models for 7 supporting tables (node_ancestry, context_pins, context_imports, node_summaries, tags, node_tags, branch_shares). Endpoints execute Queries 2 & 3 via raw SQL using `session.execute(text(SQL), params)`. Frontend components are React + Tailwind plugging into DEV-A's scaffold. The CLI ingestion tool parses plain-text transcripts and chains nodes via the API.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, PostgreSQL (Supabase), React + Vite + Tailwind CSS, Vercel (frontend deployment)

**Prerequisites from DEV-A (Merge Point 1):**
- `backend/main.py` — FastAPI app with health check + CORS
- `backend/db.py` — SQLAlchemy engine + session factory
- `backend/models/__init__.py` — empty, ready for imports
- `backend/requirements.txt` — fastapi, uvicorn, sqlalchemy, psycopg2-binary, python-dotenv
- `frontend/` — full Vite+React+Tailwind scaffold
- `frontend/src/api.js` — complete API client with ALL endpoint functions (including DEV-B's)
- Database: DDL executed, trigger verified, seed data loaded (Phase 0 done jointly)

---

## File Structure

```
backend/
├── models/
│   ├── __init__.py          # [MODIFY] Add context model imports
│   └── context.py           # [CREATE] 7 SQLAlchemy models
├── routers/
│   ├── nodes.py             # [CREATE] Node CRUD endpoints
│   ├── context.py           # [CREATE] Pins + imports endpoints
│   └── search.py            # [CREATE] Search + divergence endpoints
scripts/
├── ingest.py                # [CREATE] CLI transcript ingestion tool
├── test_integration.py      # [CREATE] Integration test suite
frontend/src/
├── pages/
│   └── SearchPage.jsx       # [CREATE] Search page (route: /search)
├── components/
│   ├── SearchResults.jsx    # [CREATE] Search result cards
│   ├── ImportModal.jsx      # [CREATE] Cherry-pick modal
│   └── PinsPanel.jsx        # [CREATE] Pinned context sidebar
docs/
└── writeup.md               # [CREATE] Final project write-up
```

---

## Task 1: SQLAlchemy Models for 7 Supporting Tables

**Files:**
- Create: `backend/models/context.py`
- Modify: `backend/models/__init__.py`

- [ ] **Step 1: Write the failing test — verify models import**

Create a quick smoke test that imports all models:

```python
# scripts/test_models.py
import sys
sys.path.insert(0, 'backend')

from models.context import (
    NodeAncestry, ContextPin, ContextImport,
    NodeSummary, Tag, NodeTag, BranchShare
)

print("All 7 DEV-B models imported successfully")
for cls in [NodeAncestry, ContextPin, ContextImport, NodeSummary, Tag, NodeTag, BranchShare]:
    print(f"  {cls.__tablename__}")
```

Run: `cd /Users/amirali.iranmanesh/welp/Graft && python scripts/test_models.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'models.context'`

- [ ] **Step 2: Create `backend/models/context.py` with all 7 models**

```python
# backend/models/context.py
import uuid
from sqlalchemy import (
    Column, String, Text, Boolean, SmallInteger, Integer,
    ForeignKey, UniqueConstraint, CheckConstraint, TIMESTAMP
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from db import Base


class NodeAncestry(Base):
    """Read-only closure table. Maintained by DB trigger, never written by app."""
    __tablename__ = "node_ancestry"

    ancestor_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    descendant_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    depth = Column(Integer, nullable=False)


class ContextPin(Base):
    __tablename__ = "context_pins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    pinned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason = Column(Text)
    priority = Column(SmallInteger, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("branch_id", "node_id", name="uq_pin_branch_node"),
    )


class ContextImport(Base):
    __tablename__ = "context_imports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    include_descendants = Column(Boolean, nullable=False, default=False)
    imported_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    imported_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class NodeSummary(Base):
    __tablename__ = "node_summaries"

    summary_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    summarized_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)


class Tag(Base):
    __tablename__ = "tags"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(50), unique=True, nullable=False)


class NodeTag(Base):
    __tablename__ = "node_tags"

    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    tag_id = Column(UUID(as_uuid=True), ForeignKey("tags.id"), primary_key=True)


class BranchShare(Base):
    __tablename__ = "branch_shares"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    shared_with = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    permission = Column(
        String(20),
        CheckConstraint("permission IN ('view', 'fork', 'comment')"),
        nullable=False,
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("branch_id", "shared_with", name="uq_share_branch_user"),
    )
```

- [ ] **Step 3: Add imports to `backend/models/__init__.py`**

Add after DEV-A's existing imports:

```python
# DEV-B models
from models.context import (
    NodeAncestry, ContextPin, ContextImport,
    NodeSummary, Tag, NodeTag, BranchShare
)
```

- [ ] **Step 4: Run the smoke test to verify models load**

Run: `cd /Users/amirali.iranmanesh/welp/Graft && python scripts/test_models.py`
Expected: `All 7 DEV-B models imported successfully` with all 7 table names printed.

- [ ] **Step 5: Commit**

```bash
git add backend/models/context.py backend/models/__init__.py scripts/test_models.py
git commit -m "feat(models): add 7 DEV-B SQLAlchemy models (context tables)"
```

---

## Task 2: Nodes Router — Create and Read Nodes

**Files:**
- Create: `backend/routers/nodes.py`
- Test: via curl

- [ ] **Step 1: Write the failing test — curl POST /api/nodes**

```bash
curl -s -X POST http://localhost:8000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "00000000-0000-0000-0000-000000000010", "parent_id": null, "branch_id": "00000000-0000-0000-0000-000000000020", "node_type": "message", "role": "user", "content": "Test node"}' | python -m json.tool
```

Expected: 404 (route doesn't exist yet)

- [ ] **Step 2: Create `backend/routers/nodes.py`**

```python
# backend/routers/nodes.py
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from models.core import Node, Branch, Conversation

router = APIRouter()


class NodeCreate(BaseModel):
    conversation_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    branch_id: uuid.UUID
    node_type: str
    role: Optional[str] = None
    content: str


class NodeResponse(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    branch_id: uuid.UUID
    node_type: str
    role: Optional[str]
    content: str
    token_count: int
    created_at: str

    class Config:
        from_attributes = True


@router.post("/nodes", status_code=201)
def create_node(body: NodeCreate, db: Session = Depends(get_db)):
    token_count = int(len(body.content.split()) * 1.3)

    node = Node(
        id=uuid.uuid4(),
        conversation_id=body.conversation_id,
        parent_id=body.parent_id,
        branch_id=body.branch_id,
        node_type=body.node_type,
        role=body.role,
        content=body.content,
        token_count=token_count,
    )
    db.add(node)
    db.flush()

    # Advance the branch's head_node_id
    branch = db.query(Branch).filter(Branch.id == body.branch_id).first()
    if branch:
        branch.head_node_id = node.id

    # Update conversation's updated_at
    db.execute(
        text("UPDATE conversations SET updated_at = now() WHERE id = :cid"),
        {"cid": str(body.conversation_id)},
    )

    db.commit()
    db.refresh(node)
    return node


@router.get("/nodes/{node_id}")
def get_node(node_id: uuid.UUID, db: Session = Depends(get_db)):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node
```

- [ ] **Step 3: Run the dev server and test with curl**

Run: `cd /Users/amirali.iranmanesh/welp/Graft/backend && uvicorn main:app --reload`

```bash
# Create a node (use valid UUIDs from seed data)
curl -s -X POST http://localhost:8000/api/nodes \
  -H "Content-Type: application/json" \
  -d '{"conversation_id": "<conv-uuid>", "parent_id": "<node-uuid>", "branch_id": "<branch-uuid>", "node_type": "message", "role": "user", "content": "Test node from DEV-B"}' | python -m json.tool

# Read it back
curl -s http://localhost:8000/api/nodes/<returned-id> | python -m json.tool
```

Expected: 201 with node JSON on create, 200 with node JSON on read.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/nodes.py
git commit -m "feat(api): add nodes CRUD endpoints (POST + GET)"
```

---

## Task 3: Context Router — Pins and Imports Endpoints

**Files:**
- Create: `backend/routers/context.py`
- Test: via curl

- [ ] **Step 1: Write the failing test — curl POST /api/branches/{id}/pins**

```bash
curl -s -X POST http://localhost:8000/api/branches/<branch-uuid>/pins \
  -H "Content-Type: application/json" \
  -d '{"node_id": "<node-uuid>", "priority": 10, "reason": "Test pin", "pinned_by": "<user-uuid>"}' | python -m json.tool
```

Expected: 404 (route doesn't exist yet)

- [ ] **Step 2: Create `backend/routers/context.py`**

```python
# backend/routers/context.py
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from models.context import ContextPin, ContextImport

router = APIRouter()


# === Pin schemas ===

class PinCreate(BaseModel):
    node_id: uuid.UUID
    pinned_by: uuid.UUID
    priority: int = 0
    reason: Optional[str] = None


class ImportCreate(BaseModel):
    source_node_id: uuid.UUID
    imported_by: uuid.UUID
    include_descendants: bool = False


# === Pin endpoints ===

@router.post("/branches/{branch_id}/pins", status_code=201)
def create_pin(branch_id: uuid.UUID, body: PinCreate, db: Session = Depends(get_db)):
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
    return pin


@router.get("/branches/{branch_id}/pins")
def list_pins(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    pins = (
        db.query(ContextPin)
        .filter(ContextPin.branch_id == branch_id)
        .order_by(ContextPin.priority.desc())
        .all()
    )
    return pins


@router.delete("/pins/{pin_id}", status_code=204)
def delete_pin(pin_id: uuid.UUID, db: Session = Depends(get_db)):
    pin = db.query(ContextPin).filter(ContextPin.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    db.delete(pin)
    db.commit()
    return Response(status_code=204)


# === Import endpoints ===

@router.post("/branches/{branch_id}/imports", status_code=201)
def create_import(branch_id: uuid.UUID, body: ImportCreate, db: Session = Depends(get_db)):
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
    return imp


@router.get("/branches/{branch_id}/imports")
def list_imports(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    imports = (
        db.query(ContextImport)
        .filter(ContextImport.target_branch_id == branch_id)
        .order_by(ContextImport.imported_at.desc())
        .all()
    )
    return imports


@router.delete("/imports/{import_id}", status_code=204)
def delete_import(import_id: uuid.UUID, db: Session = Depends(get_db)):
    imp = db.query(ContextImport).filter(ContextImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found")
    db.delete(imp)
    db.commit()
    return Response(status_code=204)
```

- [ ] **Step 3: Test all 6 endpoints with curl**

```bash
# Create pin
curl -s -X POST http://localhost:8000/api/branches/<branch-uuid>/pins \
  -H "Content-Type: application/json" \
  -d '{"node_id": "<node-uuid>", "priority": 10, "reason": "Core schema", "pinned_by": "<user-uuid>"}' | python -m json.tool

# List pins
curl -s http://localhost:8000/api/branches/<branch-uuid>/pins | python -m json.tool

# Delete pin
curl -s -X DELETE http://localhost:8000/api/pins/<pin-id>
# Expected: 204 No Content

# Create import
curl -s -X POST http://localhost:8000/api/branches/<branch-uuid>/imports \
  -H "Content-Type: application/json" \
  -d '{"source_node_id": "<node-uuid>", "include_descendants": true, "imported_by": "<user-uuid>"}' | python -m json.tool

# List imports
curl -s http://localhost:8000/api/branches/<branch-uuid>/imports | python -m json.tool

# Delete import
curl -s -X DELETE http://localhost:8000/api/imports/<import-id>
# Expected: 204 No Content
```

- [ ] **Step 4: Test duplicate pin returns 409**

```bash
# Pin same node again on same branch
curl -s -w "\n%{http_code}" -X POST http://localhost:8000/api/branches/<branch-uuid>/pins \
  -H "Content-Type: application/json" \
  -d '{"node_id": "<same-node-uuid>", "priority": 5, "pinned_by": "<user-uuid>"}'
# Expected: 409
```

- [ ] **Step 5: Commit**

```bash
git add backend/routers/context.py
git commit -m "feat(api): add pins and imports CRUD endpoints"
```

---

## Task 4: Search Router — Divergence and Full-Text Search Endpoints

**Files:**
- Create: `backend/routers/search.py`
- Test: via curl

- [ ] **Step 1: Write the failing test — curl GET /api/search**

```bash
curl -s "http://localhost:8000/api/search?q=recipe&user_id=<user-uuid>&k=5" | python -m json.tool
```

Expected: 404 (route doesn't exist yet)

- [ ] **Step 2: Create `backend/routers/search.py`**

```python
# backend/routers/search.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
import uuid

from db import get_db

router = APIRouter()


DIVERGENCE_SQL = """
WITH a_head AS (SELECT head_node_id FROM branches WHERE id = :branch_a),
     b_head AS (SELECT head_node_id FROM branches WHERE id = :branch_b),

a_ancestors AS (
  SELECT na.ancestor_id, na.depth
  FROM node_ancestry na, a_head
  WHERE na.descendant_id = a_head.head_node_id
),
b_ancestors AS (
  SELECT na.ancestor_id, na.depth
  FROM node_ancestry na, b_head
  WHERE na.descendant_id = b_head.head_node_id
),

common AS (
  SELECT a.ancestor_id, GREATEST(a.depth, b.depth) AS max_depth
  FROM a_ancestors a
  JOIN b_ancestors b ON a.ancestor_id = b.ancestor_id
),
lca AS (
  SELECT ancestor_id AS lca_node_id
  FROM common
  ORDER BY max_depth ASC
  LIMIT 1
),

only_a AS (
  SELECT ancestor_id AS node_id FROM a_ancestors
  EXCEPT
  SELECT ancestor_id FROM b_ancestors
),
only_b AS (
  SELECT ancestor_id AS node_id FROM b_ancestors
  EXCEPT
  SELECT ancestor_id FROM a_ancestors
)

SELECT
  (SELECT lca_node_id FROM lca)          AS lca_node_id,
  (SELECT COUNT(*) FROM only_a)          AS only_a_count,
  (SELECT COUNT(*) FROM only_b)          AS only_b_count,
  (SELECT json_agg(node_id) FROM only_a) AS only_a_nodes,
  (SELECT json_agg(node_id) FROM only_b) AS only_b_nodes;
"""

SEARCH_SQL = """
SELECT
  n.id              AS node_id,
  n.content,
  n.role,
  n.created_at,
  b.id              AS branch_id,
  b.name            AS branch_name,
  c.id              AS conversation_id,
  c.title           AS conversation_title,
  ts_rank(n.content_tsv, websearch_to_tsquery('english', :query_text)) AS rank
FROM nodes n
JOIN branches b      ON b.id = n.branch_id
JOIN conversations c ON c.id = n.conversation_id
WHERE c.owner_id = :user_id
  AND b.is_archived = false
  AND n.content_tsv @@ websearch_to_tsquery('english', :query_text)
ORDER BY rank DESC, n.created_at DESC
LIMIT :k;
"""


@router.get("/branches/{branch_a}/diverge/{branch_b}")
def branch_divergence(
    branch_a: uuid.UUID,
    branch_b: uuid.UUID,
    db: Session = Depends(get_db),
):
    result = db.execute(
        text(DIVERGENCE_SQL),
        {"branch_a": str(branch_a), "branch_b": str(branch_b)},
    )
    row = result.mappings().first()
    return {
        "lca_node_id": row["lca_node_id"],
        "only_a_count": row["only_a_count"],
        "only_b_count": row["only_b_count"],
        "only_a_nodes": row["only_a_nodes"] or [],
        "only_b_nodes": row["only_b_nodes"] or [],
    }


@router.get("/search")
def search_nodes(
    q: str = Query(..., min_length=1),
    user_id: uuid.UUID = Query(...),
    k: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    result = db.execute(
        text(SEARCH_SQL),
        {"query_text": q, "user_id": str(user_id), "k": k},
    )
    rows = result.mappings().all()
    return [
        {
            "node_id": str(row["node_id"]),
            "content": row["content"],
            "role": row["role"],
            "created_at": str(row["created_at"]),
            "branch_id": str(row["branch_id"]),
            "branch_name": row["branch_name"],
            "conversation_id": str(row["conversation_id"]),
            "conversation_title": row["conversation_title"],
            "rank": float(row["rank"]),
        }
        for row in rows
    ]
```

- [ ] **Step 3: Test divergence with seed data**

```bash
# Compare feat/auth vs feat/recipe-crud (both forked from n-07)
curl -s "http://localhost:8000/api/branches/<br-auth-uuid>/diverge/<br-recipe-crud-uuid>" | python -m json.tool
```

Expected: `lca_node_id` = UUID for n-07, `only_a_count` = 6, `only_b_count` = 4

- [ ] **Step 4: Test search with seed data**

```bash
# Search for "recipe" across Alex's conversations
curl -s "http://localhost:8000/api/search?q=recipe&user_id=<u-alex-uuid>&k=10" | python -m json.tool
```

Expected: Multiple results from recipe-related nodes, each with branch_name, conversation_title, and rank > 0.

- [ ] **Step 5: Commit**

```bash
git add backend/routers/search.py
git commit -m "feat(api): add search (FTS) and branch divergence endpoints"
```

---

## Task 5: Register All DEV-B Routers in main.py (Merge Point 2 Prep)

**Files:**
- Modify: `backend/main.py` (coordinate with DEV-A)

- [ ] **Step 1: Provide DEV-A with the router registration lines**

Send DEV-A these lines to add to `backend/main.py`:

```python
from routers.nodes import router as nodes_router
from routers.context import router as context_router
from routers.search import router as search_router

app.include_router(nodes_router, prefix="/api")
app.include_router(context_router, prefix="/api")
app.include_router(search_router, prefix="/api")
```

- [ ] **Step 2: After DEV-A adds the lines, verify all routes are registered**

```bash
curl -s http://localhost:8000/openapi.json | python -m json.tool | grep '"path"'
```

Expected: See `/api/nodes`, `/api/nodes/{node_id}`, `/api/branches/{branch_id}/pins`, `/api/branches/{branch_id}/imports`, `/api/pins/{pin_id}`, `/api/imports/{import_id}`, `/api/branches/{branch_a}/diverge/{branch_b}`, `/api/search`

- [ ] **Step 3: Cross-validate DEV-A's endpoints**

```bash
# Test DEV-A's conversation endpoint
curl -s http://localhost:8000/api/conversations?owner_id=<u-alex-uuid> | python -m json.tool

# Test DEV-A's context assembly
curl -s "http://localhost:8000/api/nodes/<node-uuid>/context?budget=5000" | python -m json.tool
```

Expected: Both return valid JSON with data from seed DB.

- [ ] **Step 4: Commit merge point**

```bash
git add backend/main.py backend/models/__init__.py
git commit -m "feat: merge DEV-B routers into app (merge point 2)"
```

---

## Task 6: CLI Ingestion Tool

**Files:**
- Create: `scripts/ingest.py`
- Test: via command line

- [ ] **Step 1: Write the failing test — run the ingestion tool**

```bash
cd /Users/amirali.iranmanesh/welp/Graft
echo 'User: How do I set up a Postgres database?
Assistant: First, install PostgreSQL using your package manager.
User: What about indexing?
Assistant: There are several types of indexes in PostgreSQL.' > /tmp/test_transcript.txt

python -m scripts.ingest /tmp/test_transcript.txt
```

Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.ingest'`

- [ ] **Step 2: Create `scripts/__init__.py` and `scripts/ingest.py`**

```python
# scripts/__init__.py
# (empty — makes scripts a package for python -m)
```

```python
# scripts/ingest.py
"""
CLI tool to ingest plain-text transcripts into Graft.

Usage: python -m scripts.ingest <transcript.txt> [--user-id UUID]

Input format:
    User: How do I set up a Postgres database?
    Assistant: First, install PostgreSQL...
"""
import argparse
import re
import sys
import uuid
import requests

API_BASE = "http://localhost:8000/api"
DEFAULT_USER_ID = None  # Set after seed loading, or pass via --user-id


def parse_transcript(filepath: str) -> list[tuple[str, str]]:
    """Parse transcript into (role, content) pairs."""
    with open(filepath, "r") as f:
        text = f.read()

    # Split on role markers at start of line
    pattern = r"^(User|Assistant|System):\s*"
    parts = re.split(pattern, text, flags=re.MULTILINE)

    # parts[0] is any text before the first marker (usually empty)
    # then alternating: role, content, role, content, ...
    messages = []
    i = 1  # skip leading text
    while i < len(parts) - 1:
        role = parts[i].lower()
        content = parts[i + 1].strip()
        if content:
            messages.append((role, content))
        i += 2

    return messages


def create_conversation(user_id: str, title: str) -> dict:
    """Create a conversation via the API."""
    resp = requests.post(
        f"{API_BASE}/conversations",
        json={"owner_id": user_id, "title": title},
    )
    resp.raise_for_status()
    return resp.json()


def create_node(
    conversation_id: str,
    parent_id: str | None,
    branch_id: str,
    role: str,
    content: str,
) -> dict:
    """Create a node via the API."""
    resp = requests.post(
        f"{API_BASE}/nodes",
        json={
            "conversation_id": conversation_id,
            "parent_id": parent_id,
            "branch_id": branch_id,
            "node_type": "message",
            "role": role,
            "content": content,
        },
    )
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Ingest a transcript into Graft")
    parser.add_argument("transcript", help="Path to transcript file")
    parser.add_argument("--user-id", help="UUID of the user (default: seed user)")
    parser.add_argument("--api-url", default=API_BASE, help="API base URL")
    args = parser.parse_args()

    global API_BASE
    API_BASE = args.api_url

    user_id = args.user_id or DEFAULT_USER_ID
    if not user_id:
        print("Error: --user-id is required (no default user configured)")
        sys.exit(1)

    # Parse transcript
    messages = parse_transcript(args.transcript)
    if not messages:
        print("Error: No messages found in transcript")
        sys.exit(1)

    # Extract title from filename
    title = args.transcript.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("_", " ").title()

    # Create conversation (DEV-A's endpoint creates root node + main branch)
    conv = create_conversation(user_id, title)
    conv_id = conv["id"]
    branch_id = conv["default_branch_id"]
    root_node_id = conv["root_node_id"]

    # Chain messages as nodes
    parent_id = root_node_id
    node_count = 0
    for role, content in messages:
        node = create_node(conv_id, parent_id, branch_id, role, content)
        parent_id = node["id"]
        node_count += 1

    print(f'Created conversation "{title}" ({conv_id}) with {node_count} nodes on branch main')


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run the ingestion tool against the test transcript**

```bash
cd /Users/amirali.iranmanesh/welp/Graft
python -m scripts.ingest /tmp/test_transcript.txt --user-id <u-alex-uuid>
```

Expected: `Created conversation "Test Transcript" (<uuid>) with 4 nodes on branch main`

- [ ] **Step 4: Verify the ingested data via API**

```bash
curl -s "http://localhost:8000/api/search?q=indexing&user_id=<u-alex-uuid>&k=5" | python -m json.tool
```

Expected: The ingested node about "indexing" appears in search results.

- [ ] **Step 5: Commit**

```bash
git add scripts/__init__.py scripts/ingest.py
git commit -m "feat: add CLI transcript ingestion tool"
```

---

## Task 7: Integration Tests

**Files:**
- Create: `scripts/test_integration.py`
- Test: via command line

- [ ] **Step 1: Create `scripts/test_integration.py`**

```python
# scripts/test_integration.py
"""
Integration tests for DEV-B endpoints.
Requires: backend running at localhost:8000, seed data loaded.

Usage: python -m scripts.test_integration
"""
import sys
import requests
import uuid

API = "http://localhost:8000/api"

# These UUIDs must match the seed data (uuid5-mapped from short IDs).
# Update after Phase 0 seed loading.
NAMESPACE = uuid.UUID("12345678-1234-1234-1234-123456789abc")


def make_uuid(short_id: str) -> str:
    return str(uuid.uuid5(NAMESPACE, short_id))


USER_ALEX = make_uuid("u-alex")
BR_AUTH = make_uuid("br-auth")
BR_RECIPE_CRUD = make_uuid("br-recipe-crud")
BR_SEARCH = make_uuid("br-search")
NODE_05 = make_uuid("n-05")  # schema node (pinned on multiple branches)
NODE_07 = make_uuid("n-07")  # fork point


passed = 0
failed = 0


def test(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  PASS: {name}")
        passed += 1
    else:
        print(f"  FAIL: {name} — {detail}")
        failed += 1


def test_search():
    print("\n--- Test: Full-text search ---")
    resp = requests.get(f"{API}/search", params={"q": "recipe", "user_id": USER_ALEX, "k": 10})
    test("search returns 200", resp.status_code == 200, f"got {resp.status_code}")
    data = resp.json()
    test("search returns results", len(data) > 0, "empty results")
    if data:
        test("results have rank", "rank" in data[0], "missing rank field")
        test("results have branch_name", "branch_name" in data[0], "missing branch_name")


def test_divergence():
    print("\n--- Test: Branch divergence ---")
    resp = requests.get(f"{API}/branches/{BR_AUTH}/diverge/{BR_RECIPE_CRUD}")
    test("divergence returns 200", resp.status_code == 200, f"got {resp.status_code}")
    data = resp.json()
    test("LCA is n-07", data.get("lca_node_id") == NODE_07, f"got {data.get('lca_node_id')}")
    test("auth has 6 unique nodes", data.get("only_a_count") == 6, f"got {data.get('only_a_count')}")
    test("recipe-crud has 4 unique nodes", data.get("only_b_count") == 4, f"got {data.get('only_b_count')}")


def test_pins():
    print("\n--- Test: Pins CRUD ---")
    # Create a pin
    resp = requests.post(
        f"{API}/branches/{BR_SEARCH}/pins",
        json={"node_id": NODE_07, "priority": 5, "reason": "Integration test pin", "pinned_by": USER_ALEX},
    )
    test("create pin returns 201", resp.status_code == 201, f"got {resp.status_code}: {resp.text}")

    if resp.status_code == 201:
        pin = resp.json()
        pin_id = pin["id"]

        # List pins
        resp2 = requests.get(f"{API}/branches/{BR_SEARCH}/pins")
        test("list pins returns 200", resp2.status_code == 200)
        pins = resp2.json()
        test("pin appears in list", any(p["id"] == pin_id for p in pins), "pin not found in list")

        # Duplicate pin returns 409
        resp3 = requests.post(
            f"{API}/branches/{BR_SEARCH}/pins",
            json={"node_id": NODE_07, "priority": 3, "pinned_by": USER_ALEX},
        )
        test("duplicate pin returns 409", resp3.status_code == 409, f"got {resp3.status_code}")

        # Delete pin
        resp4 = requests.delete(f"{API}/pins/{pin_id}")
        test("delete pin returns 204", resp4.status_code == 204, f"got {resp4.status_code}")


def test_imports():
    print("\n--- Test: Imports CRUD ---")
    resp = requests.post(
        f"{API}/branches/{BR_SEARCH}/imports",
        json={"source_node_id": NODE_05, "include_descendants": False, "imported_by": USER_ALEX},
    )
    test("create import returns 201", resp.status_code == 201, f"got {resp.status_code}: {resp.text}")

    if resp.status_code == 201:
        imp = resp.json()
        imp_id = imp["id"]

        resp2 = requests.get(f"{API}/branches/{BR_SEARCH}/imports")
        test("list imports returns 200", resp2.status_code == 200)

        resp3 = requests.delete(f"{API}/imports/{imp_id}")
        test("delete import returns 204", resp3.status_code == 204, f"got {resp3.status_code}")


def test_nodes():
    print("\n--- Test: Node read ---")
    resp = requests.get(f"{API}/nodes/{NODE_05}")
    test("get node returns 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        node = resp.json()
        test("node has content", "content" in node and len(node["content"]) > 0, "missing content")


if __name__ == "__main__":
    print("Running DEV-B integration tests...")
    print(f"API: {API}")
    print(f"User Alex UUID: {USER_ALEX}")

    test_nodes()
    test_search()
    test_divergence()
    test_pins()
    test_imports()

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    if failed > 0:
        sys.exit(1)
    print("All tests passed!")
```

- [ ] **Step 2: Run the integration tests**

```bash
cd /Users/amirali.iranmanesh/welp/Graft
python -m scripts.test_integration
```

Expected: All tests pass. If seed UUID mapping differs, update the UUID constants first.

- [ ] **Step 3: Commit**

```bash
git add scripts/test_integration.py
git commit -m "test: add DEV-B integration tests for search, divergence, pins, imports"
```

---

## Task 8: Frontend — SearchPage and SearchResults Components

**Files:**
- Create: `frontend/src/pages/SearchPage.jsx`
- Create: `frontend/src/components/SearchResults.jsx`
- Test: via browser at `http://localhost:5173/search`

**Prerequisite:** DEV-A's scaffold is pulled. `frontend/src/api.js` exists with `api.search()` and `DEFAULT_USER_ID` already defined.

- [ ] **Step 1: Create `frontend/src/components/SearchResults.jsx`**

```jsx
// frontend/src/components/SearchResults.jsx
export default function SearchResults({ results, onImport, onView }) {
  if (!results.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-500">{results.length} results</p>
      {results.map((r) => (
        <div key={r.node_id} className="border rounded p-3">
          <p className="text-sm">
            {r.content.slice(0, 200)}
            {r.content.length > 200 ? "..." : ""}
          </p>
          <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
            <span>
              {r.role} &middot; {r.branch_name} &middot; {r.conversation_title}
            </span>
            <span>Relevance: {r.rank.toFixed(2)}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onView(r)}
              className="text-xs text-blue-600 hover:underline"
            >
              View in context
            </button>
            <button
              onClick={() => onImport(r)}
              className="text-xs text-green-600 hover:underline"
            >
              Import to...
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/pages/SearchPage.jsx`**

```jsx
// frontend/src/pages/SearchPage.jsx
import { useState } from "react";
import { api, DEFAULT_USER_ID } from "../api";
import SearchResults from "../components/SearchResults";
import ImportModal from "../components/ImportModal";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.search(query, DEFAULT_USER_ID);
      setResults(data);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <a href="/" className="text-blue-600 text-sm hover:underline">
        &larr; Back to Conversations
      </a>
      <h1 className="text-xl font-semibold mt-4 mb-4">Search</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Search across all conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {loading && <p className="mt-4 text-gray-500">Searching...</p>}

      <SearchResults
        results={results}
        onImport={(node) => setImportTarget(node)}
        onView={(node) =>
          (window.location.href = `/conversations/${node.conversation_id}`)
        }
      />

      {importTarget && (
        <ImportModal
          sourceNode={importTarget}
          conversationId={importTarget.conversation_id}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run the dev server and test in browser**

```bash
cd /Users/amirali.iranmanesh/welp/Graft/frontend && npm run dev
```

Open `http://localhost:5173/search`. Type "recipe" and click Search.
Expected: Results appear with content snippets, branch names, relevance scores, and action buttons.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SearchPage.jsx frontend/src/components/SearchResults.jsx
git commit -m "feat(ui): add SearchPage and SearchResults components"
```

---

## Task 9: Frontend — ImportModal Component

**Files:**
- Create: `frontend/src/components/ImportModal.jsx`
- Test: via browser

- [ ] **Step 1: Create `frontend/src/components/ImportModal.jsx`**

```jsx
// frontend/src/components/ImportModal.jsx
import { useState, useEffect } from "react";
import { api, DEFAULT_USER_ID } from "../api";

export default function ImportModal({ sourceNode, conversationId, onClose }) {
  const [branches, setBranches] = useState([]);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (conversationId) {
      api.getConversation(conversationId).then((conv) => {
        setBranches(conv.branches || []);
      });
    }
  }, [conversationId]);

  const handleImport = async () => {
    if (!targetBranchId) return;
    setImporting(true);
    try {
      await api.createImport(targetBranchId, {
        source_node_id: sourceNode.node_id || sourceNode.id,
        include_descendants: includeDescendants,
        imported_by: DEFAULT_USER_ID,
      });
      onClose();
    } catch (err) {
      console.error("Import failed:", err);
    }
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <h3 className="font-semibold text-lg">Import Node to Branch</h3>
        <p className="text-sm text-gray-500 mt-2 truncate">
          Source: &quot;{sourceNode.content?.slice(0, 80)}...&quot;
        </p>

        <div className="mt-4">
          <label className="text-sm font-medium block mb-1">
            Target branch:
          </label>
          <select
            className="w-full border rounded px-2 py-1"
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
          >
            <option value="">Select a branch...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          Include descendants
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!targetBranchId || importing}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test in browser**

From the search results page, click "Import to..." on any result. The modal should appear with a branch dropdown.
Expected: Modal renders, branch dropdown populates, selecting a branch and clicking Import creates the import and closes the modal.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ImportModal.jsx
git commit -m "feat(ui): add ImportModal (cherry-pick) component"
```

---

## Task 10: Frontend — PinsPanel Component

**Files:**
- Create: `frontend/src/components/PinsPanel.jsx`
- Test: via browser

- [ ] **Step 1: Create `frontend/src/components/PinsPanel.jsx`**

```jsx
// frontend/src/components/PinsPanel.jsx
import { useState, useEffect } from "react";
import { api } from "../api";

export default function PinsPanel({ branchId, onClose }) {
  const [pins, setPins] = useState([]);

  useEffect(() => {
    if (branchId) {
      api.getPins(branchId).then(setPins);
    }
  }, [branchId]);

  const handleUnpin = async (pinId) => {
    await api.deletePin(pinId);
    setPins(pins.filter((p) => p.id !== pinId));
  };

  return (
    <div className="w-64 border-l p-4 overflow-y-auto bg-white">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">Pinned Context</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xs"
        >
          close
        </button>
      </div>
      {pins.length === 0 && (
        <p className="text-xs text-gray-400">No pins on this branch.</p>
      )}
      {pins.map((pin) => (
        <div key={pin.id} className="border rounded p-2 mb-2">
          <div className="flex justify-between text-xs">
            <span className="font-mono bg-blue-100 px-1 rounded">
              P:{pin.priority}
            </span>
          </div>
          {pin.reason && (
            <p className="text-xs text-gray-500 mt-1">{pin.reason}</p>
          )}
          <p className="text-xs mt-1 truncate">
            {pin.node_content || "Loading..."}
          </p>
          <button
            onClick={() => handleUnpin(pin.id)}
            className="text-xs text-red-500 hover:text-red-700 mt-1"
          >
            Unpin
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Test in browser**

Navigate to a conversation view where a branch has pins (e.g., seed data has pins on `br-auth`). The PinsPanel should show pinned nodes with priority badges and unpin buttons.
Expected: Pins render with priority, reason text, and Unpin button that removes the pin on click.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PinsPanel.jsx
git commit -m "feat(ui): add PinsPanel sidebar component"
```

---

## Task 11: Frontend Integration — Merge Point 3

**Files:**
- Modify: `frontend/src/App.jsx` (add `/search` route)
- Modify: `frontend/src/pages/ConversationView.jsx` (add PinsPanel toggle)
- Modify: `frontend/src/components/MessageThread.jsx` (add Pin/Import buttons)
- Test: via browser

- [ ] **Step 1: Add `/search` route to `App.jsx`**

Add to the imports:
```jsx
import SearchPage from "./pages/SearchPage";
```

Add to the router (inside the `<Routes>` block):
```jsx
<Route path="/search" element={<SearchPage />} />
```

- [ ] **Step 2: Add Pin/Import buttons to `MessageThread.jsx`**

Find the `{/* DEV-B: action buttons */}` placeholder in DEV-A's `MessageThread.jsx` and replace with:

```jsx
<button
  onClick={() => onPin(node.id)}
  className="text-xs text-blue-600 hover:underline"
>
  Pin
</button>
<button
  onClick={() => onImport(node)}
  className="text-xs text-green-600 hover:underline"
>
  Import to...
</button>
```

Ensure the parent component passes `onPin` and `onImport` props.

- [ ] **Step 3: Add PinsPanel toggle to `ConversationView.jsx`**

Find the `{/* DEV-B: pins panel */}` placeholder and replace with:

```jsx
{showPins && (
  <PinsPanel
    branchId={currentBranchId}
    onClose={() => setShowPins(false)}
  />
)}
```

Add state and import at the top:
```jsx
import PinsPanel from "../components/PinsPanel";
// Inside the component:
const [showPins, setShowPins] = useState(false);
```

Add a toggle button somewhere in the conversation header:
```jsx
<button
  onClick={() => setShowPins(!showPins)}
  className="text-xs text-blue-600 hover:underline"
>
  {showPins ? "Hide Pins" : "Show Pins"}
</button>
```

- [ ] **Step 4: Run golden-path test in browser**

```
1. Open http://localhost:5173
2. Click into a conversation
3. Click "Show Pins" — pins panel appears on the right
4. Click "Pin" on a message — pin form appears
5. Navigate to /search
6. Type "recipe" and press Enter
7. Click "Import to..." on a result
8. Select a branch and click Import
9. Verify import was created (check via curl or pins panel refresh)
```

Expected: Full flow works end-to-end without errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/ConversationView.jsx frontend/src/components/MessageThread.jsx
git commit -m "feat(ui): integrate DEV-B components into DEV-A scaffold (merge point 3)"
```

---

## Task 12: Deploy Frontend to Vercel

**Files:** None (deployment config)
- Test: via deployed URL

- [ ] **Step 1: Connect repo to Vercel**

1. Go to vercel.com, click "Add New Project"
2. Import the GitHub repository
3. Settings:
   - Framework Preset: **Vite**
   - Root Directory: **frontend**
   - Build Command: `npm run build`
   - Output Directory: `dist`

- [ ] **Step 2: Set environment variables**

In Vercel dashboard -> Settings -> Environment Variables:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | DEV-A's Render backend URL (e.g., `https://graft-backend.onrender.com/api`) |

- [ ] **Step 3: Deploy and verify**

Click Deploy. Once live, verify:

```bash
# Test that the app loads
curl -s -o /dev/null -w "%{http_code}" https://<your-vercel-url>/
# Expected: 200

# Test in browser — open the Vercel URL and:
# 1. Conversation list loads
# 2. Search page works
# 3. No CORS errors in console
```

- [ ] **Step 4: Tell DEV-A the Vercel URL for CORS**

Send DEV-A your Vercel URL to add to `allow_origins` in `backend/main.py`:
```python
allow_origins=[
    "http://localhost:5173",
    "https://<your-vercel-url>.vercel.app",
]
```

- [ ] **Step 5: Verify CORS after DEV-A redeploys**

Open the Vercel URL in browser, open DevTools console, and navigate the app.
Expected: No `Access-Control-Allow-Origin` errors.

---

## Task 13: Write-up Documentation

**Files:**
- Create: `docs/writeup.md`
- Modify: `README.md`

- [ ] **Step 1: Create `docs/writeup.md`**

```markdown
# Graft — Project Write-up

## Domain Description

Graft is a database system that brings Git-style version control to AI agent
conversations. In long-running development sessions with AI assistants, users
face a fundamental problem: conversations are linear, but exploration is not.
A developer might want to try two approaches in parallel, save a critical piece
of context for reuse across sessions, or search through months of past
conversations to find a solution they discussed before.

Graft solves this by modeling conversations as directed acyclic graphs (DAGs)
rather than flat message lists. Each message is a node in the DAG, and branches
are named pointers that let users fork, explore, and merge conversation threads.
Context pins ensure critical information is always visible to the AI regardless
of position in the tree. Context imports enable cherry-picking nodes across
branches. Summarization condenses verbose conversation stretches to save tokens.
Full-text search with PostgreSQL's built-in tsvector/tsquery lets users find
past solutions across all their conversations.

The system is designed around three core database queries: context assembly
(the hot path, run on every AI turn), branch divergence (for comparing branches
before merging), and full-text search (for discovering and reusing past context).

## Entities

| # | Entity | Description |
|---|--------|-------------|
| 1 | users | People who own conversations and perform actions |
| 2 | conversations | Top-level workspaces containing a DAG of nodes |
| 3 | nodes | Atomic conversation units (messages, commits, merges, summaries) |
| 4 | node_ancestry | Closure table: pre-computed ancestor-descendant pairs for O(1) lookups |
| 5 | branches | Named pointers into the DAG (head + base node) |
| 6 | context_pins | "Always include this node" markers on branches |
| 7 | context_imports | Cherry-picked node references from other branches |
| 8 | node_summaries | Maps summary nodes to the originals they replace |
| 9 | tags | Reusable labels for categorizing nodes |
| 10 | node_tags | Many-to-many junction between nodes and tags |
| 11 | branch_shares | Permission grants (view/fork/comment) to users or public |

## Schema

![Schema diagram](../db/schema.png)
*(Export from dbdiagram.io using db/schema.dbml)*

## Three Critical User Paths

### Path 1: Send message → Receive response (Context Assembly — Query 1)

1. User creates a node (POST /api/nodes) with their message
2. Backend computes token_count, inserts node, trigger populates node_ancestry
3. Agent endpoint calls context assembly: ancestors via closure table + pins + imports
4. Summarized nodes are elided, remaining ranked by priority/depth/recency
5. Cumulative token sum truncates at budget; assembled context sent to LLM
6. LLM response saved as assistant node, branch head advanced

### Path 2: Compare branches → Divergence report (Query 2)

1. User requests divergence: GET /api/branches/{a}/diverge/{b}
2. Query finds ancestor sets of both branch heads via closure table
3. Common ancestors intersected; LCA = common ancestor with smallest max-depth
4. Set differences computed: nodes only on A, nodes only on B
5. Returns: LCA node, counts, and node ID lists for display

### Path 3: Search → Find → Cherry-pick (Query 3 + Import)

1. User searches: GET /api/search?q=pagination
2. websearch_to_tsquery parses query; GIN index on content_tsv matches nodes
3. Results ranked by ts_rank, filtered to non-archived branches, limited to k
4. User clicks "Import to..." on a result
5. POST /api/branches/{id}/imports creates a reference (not a copy)
6. On next context assembly, imported node appears in the union

## Query Explanations

### Query 1: Context Assembly
[Include EXPLAIN ANALYZE output from Phase 0]

### Query 2: Branch Divergence
[Include EXPLAIN ANALYZE output from Phase 0]

### Query 3: Full-Text Search
[Include EXPLAIN ANALYZE output from Phase 0]

## Index Justifications

| Index | Table | Type | Query Served | Impact |
|-------|-------|------|-------------|--------|
| PK (ancestor, descendant) | node_ancestry | B-tree | Q1, Q2 | O(1) closure lookups |
| idx_ancestry_desc_depth | node_ancestry | B-tree | Q1, Q2 | "All ancestors of X" |
| idx_nodes_content_tsv | nodes | GIN | Q3 | O(log n) FTS matching |
| idx_nodes_conv_recent | nodes | B-tree | Listings | Recent messages sorted |
| idx_pins_branch_priority | context_pins | B-tree | Q1 | Ordered pin scan |
| idx_imports_target_recent | context_imports | B-tree | Q1 | Import listing |
| idx_branch_active | branches | Partial B-tree | Q3 | Skip archived branches |
| idx_conv_owner_recent | conversations | B-tree | Listings | "My recent convos" |
| uniq_branch_name_per_conv | branches | Unique B-tree | Constraint | Branch name uniqueness |
| idx_summaries_original | node_summaries | B-tree | Q1 | Elision check |
```

- [ ] **Step 2: Update README.md with deployed URLs**

Add a section to `README.md`:

```markdown
## Live Demo

- **Frontend:** https://<vercel-url>.vercel.app
- **Backend API:** https://<render-url>.onrender.com/api
- **Database:** Supabase (PostgreSQL)
```

- [ ] **Step 3: Fill in EXPLAIN output from Phase 0**

Replace the `[Include EXPLAIN ANALYZE output from Phase 0]` placeholders in `docs/writeup.md` with the actual EXPLAIN output captured during Phase 0 setup.

- [ ] **Step 4: Commit**

```bash
git add docs/writeup.md README.md
git commit -m "docs: add project write-up with schema, queries, and index justifications"
```

---

## Summary of Commits

| Task | Commit Message |
|------|---------------|
| 1 | `feat(models): add 7 DEV-B SQLAlchemy models (context tables)` |
| 2 | `feat(api): add nodes CRUD endpoints (POST + GET)` |
| 3 | `feat(api): add pins and imports CRUD endpoints` |
| 4 | `feat(api): add search (FTS) and branch divergence endpoints` |
| 5 | `feat: merge DEV-B routers into app (merge point 2)` |
| 6 | `feat: add CLI transcript ingestion tool` |
| 7 | `test: add DEV-B integration tests for search, divergence, pins, imports` |
| 8 | `feat(ui): add SearchPage and SearchResults components` |
| 9 | `feat(ui): add ImportModal (cherry-pick) component` |
| 10 | `feat(ui): add PinsPanel sidebar component` |
| 11 | `feat(ui): integrate DEV-B components into DEV-A scaffold (merge point 3)` |
| 12 | *(deployment — no code commit)* |
| 13 | `docs: add project write-up with schema, queries, and index justifications` |

## Dependencies Between Tasks

```
Task 1 (models) → Task 2 (nodes router)
Task 1 (models) → Task 3 (context router)
Task 1 (models) → Task 4 (search router)
Tasks 2,3,4 → Task 5 (register routers — merge point 2)
Task 5 → Task 6 (CLI ingestion — needs all endpoints)
Task 5 → Task 7 (integration tests — needs all endpoints)
Task 8 (search page) → Task 9 (import modal — used by search page)
Tasks 8,9,10 → Task 11 (frontend merge — merge point 3)
Task 11 → Task 12 (deploy — needs merged frontend)
Task 12 → Task 13 (write-up — needs deployed URLs)
```
