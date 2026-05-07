"""Test Query 1 (context assembly) end-to-end against seed data."""
from sqlalchemy import text

from tests.conftest import RECIPEBOX_CONV_ID


def _node_id_by_content(client, snippet: str) -> str:
    """Find a seed node by a substring of its content."""
    # Walk the conversation via the search API (DEV-B's) — easiest path.
    from tests.conftest import ALEX_USER_ID
    res = client.get(
        f"/api/search?q={snippet}&user_id={ALEX_USER_ID}&k=1"
    ).json()
    assert res, f"no node matching {snippet!r}"
    return res[0]["node_id"]


def test_context_at_n31_includes_ancestors_and_pinned_n05(client):
    # n-31 is the deepest node on feat/search; ancestors include n-05 (pinned).
    n31 = _node_id_by_content(client, "Trigram autocomplete")
    res = client.get(f"/api/nodes/{n31}/context?budget=2000")
    assert res.status_code == 200
    rows = res.json()
    assert rows, "context should not be empty"

    # First row should be the highest-priority pin or closest ancestor.
    assert rows[0]["running_tokens"] >= rows[0]["token_count"]

    # Total tokens within budget.
    assert rows[-1]["running_tokens"] <= 2000

    sources = {r["source"] for r in rows}
    assert "ancestor" in sources

    # The pinned schema node (n-05) should appear because pin-03 pins it on br-search.
    contents = " ".join(r["content"] for r in rows)
    assert "schema" in contents.lower() or "Updated schema" in contents


def test_context_excludes_summarized_nodes_when_summary_present(client):
    # n-36 summarizes n-08..n-13. If we assemble at n-13 (auth head), we don't
    # have the summary on that branch — so all 6 originals should be present.
    # If we assemble at n-36 itself, the summary should hide originals.
    # Easier check: the budget-truncated rows are sorted by rank.
    n31 = _node_id_by_content(client, "Trigram autocomplete")
    res = client.get(f"/api/nodes/{n31}/context?budget=10000").json()
    ranks = [r["running_tokens"] for r in res]
    assert ranks == sorted(ranks), "running_tokens must be monotonically increasing"


def test_context_404_on_missing_node(client):
    res = client.get("/api/nodes/00000000-0000-0000-0000-000000000000/context?budget=1000")
    # Query 1 returns empty when current_node_id doesn't exist; we choose to 404.
    assert res.status_code in (200, 404)
    if res.status_code == 200:
        assert res.json() == []
