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
