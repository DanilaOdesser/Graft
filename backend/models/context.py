import uuid
from sqlalchemy import (
    Column, String, Text, Integer, SmallInteger, Boolean,
    ForeignKey, TIMESTAMP, CheckConstraint, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from db import Base


class NodeAncestry(Base):
    __tablename__ = "node_ancestry"

    ancestor_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    descendant_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    depth = Column(Integer, nullable=False)


class ContextPin(Base):
    __tablename__ = "context_pins"
    __table_args__ = (
        UniqueConstraint("branch_id", "node_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    pinned_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=True)
    priority = Column(SmallInteger, default=0, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class ContextImport(Base):
    __tablename__ = "context_imports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    target_branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    include_descendants = Column(Boolean, default=False, nullable=False)
    imported_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    imported_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)


class NodeSummary(Base):
    __tablename__ = "node_summaries"

    summary_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    summarized_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)


class Tag(Base):
    __tablename__ = "tags"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(50), unique=True, nullable=False)


class NodeTag(Base):
    __tablename__ = "node_tags"

    node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), primary_key=True)
    tag_id = Column(UUID(as_uuid=True), ForeignKey("tags.id"), primary_key=True)


class ClaudeExport(Base):
    __tablename__ = "claude_exports"

    session_id = Column(UUID(as_uuid=True), primary_key=True)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    source_node_id = Column(UUID(as_uuid=True), ForeignKey("nodes.id"), nullable=False)
    file_path = Column(Text, nullable=False)
    cwd = Column(Text, nullable=False)
    exported_message_count = Column(Integer, nullable=False)
    last_imported_uuid = Column(Text, nullable=True)
    exported_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
    last_imported_at = Column(TIMESTAMP(timezone=True), nullable=True)


class BranchShare(Base):
    __tablename__ = "branch_shares"
    __table_args__ = (
        UniqueConstraint("branch_id", "shared_with"),
        CheckConstraint("permission IN ('view', 'fork', 'comment')"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    branch_id = Column(UUID(as_uuid=True), ForeignKey("branches.id"), nullable=False)
    shared_with = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    permission = Column(String(20), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), nullable=False)
