import uuid

from tests.conftest import ALEX_USER_ID


def test_create_conversation_creates_main_branch_and_root_node(client, unique_title):
    res = client.post("/api/conversations", json={
        "title": unique_title,
        "owner_id": ALEX_USER_ID,
    })
    assert res.status_code == 201, res.text
    body = res.json()

    # Conversation fields
    assert body["title"] == unique_title
    assert body["owner_id"] == ALEX_USER_ID
    assert uuid.UUID(body["id"])  # valid uuid

    # Backfilled FKs
    assert body["root_node_id"] is not None
    assert body["default_branch_id"] is not None
    assert uuid.UUID(body["root_node_id"])
    assert uuid.UUID(body["default_branch_id"])


def test_create_conversation_root_node_is_system_role(client, unique_title):
    res = client.post("/api/conversations", json={
        "title": unique_title,
        "owner_id": ALEX_USER_ID,
    })
    body = res.json()

    # Verify the root node via DEV-B's GET /api/nodes/{id}
    root = client.get(f"/api/nodes/{body['root_node_id']}").json()
    assert root["role"] == "system"
    assert root["parent_id"] is None
    assert root["branch_id"] == body["default_branch_id"]


def test_create_conversation_rejects_blank_title(client):
    res = client.post("/api/conversations", json={
        "title": "",
        "owner_id": ALEX_USER_ID,
    })
    assert res.status_code == 422
