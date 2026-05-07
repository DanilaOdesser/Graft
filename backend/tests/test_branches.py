import uuid

from tests.conftest import ALEX_USER_ID, RECIPEBOX_CONV_ID, BR_MAIN_ID


def test_fork_branch_sets_base_and_head_to_fork_node(client):
    # Use the seed n-07 (a known mid-history node on br-main)
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    fork_node = main["head_node_id"]

    res = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": f"feat/test-{uuid.uuid4().hex[:6]}",
        "fork_node_id": fork_node,
        "created_by": ALEX_USER_ID,
    })
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["base_node_id"] == fork_node
    assert body["head_node_id"] == fork_node
    assert body["is_archived"] is False
    assert body["conversation_id"] == RECIPEBOX_CONV_ID


def test_fork_branch_rejects_duplicate_name_in_same_conversation(client):
    # main already exists on RECIPEBOX_CONV
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    res = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": "main",
        "fork_node_id": main["head_node_id"],
        "created_by": ALEX_USER_ID,
    })
    assert res.status_code == 409


def test_get_branch_returns_main(client):
    res = client.get(f"/api/branches/{BR_MAIN_ID}")
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "main"
    assert body["is_archived"] is False
    assert body["base_node_id"] is None  # main is the root branch


def test_archive_branch_sets_is_archived(client):
    # Create a throwaway branch first
    main = client.get(f"/api/branches/{BR_MAIN_ID}").json()
    create = client.post(f"/api/conversations/{RECIPEBOX_CONV_ID}/branches", json={
        "name": f"to-archive-{uuid.uuid4().hex[:6]}",
        "fork_node_id": main["head_node_id"],
        "created_by": ALEX_USER_ID,
    }).json()

    res = client.post(f"/api/branches/{create['id']}/archive")
    assert res.status_code == 204

    after = client.get(f"/api/branches/{create['id']}").json()
    assert after["is_archived"] is True


def test_get_branch_404_missing(client):
    res = client.get("/api/branches/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 404
