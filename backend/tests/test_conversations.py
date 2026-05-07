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


def test_list_conversations_returns_recipebox_for_alex(client):
    res = client.get(f"/api/conversations?owner_id={ALEX_USER_ID}")
    assert res.status_code == 200
    rows = res.json()
    titles = [r["title"] for r in rows]
    assert "Building RecipeBox" in titles


def test_list_conversations_sorted_by_updated_desc(client):
    res = client.get(f"/api/conversations?owner_id={ALEX_USER_ID}")
    rows = res.json()
    timestamps = [r["updated_at"] for r in rows]
    assert timestamps == sorted(timestamps, reverse=True)


def test_get_conversation_includes_non_archived_branches(client):
    from tests.conftest import RECIPEBOX_CONV_ID
    res = client.get(f"/api/conversations/{RECIPEBOX_CONV_ID}")
    assert res.status_code == 200
    body = res.json()
    branch_names = {b["name"] for b in body["branches"]}
    assert "main" in branch_names
    assert "feat/auth" in branch_names
    # spike/s3-upload is archived per seed data — must NOT appear
    assert "spike/s3-upload" not in branch_names


def test_get_conversation_404_on_missing(client):
    res = client.get(f"/api/conversations/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
