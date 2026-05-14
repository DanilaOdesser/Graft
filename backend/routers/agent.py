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
from helpers import branch_to_dict, node_to_dict, token_count
from llm import call_llm
from models.core import Branch, Node
from routers.branches import QUERY_1_CONTEXT_ASSEMBLY
from schemas import AgentTurnRequest
from sse import publish

router = APIRouter()


@router.post("/agent/turn")
async def agent_turn(body: AgentTurnRequest, db: Session = Depends(get_db)):
    parent = db.query(Node).filter(Node.id == body.node_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="parent node_id not found")

    # The branch is taken from the request, not from parent.branch_id: a
    # freshly forked branch's head IS the fork node which lives on the parent
    # branch, so deriving the branch from the parent would route the message
    # to the wrong branch.
    branch = db.query(Branch).filter(Branch.id == body.branch_id).first()
    if not branch:
        raise HTTPException(status_code=404, detail="branch_id not found")
    if branch.conversation_id != parent.conversation_id:
        raise HTTPException(status_code=400, detail="branch and parent are in different conversations")

    # 1. user node
    user_node = Node(
        id=uuid.uuid4(),
        conversation_id=parent.conversation_id,
        parent_id=parent.id,
        branch_id=branch.id,
        node_type="message",
        role="user",
        content=body.user_message,
        token_count=token_count(body.user_message),
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
            "depth": r["depth"],
            "content": r["content"],
            "token_count": r["token_count"],
        }
        for r in rows
    ]
    # Augment rows with role + node_type by re-fetching (small N, cheap).
    if context_nodes:
        ids = [r["id"] for r in context_nodes]
        meta = {
            row["id"]: row
            for row in db.execute(
                text("SELECT CAST(id AS text) AS id, role, node_type FROM nodes WHERE id = ANY(CAST(:ids AS uuid[]))"),
                {"ids": ids},
            ).mappings().fetchall()
        }
        for n in context_nodes:
            m = meta.get(n["id"], {})
            n["role"] = m.get("role")
            n["node_type"] = m.get("node_type")

    # 3. Build the LLM messages list. Query 1 returns rows in *rank* order
    # (pins, then ancestors newest-first, then imports), but Anthropic needs
    # a chronological alternating user/assistant sequence ending in user.
    # Pins and imports may live on other branches and would break alternation,
    # so we send only ancestors (deduped, sorted oldest -> newest).
    seen_ids: set[str] = set()
    llm_context: list[dict] = []
    for n in sorted(
        (n for n in context_nodes if n["source"] == "ancestor"),
        key=lambda n: -n["depth"],
    ):
        if n["id"] in seen_ids:
            continue
        seen_ids.add(n["id"])
        llm_context.append(n)
    reply_text = call_llm(llm_context)

    # 4. assistant node
    assistant_node = Node(
        id=uuid.uuid4(),
        conversation_id=parent.conversation_id,
        parent_id=user_node.id,
        branch_id=branch.id,
        node_type="message",
        role="assistant",
        content=reply_text,
        token_count=token_count(reply_text),
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
    db.refresh(branch)
    await publish(str(parent.conversation_id), "node_created", {"node": node_to_dict(user_node)})
    await publish(str(parent.conversation_id), "node_created", {"node": node_to_dict(assistant_node)})
    await publish(str(parent.conversation_id), "branch_updated", {"branch": branch_to_dict(branch)})

    return {
        "user_node": node_to_dict(user_node),
        "assistant_node": node_to_dict(assistant_node),
        "context_used": {
            "node_count": len(context_nodes),
            "total_tokens": sum(n["token_count"] for n in context_nodes),
        },
    }
