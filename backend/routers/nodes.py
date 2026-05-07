from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from models.core import Node, Branch

router = APIRouter()


class NodeCreate(BaseModel):
    conversation_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    branch_id: uuid.UUID
    node_type: str
    role: Optional[str] = None
    content: str


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
    branch = db.query(Branch).filter(Branch.id == body.branch_id).first()
    if branch:
        branch.head_node_id = node.id
    db.execute(
        text("UPDATE conversations SET updated_at = now() WHERE id = :cid"),
        {"cid": str(body.conversation_id)},
    )
    db.commit()
    db.refresh(node)
    return {
        "id": str(node.id),
        "conversation_id": str(node.conversation_id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "branch_id": str(node.branch_id),
        "node_type": node.node_type,
        "role": node.role,
        "content": node.content,
        "token_count": node.token_count,
        "created_at": str(node.created_at),
    }


@router.get("/conversations/{conv_id}/nodes")
def list_conversation_nodes(conv_id: uuid.UUID, db: Session = Depends(get_db)):
    """Return ALL nodes for a conversation with full parent/branch data (for graph view)."""
    nodes = (
        db.query(Node)
        .filter(Node.conversation_id == conv_id)
        .order_by(Node.created_at)
        .all()
    )
    return [
        {
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
        for n in nodes
    ]


@router.get("/nodes/{node_id}")
def get_node(node_id: uuid.UUID, db: Session = Depends(get_db)):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return {
        "id": str(node.id),
        "conversation_id": str(node.conversation_id),
        "parent_id": str(node.parent_id) if node.parent_id else None,
        "branch_id": str(node.branch_id),
        "node_type": node.node_type,
        "role": node.role,
        "content": node.content,
        "token_count": node.token_count,
        "created_at": str(node.created_at),
    }
