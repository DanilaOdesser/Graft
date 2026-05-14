"""Shared serialization helpers used by multiple routers.

Consolidates _branch_to_dict, _node_to_dict, and _token_count which were
previously duplicated across agent.py, branches.py, conversations.py,
nodes.py, and export.py.
"""
from __future__ import annotations

from models.core import Branch, Node


def branch_to_dict(b: Branch) -> dict:
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


def node_to_dict(n: Node) -> dict:
    return {
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


def token_count(content: str) -> int:
    """Approximate LLM token count: word_count * 1.3."""
    return int(len(content.split()) * 1.3)
