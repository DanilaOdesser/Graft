"""DEV-A branches router."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from models.core import Branch, Node
from schemas import BranchCreate

router = APIRouter()


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
