from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from helpers import branch_to_dict, node_to_dict, token_count
from models.core import Node, Branch
from models.context import NodeSummary
from sse import publish
from llm import summarize_nodes as _summarize_nodes

router = APIRouter()


class NodeCreate(BaseModel):
    conversation_id: uuid.UUID
    parent_id: Optional[uuid.UUID] = None
    branch_id: uuid.UUID
    node_type: str
    role: Optional[str] = None
    content: str


class SummarizeRequest(BaseModel):
    branch_name: str
    created_by: uuid.UUID


@router.post("/nodes", status_code=201)
def create_node(body: NodeCreate, db: Session = Depends(get_db)):
    tc = token_count(body.content)
    node = Node(
        id=uuid.uuid4(),
        conversation_id=body.conversation_id,
        parent_id=body.parent_id,
        branch_id=body.branch_id,
        node_type=body.node_type,
        role=body.role,
        content=body.content,
        token_count=tc,
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
    return node_to_dict(node)


@router.get("/conversations/{conv_id}/nodes")
def list_conversation_nodes(conv_id: uuid.UUID, db: Session = Depends(get_db)):
    """Return nodes for a conversation for the graph view.

    Nodes that have been committed (i.e., referenced in node_summaries as
    summarized_node_id) are excluded — the summary node represents them.
    """
    summarized_ids = {
        str(row.summarized_node_id)
        for row in db.query(NodeSummary.summarized_node_id).all()
    }
    nodes = (
        db.query(Node)
        .filter(Node.conversation_id == conv_id)
        .order_by(Node.created_at)
        .all()
    )
    return [
        node_to_dict(n)
        for n in nodes
        if str(n.id) not in summarized_ids
    ]


@router.get("/nodes/{node_id}")
def get_node(node_id: uuid.UUID, db: Session = Depends(get_db)):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node_to_dict(node)


@router.post("/nodes/{node_id}/summarize", status_code=201)
async def summarize_node(
    node_id: uuid.UUID,
    body: SummarizeRequest,
    db: Session = Depends(get_db),
):
    """Summarize a node via LLM, create a new branch whose head is the summary node."""
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # LLM summary of the node content
    summary_text = _summarize_nodes([{"role": node.role or "unknown", "content": node.content}])

    # Create the new branch (temp head; updated after node insert)
    new_branch = Branch(
        id=uuid.uuid4(),
        conversation_id=node.conversation_id,
        name=body.branch_name,
        head_node_id=node_id,
        base_node_id=node_id,
        created_by=body.created_by,
    )
    db.add(new_branch)
    db.flush()

    # Create the summary node with same parent as the original
    content = summary_text
    summary_node = Node(
        id=uuid.uuid4(),
        conversation_id=node.conversation_id,
        parent_id=node.parent_id,
        branch_id=new_branch.id,
        node_type="summary",
        role=None,
        content=content,
        token_count=token_count(content),
    )
    db.add(summary_node)
    db.flush()

    # Record which node this summary covers
    db.add(NodeSummary(
        summary_node_id=summary_node.id,
        summarized_node_id=node_id,
    ))

    # Point branch head/base at the new summary node
    new_branch.head_node_id = summary_node.id
    new_branch.base_node_id = summary_node.id

    db.execute(
        text("UPDATE conversations SET updated_at = now() WHERE id = :cid"),
        {"cid": str(node.conversation_id)},
    )
    db.commit()
    db.refresh(summary_node)
    db.refresh(new_branch)

    node_dict = node_to_dict(summary_node)
    node_dict["role"] = summary_node.node_type  # role col is NULL for summary; return node_type instead
    branch_dict = branch_to_dict(new_branch)

    # commit_created SSE removes the original node from the graph and adds the summary
    await publish(str(node.conversation_id), "commit_created", {
        "node": node_dict,
        "branch": branch_dict,
        "summarized_node_ids": [str(node_id)],
    })
    await publish(str(node.conversation_id), "branch_updated", {"branch": branch_dict})

    return {"node": node_dict, "branch": branch_dict}
