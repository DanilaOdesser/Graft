from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List
import uuid

from db import get_db
from models.core import Node
from models.context import Tag, NodeTag
from sse import publish

router = APIRouter()


class TagCreate(BaseModel):
    name: str


class TagSetBody(BaseModel):
    tag_ids: List[uuid.UUID]


def _tag_dict(tag: Tag) -> dict:
    return {"id": str(tag.id), "name": tag.name}


@router.get("/tags")
def list_tags(db: Session = Depends(get_db)):
    tags = db.query(Tag).order_by(Tag.name).all()
    return [_tag_dict(t) for t in tags]


@router.post("/tags")
async def create_tag(body: TagCreate, response: Response, db: Session = Depends(get_db)):
    existing = db.query(Tag).filter(Tag.name.ilike(body.name)).first()
    if existing:
        response.status_code = 200
        return _tag_dict(existing)
    tag = Tag(id=uuid.uuid4(), name=body.name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    response.status_code = 201
    return _tag_dict(tag)


@router.get("/nodes/{node_id}/tags")
def get_node_tags(node_id: uuid.UUID, db: Session = Depends(get_db)):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    tags = (
        db.query(Tag)
        .join(NodeTag, NodeTag.tag_id == Tag.id)
        .filter(NodeTag.node_id == node_id)
        .order_by(Tag.name)
        .all()
    )
    return [_tag_dict(t) for t in tags]


@router.put("/nodes/{node_id}/tags")
async def set_node_tags(node_id: uuid.UUID, body: TagSetBody, db: Session = Depends(get_db)):
    node = db.query(Node).filter(Node.id == node_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # Validate all provided tag IDs exist
    if body.tag_ids:
        found_tags = db.query(Tag).filter(Tag.id.in_(body.tag_ids)).all()
        if len(found_tags) != len(body.tag_ids):
            raise HTTPException(status_code=404, detail="One or more tag IDs not found")
    else:
        found_tags = []

    # Replace full tag set
    db.query(NodeTag).filter(NodeTag.node_id == node_id).delete()
    for tag in found_tags:
        db.add(NodeTag(node_id=node_id, tag_id=tag.id))

    db.commit()

    result = [_tag_dict(t) for t in found_tags]
    await publish(str(node.conversation_id), "node_tags_updated", {
        "node_id": str(node.id),
        "tags": result,
    })
    return result
