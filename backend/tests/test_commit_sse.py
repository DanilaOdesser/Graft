import pytest
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient
from main import app
from sse import subscribe, publish, unsubscribe
from llm import summarize_nodes

ALEX_USER_ID = "2f75cca7-7ebc-5af0-a919-f0bfe59e4125"

@pytest.mark.asyncio
async def test_publish_delivers_to_subscriber():
    q = await subscribe("conv-abc")
    await publish("conv-abc", "node_created", {"node": {"id": "x"}})
    msg = q.get_nowait()
    assert "node_created" in msg
    assert '"id": "x"' in msg
    unsubscribe("conv-abc", q)

@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery():
    q = await subscribe("conv-xyz")
    unsubscribe("conv-xyz", q)
    await publish("conv-xyz", "test_event", {})
    assert q.empty()

def test_summarize_nodes_stub_when_no_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    nodes = [
        {"role": "user", "content": "How do I reverse a list in Python?"},
        {"role": "assistant", "content": "Use list[::-1] or list.reverse()."},
    ]
    result = summarize_nodes(nodes)
    assert isinstance(result, str)
    assert len(result) > 0

def test_summarize_nodes_empty():
    result = summarize_nodes([])
    assert isinstance(result, str)

@pytest.fixture
def client():
    return TestClient(app)

def test_commit_creates_summary_node(client):
    # Create a fresh conversation with some turns first
    conv = client.post("/api/conversations", json={
        "title": f"commit-test-{os.urandom(4).hex()}",
        "owner_id": ALEX_USER_ID,
    }).json()
    conv_id = conv["id"]
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    branch_id = conv_detail["branches"][0]["id"]
    head_id = conv_detail["branches"][0]["head_node_id"]

    # Send a turn
    turn = client.post("/api/agent/turn", json={
        "node_id": head_id,
        "branch_id": branch_id,
        "user_message": "What is 2+2?",
        "budget": 4096,
    }).json()

    # Commit
    res = client.post(f"/api/branches/{branch_id}/commit", json={
        "commit_message": "First math question",
    })
    assert res.status_code == 201
    body = res.json()
    assert "node" in body
    assert body["node"]["node_type"] == "summary"
    assert body["node"]["role"] == "summary"
    assert body["commit_message"] == "First math question"
    assert "llm_summary" in body
    # Branch head should now point to the summary node
    branch = client.get(f"/api/branches/{branch_id}").json()
    assert branch["head_node_id"] == body["node"]["id"]

def test_commit_returns_400_when_head_is_already_summary(client):
    conv = client.post("/api/conversations", json={
        "title": f"commit-idempotent-{os.urandom(4).hex()}",
        "owner_id": ALEX_USER_ID,
    }).json()
    conv_id = conv["id"]
    conv_detail = client.get(f"/api/conversations/{conv_id}").json()
    branch_id = conv_detail["branches"][0]["id"]
    head_id = conv_detail["branches"][0]["head_node_id"]
    client.post("/api/agent/turn", json={
        "node_id": head_id, "branch_id": branch_id,
        "user_message": "hello", "budget": 4096,
    })
    # First commit succeeds
    r1 = client.post(f"/api/branches/{branch_id}/commit", json={"commit_message": "init"})
    assert r1.status_code == 201
    # Second commit with nothing new should fail
    r2 = client.post(f"/api/branches/{branch_id}/commit", json={"commit_message": "empty"})
    assert r2.status_code == 400
