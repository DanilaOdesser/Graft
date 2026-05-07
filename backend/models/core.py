import uuid
from sqlalchemy import (
    Column, String, Text, Integer, Boolean, ForeignKey, TIMESTAMP
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    display_name = Column(String(100), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False)
    root_node_id = Column(UUID(as_uuid=True))
    default_branch_id = Column(UUID(as_uuid=True))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class Node(Base):
    __tablename__ = "nodes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"))
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    node_type = Column(String(20), nullable=False)
    role = Column(String(20))
    content = Column(Text, nullable=False)
    token_count = Column(Integer, nullable=False, default=0)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class Branch(Base):
    __tablename__ = "branches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    name = Column(String(100), nullable=False)
    head_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"))
    base_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    is_archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
