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
        "user_message": "test",
    }).json()
    assert "[Stub]" in res["assistant_node"]["content"]
