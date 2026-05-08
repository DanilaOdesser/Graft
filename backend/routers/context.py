from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
from typing import Optional
import uuid

from db import get_db
from models.context import ContextPin, ContextImport
from models.core import Branch
from sse import publish

router = APIRouter()


def _get_conv_id(branch_id: uuid.UUID, db: Session) -> str | None:
    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    return str(branch.conversation_id) if branch else None


class PinCreate(BaseModel):
    node_id: uuid.UUID
    pinned_by: uuid.UUID
    priority: int = 0
    reason: Optional[str] = None


class ImportCreate(BaseModel):
    source_node_id: uuid.UUID
    imported_by: uuid.UUID
    include_descendants: bool = False


@router.post("/branches/{branch_id}/pins", status_code=201)
async def create_pin(branch_id: uuid.UUID, body: PinCreate, db: Session = Depends(get_db)):
    pin = ContextPin(
        id=uuid.uuid4(),
        branch_id=branch_id,
        node_id=body.node_id,
        pinned_by=body.pinned_by,
        reason=body.reason,
        priority=body.priority,
    )
    try:
        db.add(pin)
        db.commit()
        db.refresh(pin)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Node already pinned on this branch")
    pin_dict = {
        "id": str(pin.id),
        "branch_id": str(pin.branch_id),
        "node_id": str(pin.node_id),
        "pinned_by": str(pin.pinned_by),
        "reason": pin.reason,
        "priority": pin.priority,
        "created_at": str(pin.created_at),
    }
    conv_id = _get_conv_id(branch_id, db)
    if conv_id:
        await publish(conv_id, "pin_created", {"pin": pin_dict})
    return pin_dict


@router.get("/branches/{branch_id}/pins")
def list_pins(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    pins = (
        db.query(ContextPin)
        .filter(ContextPin.branch_id == branch_id)
        .order_by(ContextPin.priority.desc())
        .all()
    )
    return [
        {
            "id": str(p.id),
            "branch_id": str(p.branch_id),
            "node_id": str(p.node_id),
            "pinned_by": str(p.pinned_by),
            "reason": p.reason,
            "priority": p.priority,
            "created_at": str(p.created_at),
        }
        for p in pins
    ]


@router.delete("/pins/{pin_id}", status_code=204)
async def delete_pin(pin_id: uuid.UUID, db: Session = Depends(get_db)):
    pin = db.query(ContextPin).filter(ContextPin.id == pin_id).first()
    if not pin:
        raise HTTPException(status_code=404, detail="Pin not found")
    stored_pin_id = str(pin.id)
    branch_id_str = str(pin.branch_id)
    conv_id = _get_conv_id(pin.branch_id, db)
    db.delete(pin)
    db.commit()
    if conv_id:
        await publish(conv_id, "pin_deleted", {"pin_id": stored_pin_id, "branch_id": branch_id_str})
    return Response(status_code=204)


@router.post("/branches/{branch_id}/imports", status_code=201)
async def create_import(branch_id: uuid.UUID, body: ImportCreate, db: Session = Depends(get_db)):
    imp = ContextImport(
        id=uuid.uuid4(),
        target_branch_id=branch_id,
        source_node_id=body.source_node_id,
        include_descendants=body.include_descendants,
        imported_by=body.imported_by,
    )
    db.add(imp)
    db.commit()
    db.refresh(imp)
    imp_dict = {
        "id": str(imp.id),
        "target_branch_id": str(imp.target_branch_id),
        "source_node_id": str(imp.source_node_id),
        "include_descendants": imp.include_descendants,
        "imported_by": str(imp.imported_by),
        "imported_at": str(imp.imported_at),
    }
    conv_id = _get_conv_id(branch_id, db)
    if conv_id:
        await publish(conv_id, "import_created", {"import": imp_dict})
    return imp_dict


@router.get("/branches/{branch_id}/imports")
def list_imports(branch_id: uuid.UUID, db: Session = Depends(get_db)):
    imports = (
        db.query(ContextImport)
        .filter(ContextImport.target_branch_id == branch_id)
        .order_by(ContextImport.imported_at.desc())
        .all()
    )
    return [
        {
            "id": str(i.id),
            "target_branch_id": str(i.target_branch_id),
            "source_node_id": str(i.source_node_id),
            "include_descendants": i.include_descendants,
            "imported_by": str(i.imported_by),
            "imported_at": str(i.imported_at),
        }
        for i in imports
    ]


@router.delete("/imports/{import_id}", status_code=204)
async def delete_import(import_id: uuid.UUID, db: Session = Depends(get_db)):
    imp = db.query(ContextImport).filter(ContextImport.id == import_id).first()
    if not imp:
        raise HTTPException(status_code=404, detail="Import not found")
    stored_import_id = str(imp.id)
    branch_id_str = str(imp.target_branch_id)
    conv_id = _get_conv_id(imp.target_branch_id, db)
    db.delete(imp)
    db.commit()
    if conv_id:
        await publish(conv_id, "import_deleted", {"import_id": stored_import_id, "branch_id": branch_id_str})
    return Response(status_code=204)
