from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
import uuid
from typing import Optional

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

SEARCH_SQL_TAG = """
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
JOIN node_tags nt    ON nt.node_id = n.id
JOIN tags t          ON t.id = nt.tag_id
WHERE c.owner_id = :user_id
  AND b.is_archived = false
  AND n.content_tsv @@ websearch_to_tsquery('english', :query_text)
  AND LOWER(t.name) = LOWER(:tag_name)
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
        "lca_node_id": str(row["lca_node_id"]) if row["lca_node_id"] else None,
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
    tag: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    # Choose SQL based on whether tag filter is provided
    sql = SEARCH_SQL_TAG if tag else SEARCH_SQL
    params = {"query_text": q, "user_id": str(user_id), "k": k}

    # Add tag_name parameter if tag is provided
    if tag:
        params["tag_name"] = tag

    result = db.execute(text(sql), params)
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
