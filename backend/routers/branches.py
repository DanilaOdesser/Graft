"""DEV-A branches router."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from pydantic import BaseModel

from db import get_db
from models.context import NodeSummary
from models.core import Branch, Node
from schemas import BranchCreate
from llm import summarize_nodes
from sse import publish

router = APIRouter()


class CommitRequest(BaseModel):
    commit_message: str


QUERY_1_CONTEXT_ASSEMBLY = """
WITH params AS (
  SELECT CAST(:current_node_id AS uuid) AS current_node_id,
         CAST(:budget AS int)           AS budget
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
        role=None,
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
        "role": summary_node.node_type,  # role col is NULL for summary; return node_type instead
        "content": summary_node.content,
        "token_count": summary_node.token_count,
        "created_at": str(summary_node.created_at),
    }
    await publish(str(branch.conversation_id), "commit_created", {
        "node": node_dict,
        "branch": _branch_to_dict(branch),
    })

    return {"node": node_dict, "commit_message": body.commit_message, "llm_summary": llm_summary}


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
