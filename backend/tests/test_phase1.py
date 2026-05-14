"""
Phase 1 Verification Suite — DEV-B "Edits & Search Path"
Run:  cd backend && source venv/bin/activate && python tests/test_phase1.py
"""
import sys
import os
import inspect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

# ── ANSI colors ──────────────────────────────────────────────────────────────
G = "\033[32m"   # green
R = "\033[31m"   # red
Y = "\033[33m"   # yellow
C = "\033[36m"   # cyan
B = "\033[1m"    # bold
D = "\033[2m"    # dim
RESET = "\033[0m"
CHECK = f"{G}\u2714{RESET}"
CROSS = f"{R}\u2718{RESET}"

passed = 0
failed = 0
errors = []


def section(title):
    print(f"\n{B}{C}{'─'*60}{RESET}")
    print(f"{B}{C}  {title}{RESET}")
    print(f"{B}{C}{'─'*60}{RESET}")


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


# ═══════════════════════════════════════════════════════════════════════════════
#  1. MODEL IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════
section("1. Model Imports")

try:
    from models.core import User, Conversation, Node, Branch
    test("Import core models (User, Conversation, Node, Branch)", True)
except Exception as e:
    test("Import core models", False, str(e))

try:
    from models.context import (
        NodeAncestry, ContextPin, ContextImport,
        NodeSummary, Tag, NodeTag,
    )
    test("Import context models (6 DEV-B models)", True)
except Exception as e:
    test("Import context models", False, str(e))

# ═══════════════════════════════════════════════════════════════════════════════
#  2. TABLE NAMES
# ═══════════════════════════════════════════════════════════════════════════════
section("2. Table Names Match DDL")

expected_tables = {
    "User": "users",
    "Conversation": "conversations",
    "Node": "nodes",
    "Branch": "branches",
    "NodeAncestry": "node_ancestry",
    "ContextPin": "context_pins",
    "ContextImport": "context_imports",
    "NodeSummary": "node_summaries",
    "Tag": "tags",
    "NodeTag": "node_tags",
}

all_models = {}
try:
    all_models = {
        "User": User, "Conversation": Conversation, "Node": Node, "Branch": Branch,
        "NodeAncestry": NodeAncestry, "ContextPin": ContextPin,
        "ContextImport": ContextImport, "NodeSummary": NodeSummary,
        "Tag": Tag, "NodeTag": NodeTag,
    }
except NameError:
    pass

for class_name, expected_table in expected_tables.items():
    model = all_models.get(class_name)
    if model:
        actual = model.__tablename__
        test(
            f"{class_name}.__tablename__ == '{expected_table}'",
            actual == expected_table,
            f"got '{actual}'"
        )
    else:
        test(f"{class_name} table name", False, "model not imported")

# ═══════════════════════════════════════════════════════════════════════════════
#  3. COLUMN VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
section("3. Column Verification (DEV-B models)")

def get_col_names(model):
    return {c.name for c in model.__table__.columns}


# NodeAncestry
if "NodeAncestry" in all_models:
    cols = get_col_names(NodeAncestry)
    test("NodeAncestry has ancestor_id, descendant_id, depth",
         {"ancestor_id", "descendant_id", "depth"} <= cols,
         f"got {cols}")
    # Composite PK
    pk_cols = {c.name for c in NodeAncestry.__table__.primary_key.columns}
    test("NodeAncestry PK is (ancestor_id, descendant_id)",
         pk_cols == {"ancestor_id", "descendant_id"},
         f"got {pk_cols}")

# ContextPin
if "ContextPin" in all_models:
    cols = get_col_names(ContextPin)
    expected = {"id", "branch_id", "node_id", "pinned_by", "reason", "priority", "created_at"}
    test("ContextPin has all 7 columns",
         expected <= cols, f"missing: {expected - cols}")
    # Unique constraint
    uqs = [c for c in ContextPin.__table__.constraints
           if hasattr(c, 'columns') and len(c.columns) == 2
           and {col.name for col in c.columns} == {"branch_id", "node_id"}]
    test("ContextPin UNIQUE(branch_id, node_id)", len(uqs) > 0, "constraint not found")

# ContextImport
if "ContextImport" in all_models:
    cols = get_col_names(ContextImport)
    expected = {"id", "target_branch_id", "source_node_id", "include_descendants", "imported_by", "imported_at"}
    test("ContextImport has all 6 columns",
         expected <= cols, f"missing: {expected - cols}")

# NodeSummary
if "NodeSummary" in all_models:
    pk_cols = {c.name for c in NodeSummary.__table__.primary_key.columns}
    test("NodeSummary PK is (summary_node_id, summarized_node_id)",
         pk_cols == {"summary_node_id", "summarized_node_id"},
         f"got {pk_cols}")

# Tag
if "Tag" in all_models:
    cols = get_col_names(Tag)
    test("Tag has id and name", {"id", "name"} <= cols, f"got {cols}")
    name_col = Tag.__table__.c.name
    test("Tag.name is unique", name_col.unique is True, "not unique")

# NodeTag
if "NodeTag" in all_models:
    pk_cols = {c.name for c in NodeTag.__table__.primary_key.columns}
    test("NodeTag PK is (node_id, tag_id)",
         pk_cols == {"node_id", "tag_id"}, f"got {pk_cols}")

# ═══════════════════════════════════════════════════════════════════════════════
#  4. FOREIGN KEY VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
section("4. Foreign Key References")

def get_fk_targets(model):
    """Return {col_name: 'table.column'} for all FK columns."""
    fks = {}
    for col in model.__table__.columns:
        for fk in col.foreign_keys:
            fks[col.name] = str(fk.target_fullname)
    return fks

fk_expectations = {
    "NodeAncestry": {"ancestor_id": "nodes.id", "descendant_id": "nodes.id"},
    "ContextPin": {"branch_id": "branches.id", "node_id": "nodes.id", "pinned_by": "users.id"},
    "ContextImport": {"target_branch_id": "branches.id", "source_node_id": "nodes.id", "imported_by": "users.id"},
    "NodeSummary": {"summary_node_id": "nodes.id", "summarized_node_id": "nodes.id"},
    "NodeTag": {"node_id": "nodes.id", "tag_id": "tags.id"},
}

for model_name, expected_fks in fk_expectations.items():
    model = all_models.get(model_name)
    if not model:
        test(f"{model_name} FKs", False, "model not imported")
        continue
    actual_fks = get_fk_targets(model)
    for col, target in expected_fks.items():
        test(f"{model_name}.{col} -> {target}",
             actual_fks.get(col) == target,
             f"got {actual_fks.get(col, 'MISSING')}")


# ═══════════════════════════════════════════════════════════════════════════════
#  5. ROUTER IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════
section("5. Router Imports")

try:
    from routers.nodes import router as nodes_router
    test("Import nodes router", True)
except Exception as e:
    test("Import nodes router", False, str(e))

try:
    from routers.context import router as context_router
    test("Import context router", True)
except Exception as e:
    test("Import context router", False, str(e))

try:
    from routers.search import router as search_router
    test("Import search router", True)
except Exception as e:
    test("Import search router", False, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
#  6. ROUTE REGISTRATION (all 10 DEV-B routes on the app)
# ═══════════════════════════════════════════════════════════════════════════════
section("6. Route Registration in FastAPI App")

try:
    from main import app

    # Collect all routes as (method, path) pairs
    app_routes = set()
    for route in app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            for method in route.methods:
                app_routes.add((method, route.path))

    expected_routes = [
        ("POST",   "/api/nodes"),
        ("GET",    "/api/nodes/{node_id}"),
        ("POST",   "/api/branches/{branch_id}/pins"),
        ("GET",    "/api/branches/{branch_id}/pins"),
        ("DELETE", "/api/pins/{pin_id}"),
        ("POST",   "/api/branches/{branch_id}/imports"),
        ("GET",    "/api/branches/{branch_id}/imports"),
        ("DELETE", "/api/imports/{import_id}"),
        ("GET",    "/api/branches/{branch_a}/diverge/{branch_b}"),
        ("GET",    "/api/search"),
    ]

    for method, path in expected_routes:
        test(f"{method:6s} {path}",
             (method, path) in app_routes,
             "NOT REGISTERED")

    test("Health endpoint exists",
         ("GET", "/health") in app_routes, "NOT REGISTERED")

except Exception as e:
    test("Load FastAPI app", False, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
#  7. PYDANTIC SCHEMA VALIDATION
# ═══════════════════════════════════════════════════════════════════════════════
section("7. Pydantic Schema Validation")

try:
    from routers.nodes import NodeCreate
    from routers.context import PinCreate, ImportCreate

    uid = "00000000-0000-0000-0000-000000000001"

    # Valid NodeCreate
    nc = NodeCreate(conversation_id=uid, branch_id=uid, node_type="message", role="user", content="hello")
    test("NodeCreate accepts valid input", nc.content == "hello")

    # Optional parent_id
    test("NodeCreate.parent_id defaults to None", nc.parent_id is None)

    # Valid PinCreate
    pc = PinCreate(node_id=uid, pinned_by=uid, priority=10, reason="test")
    test("PinCreate accepts valid input", pc.priority == 10)

    # PinCreate defaults
    pc2 = PinCreate(node_id=uid, pinned_by=uid)
    test("PinCreate.priority defaults to 0", pc2.priority == 0)
    test("PinCreate.reason defaults to None", pc2.reason is None)

    # Valid ImportCreate
    ic = ImportCreate(source_node_id=uid, imported_by=uid, include_descendants=True)
    test("ImportCreate accepts valid input", ic.include_descendants is True)

    # ImportCreate defaults
    ic2 = ImportCreate(source_node_id=uid, imported_by=uid)
    test("ImportCreate.include_descendants defaults to False", ic2.include_descendants is False)

except Exception as e:
    test("Schema validation", False, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
#  8. TOKEN COUNT LOGIC
# ═══════════════════════════════════════════════════════════════════════════════
section("8. Token Count Calculation")

def token_count(content: str) -> int:
    return int(len(content.split()) * 1.3)

test("'hello world' -> 2 tokens (2 * 1.3 = 2)",
     token_count("hello world") == 2)

test("10-word sentence -> 13 tokens",
     token_count("one two three four five six seven eight nine ten") == 13)

test("Empty string -> 0 tokens",
     token_count("") == 0,
     f"got {token_count('')}")

test("Single word -> 1 token",
     token_count("hello") == 1)


# ═══════════════════════════════════════════════════════════════════════════════
#  9. SQL QUERY STRINGS
# ═══════════════════════════════════════════════════════════════════════════════
section("9. SQL Query Validation")

try:
    from routers.search import DIVERGENCE_SQL, SEARCH_SQL

    # Divergence query checks
    test("DIVERGENCE_SQL contains :branch_a param",
         ":branch_a" in DIVERGENCE_SQL)
    test("DIVERGENCE_SQL contains :branch_b param",
         ":branch_b" in DIVERGENCE_SQL)
    test("DIVERGENCE_SQL computes LCA",
         "lca" in DIVERGENCE_SQL.lower())
    test("DIVERGENCE_SQL uses node_ancestry closure table",
         "node_ancestry" in DIVERGENCE_SQL)
    test("DIVERGENCE_SQL uses EXCEPT for set difference",
         "EXCEPT" in DIVERGENCE_SQL)

    # Search query checks
    test("SEARCH_SQL contains :query_text param",
         ":query_text" in SEARCH_SQL)
    test("SEARCH_SQL contains :user_id param",
         ":user_id" in SEARCH_SQL)
    test("SEARCH_SQL contains :k param",
         ":k" in SEARCH_SQL)
    test("SEARCH_SQL uses websearch_to_tsquery",
         "websearch_to_tsquery" in SEARCH_SQL)
    test("SEARCH_SQL uses ts_rank for relevance",
         "ts_rank" in SEARCH_SQL)
    test("SEARCH_SQL filters archived branches",
         "is_archived = false" in SEARCH_SQL)
    test("SEARCH_SQL uses GIN-indexed content_tsv",
         "content_tsv" in SEARCH_SQL)

except Exception as e:
    test("SQL query strings", False, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
#  10. HANDLER SIGNATURES
# ═══════════════════════════════════════════════════════════════════════════════
section("10. Endpoint Handler Signatures")

try:
    from routers.nodes import create_node, get_node
    from routers.context import create_pin, list_pins, delete_pin, create_import, list_imports, delete_import
    from routers.search import branch_divergence, search_nodes

    handlers = {
        "create_node": (create_node, ["body", "db"]),
        "get_node": (get_node, ["node_id", "db"]),
        "create_pin": (create_pin, ["branch_id", "body", "db"]),
        "list_pins": (list_pins, ["branch_id", "db"]),
        "delete_pin": (delete_pin, ["pin_id", "db"]),
        "create_import": (create_import, ["branch_id", "body", "db"]),
        "list_imports": (list_imports, ["branch_id", "db"]),
        "delete_import": (delete_import, ["import_id", "db"]),
        "branch_divergence": (branch_divergence, ["branch_a", "branch_b", "db"]),
        "search_nodes": (search_nodes, ["q", "user_id", "k", "db"]),
    }

    for name, (fn, expected_params) in handlers.items():
        sig = inspect.signature(fn)
        actual_params = list(sig.parameters.keys())
        test(f"{name}({', '.join(expected_params)})",
             actual_params == expected_params,
             f"got ({', '.join(actual_params)})")

except Exception as e:
    test("Handler signatures", False, str(e))


# ═══════════════════════════════════════════════════════════════════════════════
#  RESULTS
# ═══════════════════════════════════════════════════════════════════════════════

total = passed + failed
print(f"\n{B}{'═'*60}{RESET}")
if failed == 0:
    print(f"{B}{G}  ALL {total} TESTS PASSED{RESET}")
else:
    print(f"{B}{R}  {failed} FAILED{RESET}  {B}{G}{passed} PASSED{RESET}  {D}(of {total}){RESET}")
    print(f"\n{R}  Failures:{RESET}")
    for e in errors:
        print(f"    {CROSS}  {e}")
print(f"{B}{'═'*60}{RESET}\n")

sys.exit(1 if failed else 0)
