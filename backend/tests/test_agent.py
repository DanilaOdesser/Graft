"""End-to-end agent-turn test. Falls through to the stub when ANTHROPIC_API_KEY is unset."""
import os
import uuid

from tests.conftest import ALEX_USER_ID, RECIPEBOX_CONV_ID


def _new_conversation(client, title_suffix: str) -> dict:
    return client.post("/api/conversations", json={
        "title": f"agent-test {title_suffix}",
        "owner_id": ALEX_USER_ID,
    }).json()


def test_agent_turn_creates_user_and_assistant_nodes(client):
    conv = _new_conversation(client, uuid.uuid4().hex[:6])

    res = client.post("/api/agent/turn", json={
        "node_id": conv["root_node_id"],
        "branch_id": conv["default_branch_id"],
        "user_message": "Hello, what can you help me with?",
        "budget": 1024,
    })
    assert res.status_code == 200, res.text
    body = res.json()

    # Both nodes returned
    assert body["user_node"]["role"] == "user"
    assert body["user_node"]["parent_id"] == conv["root_node_id"]
    assert body["assistant_node"]["role"] == "assistant"
    assert body["assistant_node"]["parent_id"] == body["user_node"]["id"]

    # Branch head advanced past assistant.
    branch = client.get(f"/api/branches/{conv['default_branch_id']}").json()
    assert branch["head_node_id"] == body["assistant_node"]["id"]

    # context_used reports counts.
    assert body["context_used"]["node_count"] >= 1
    assert body["context_used"]["total_tokens"] >= 0


def test_agent_turn_stub_when_no_api_key(client, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    conv = _new_conversation(client, uuid.uuid4().hex[:6])

    res = client.post("/api/agent/turn", json={
        "node_id": conv["root_node_id"],
        "branch_id": conv["default_branch_id"],
        "user_message": "test",
    }).json()
    assert "[Stub]" in res["assistant_node"]["content"]


def test_agent_turn_on_freshly_forked_branch_lands_on_new_branch(client):
    """Regression: when a branch is freshly forked, head == fork_node which lives on
    the parent branch. The first agent turn on the new branch must use the request's
    branch_id, not parent.branch_id, otherwise messages leak onto the parent branch."""
    conv = _new_conversation(client, uuid.uuid4().hex[:6])

    # Seed a turn on main so there's something to fork from.
    first = client.post("/api/agent/turn", json={
        "node_id": conv["root_node_id"],
        "branch_id": conv["default_branch_id"],
        "user_message": "main turn",
    }).json()
    main_head_before = first["assistant_node"]["id"]

    # Fork a new branch at the current main head.
    forked = client.post(f"/api/conversations/{conv['id']}/branches", json={
        "name": "feat/fork",
        "fork_node_id": main_head_before,
        "created_by": ALEX_USER_ID,
    }).json()
    assert forked["head_node_id"] == main_head_before  # head IS on main

    # First turn on the new branch — head still points at a node on main.
    res = client.post("/api/agent/turn", json={
        "node_id": forked["head_node_id"],
        "branch_id": forked["id"],
        "user_message": "hello on the fork",
    })
    assert res.status_code == 200, res.text
    body = res.json()

    # New nodes must be on the forked branch, not main.
    assert body["user_node"]["branch_id"] == forked["id"]
    assert body["assistant_node"]["branch_id"] == forked["id"]

    # Forked branch head advanced.
    fresh_fork = client.get(f"/api/branches/{forked['id']}").json()
    assert fresh_fork["head_node_id"] == body["assistant_node"]["id"]

    # Main head must NOT have advanced.
    fresh_main = client.get(f"/api/branches/{conv['default_branch_id']}").json()
    assert fresh_main["head_node_id"] == main_head_before
