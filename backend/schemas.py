"""Pydantic request/response shapes shared by DEV-A routers."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ----- Conversations -----

class ConversationCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    owner_id: uuid.UUID


class ConversationOut(BaseModel):
    id: str
    owner_id: str
    title: str
    root_node_id: Optional[str]
    default_branch_id: Optional[str]
    created_at: str
    updated_at: str


class ConversationDetail(ConversationOut):
    branches: list["BranchOut"]


# ----- Branches -----

class BranchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    fork_node_id: uuid.UUID
    created_by: uuid.UUID


class BranchOut(BaseModel):
    id: str
    conversation_id: str
    name: str
    head_node_id: Optional[str]
    base_node_id: Optional[str]
    created_by: str
    is_archived: bool
    created_at: str


# ----- Context assembly -----

class ContextNode(BaseModel):
    id: str
    source: str         # 'ancestor' | 'pinned' | 'imported'
    pin_priority: int
    depth: Optional[int]
    token_count: int
    running_tokens: int
    content: str


# ----- Agent turn -----

class AgentTurnRequest(BaseModel):
    node_id: uuid.UUID
    user_message: str = Field(min_length=1)
    budget: int = Field(default=4096, ge=128, le=200_000)


class AgentTurnResponse(BaseModel):
    user_node: dict
    assistant_node: dict
    context_used: dict


ConversationDetail.model_rebuild()
