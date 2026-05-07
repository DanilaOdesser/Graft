"""
Integration tests for DEV-B endpoints.
Requires: backend running at localhost:8000, seed data loaded.

Usage: python -m scripts.test_integration [--api-url URL]
"""
import sys
import argparse
import uuid
import requests

# Deterministic UUID mapping for seed data (matches load_seed.py)
NAMESPACE = uuid.UUID("12345678-1234-1234-1234-123456789abc")


def make_uuid(short_id: str) -> str:
    return str(uuid.uuid5(NAMESPACE, short_id))


# ── ANSI colors ───────────────────────────────────────────
G = "\033[32m"
R = "\033[31m"
C = "\033[36m"
B = "\033[1m"
D = "\033[2m"
RESET = "\033[0m"
CHECK = f"{G}\u2714{RESET}"
CROSS = f"{R}\u2718{RESET}"

passed = 0
failed = 0
errors = []


def section(title):
    print(f"\n{B}{C}{'─'*55}{RESET}")
    print(f"{B}{C}  {title}{RESET}")
    print(f"{B}{C}{'─'*55}{RESET}")


def test(name, condition, detail=""):
    global passed, failed
    if condition:
        print(f"  {CHECK}  {name}")
        passed += 1
    else:
        msg = f"  {CROSS}  {name}"
        if detail:
            msg += f"  {D}({detail}){RESET}"
        print(msg)
        failed += 1
        errors.append(f"{name}: {detail}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-url", default="http://localhost:8000/api")
    args = parser.parse_args()
    api = args.api_url

    USER_ALEX = make_uuid("u-alex")
    BR_AUTH = make_uuid("br-auth")
    BR_RECIPE_CRUD = make_uuid("br-recipe-crud")
    BR_SEARCH = make_uuid("br-search")
    NODE_05 = make_uuid("n-05")
    NODE_07 = make_uuid("n-07")

    print(f"{B}Graft DEV-B Integration Tests{RESET}")
    print(f"{D}API: {api}{RESET}")
    print(f"{D}User: {USER_ALEX}{RESET}")

    # ── Health check ──────────────────────────────────────
    section("Health Check")
    try:
        resp = requests.get(f"{api.replace('/api','')}/health", timeout=5)
        test("Backend is reachable", resp.status_code == 200, f"got {resp.status_code}")
    except requests.ConnectionError:
        print(f"\n  {CROSS}  {R}Backend not reachable at {api}{RESET}")
        print(f"  {D}Start it: cd backend && source venv/bin/activate && uvicorn main:app --reload{RESET}")
        sys.exit(1)

    # ── Node read ─────────────────────────────────────────
    section("Node Read (GET /api/nodes/:id)")
    resp = requests.get(f"{api}/nodes/{NODE_05}")
    test("GET node returns 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        node = resp.json()
        test("Node has content field", "content" in node and len(node["content"]) > 0)
        test("Node has token_count", "token_count" in node)

    resp404 = requests.get(f"{api}/nodes/00000000-0000-0000-0000-000000000000")
    test("GET missing node returns 404", resp404.status_code == 404)

    # ── Full-text search ──────────────────────────────────
    section("Full-Text Search (GET /api/search)")
    resp = requests.get(f"{api}/search", params={"q": "recipe", "user_id": USER_ALEX, "k": 10})
    test("Search returns 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        test("Search returns results", len(data) > 0, "empty")
        if data:
            test("Result has node_id", "node_id" in data[0])
            test("Result has rank", "rank" in data[0])
            test("Result has branch_name", "branch_name" in data[0])
            test("Result has conversation_title", "conversation_title" in data[0])
            test("Results sorted by rank DESC",
                 all(data[i]["rank"] >= data[i+1]["rank"] for i in range(len(data)-1)),
                 "not sorted")

    # ── Branch divergence ─────────────────────────────────
    section("Branch Divergence (GET /api/branches/:a/diverge/:b)")
    resp = requests.get(f"{api}/branches/{BR_AUTH}/diverge/{BR_RECIPE_CRUD}")
    test("Divergence returns 200", resp.status_code == 200, f"got {resp.status_code}")
    if resp.status_code == 200:
        data = resp.json()
        test("LCA is node n-07", data.get("lca_node_id") == NODE_07,
             f"got {data.get('lca_node_id')}")
        test("Auth branch has 6 unique nodes", data.get("only_a_count") == 6,
             f"got {data.get('only_a_count')}")
        test("Recipe-crud has 4 unique nodes", data.get("only_b_count") == 4,
             f"got {data.get('only_b_count')}")
        test("only_a_nodes is a list", isinstance(data.get("only_a_nodes"), list))
        test("only_b_nodes is a list", isinstance(data.get("only_b_nodes"), list))

    # ── Pins CRUD ─────────────────────────────────────────
    section("Pins CRUD")

    # Create
    resp = requests.post(f"{api}/branches/{BR_SEARCH}/pins", json={
        "node_id": NODE_07, "priority": 5,
        "reason": "Integration test pin", "pinned_by": USER_ALEX,
    })
    test("Create pin returns 201", resp.status_code == 201, f"got {resp.status_code}: {resp.text[:80]}")

    pin_id = None
    if resp.status_code == 201:
        pin = resp.json()
        pin_id = pin["id"]
        test("Pin has correct priority", pin["priority"] == 5)
        test("Pin has reason", pin["reason"] == "Integration test pin")

        # List
        resp2 = requests.get(f"{api}/branches/{BR_SEARCH}/pins")
        test("List pins returns 200", resp2.status_code == 200)
        pins = resp2.json()
        test("Created pin in list", any(p["id"] == pin_id for p in pins))

        # Duplicate -> 409
        resp3 = requests.post(f"{api}/branches/{BR_SEARCH}/pins", json={
            "node_id": NODE_07, "priority": 3, "pinned_by": USER_ALEX,
        })
        test("Duplicate pin returns 409", resp3.status_code == 409, f"got {resp3.status_code}")

        # Delete
        resp4 = requests.delete(f"{api}/pins/{pin_id}")
        test("Delete pin returns 204", resp4.status_code == 204, f"got {resp4.status_code}")

        # Verify deleted
        resp5 = requests.get(f"{api}/branches/{BR_SEARCH}/pins")
        pins_after = resp5.json()
        test("Pin removed from list", not any(p["id"] == pin_id for p in pins_after))

    # ── Imports CRUD ──────────────────────────────────────
    section("Imports CRUD")

    resp = requests.post(f"{api}/branches/{BR_SEARCH}/imports", json={
        "source_node_id": NODE_05, "include_descendants": False, "imported_by": USER_ALEX,
    })
    test("Create import returns 201", resp.status_code == 201, f"got {resp.status_code}: {resp.text[:80]}")

    if resp.status_code == 201:
        imp = resp.json()
        imp_id = imp["id"]
        test("Import has correct source", imp["source_node_id"] == NODE_05)
        test("Import include_descendants is False", imp["include_descendants"] is False)

        # List
        resp2 = requests.get(f"{api}/branches/{BR_SEARCH}/imports")
        test("List imports returns 200", resp2.status_code == 200)

        # Delete
        resp3 = requests.delete(f"{api}/imports/{imp_id}")
        test("Delete import returns 204", resp3.status_code == 204, f"got {resp3.status_code}")

    # ── Results ───────────────────────────────────────────
    total = passed + failed
    print(f"\n{B}{'═'*55}{RESET}")
    if failed == 0:
        print(f"{B}{G}  ALL {total} TESTS PASSED{RESET}")
    else:
        print(f"{B}{R}  {failed} FAILED{RESET}  {B}{G}{passed} PASSED{RESET}  {D}(of {total}){RESET}")
        print(f"\n{R}  Failures:{RESET}")
        for e in errors:
            print(f"    {CROSS}  {e}")
    print(f"{B}{'═'*55}{RESET}\n")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
