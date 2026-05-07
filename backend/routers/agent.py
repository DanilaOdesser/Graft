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
                text("SELECT CAST(id AS text), role FROM nodes WHERE id = ANY(CAST(:ids AS uuid[]))"),
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
