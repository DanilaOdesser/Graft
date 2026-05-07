"""DEV-A branches router."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from models.core import Branch, Node
from schemas import BranchCreate

router = APIRouter()


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
