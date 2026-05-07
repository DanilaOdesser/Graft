"""
Phase 2 Verification Suite — CLI Ingestion & Integration Test Infra
Run:  cd backend && source venv/bin/activate && python tests/test_phase2.py
"""
import sys
import os
import re
import uuid
import tempfile
import inspect

# backend/ for db/models imports, repo root for scripts/ imports
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_DIR = os.path.dirname(BACKEND_DIR)
sys.path.insert(0, BACKEND_DIR)
sys.path.insert(0, REPO_DIR)
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")

# ── ANSI colors ──────────────────────────────────────────────────────────────
G = "\033[32m"
R = "\033[31m"
Y = "\033[33m"
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


def write_tmp(content: str) -> str:
    """Write content to a temp file and return its path."""
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    f.write(content)
    f.close()
    return f.name


# ═══════════════════════════════════════════════════════════════════════════════
#  1. INGEST — IMPORTS
# ═══════════════════════════════════════════════════════════════════════════════
section("1. Ingest Module Imports")

try:
    from scripts.ingest import parse_transcript, DEFAULT_API
    test("Import parse_transcript from scripts.ingest", True)
    test("DEFAULT_API is localhost:8000", DEFAULT_API == "http://localhost:8000/api")
except Exception as e:
    test("Import scripts.ingest", False, str(e))
    print(f"\n  {R}Cannot continue without ingest module.{RESET}")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════════════════════
#  2. PARSE TRANSCRIPT — BASIC
# ═══════════════════════════════════════════════════════════════════════════════
section("2. parse_transcript — Basic Parsing")

# Standard 3-turn conversation
basic = write_tmp(
    "User: Hello world\n"
    "Assistant: Hi there!\n"
    "User: Thanks\n"
)
msgs = parse_transcript(basic)
test("Parses 3 messages from 3-turn conversation", len(msgs) == 3, f"got {len(msgs)}")
test("First message role is 'user'", msgs[0][0] == "user", f"got '{msgs[0][0]}'")
test("First message content is 'Hello world'", msgs[0][1] == "Hello world", f"got '{msgs[0][1]}'")
test("Second message role is 'assistant'", msgs[1][0] == "assistant")
test("Third message role is 'user'", msgs[2][0] == "user")
os.unlink(basic)


# ═══════════════════════════════════════════════════════════════════════════════
#  3. PARSE TRANSCRIPT — ROLE DETECTION
# ═══════════════════════════════════════════════════════════════════════════════
section("3. parse_transcript — Role Detection")

# All three roles
roles = write_tmp(
    "System: You are helpful.\n"
    "User: Hi\n"
    "Assistant: Hello\n"
)
msgs = parse_transcript(roles)
test("Detects 'system' role", msgs[0][0] == "system", f"got '{msgs[0][0]}'")
test("Detects 'user' role", msgs[1][0] == "user")
test("Detects 'assistant' role", msgs[2][0] == "assistant")
test("Roles are lowercased", all(r == r.lower() for r, _ in msgs))
os.unlink(roles)


# ═══════════════════════════════════════════════════════════════════════════════
#  4. PARSE TRANSCRIPT — MULTILINE CONTENT
# ═══════════════════════════════════════════════════════════════════════════════
section("4. parse_transcript — Multiline Content")

multiline = write_tmp(
    "User: Can you write some code?\n"
    "Assistant: Here's the code:\n"
    "\n"
    "def hello():\n"
    "    print('hello')\n"
    "\n"
    "That should work.\n"
    "User: Thanks!\n"
)
msgs = parse_transcript(multiline)
test("Parses 3 messages with multiline content", len(msgs) == 3, f"got {len(msgs)}")
test("Multiline content preserved",
     "def hello():" in msgs[1][1],
     f"content: '{msgs[1][1][:50]}...'")
test("Multiline includes trailing text",
     "That should work." in msgs[1][1])
os.unlink(multiline)


# ═══════════════════════════════════════════════════════════════════════════════
#  5. PARSE TRANSCRIPT — EDGE CASES
# ═══════════════════════════════════════════════════════════════════════════════
section("5. parse_transcript — Edge Cases")

# Empty file
empty = write_tmp("")
msgs = parse_transcript(empty)
test("Empty file returns empty list", msgs == [], f"got {msgs}")
os.unlink(empty)

# No role markers
no_roles = write_tmp("Just some text without role markers.\nAnother line.\n")
msgs = parse_transcript(no_roles)
test("No role markers returns empty list", msgs == [], f"got {len(msgs)} messages")
os.unlink(no_roles)

# Only whitespace content after role
whitespace = write_tmp("User:   \nAssistant: Real content\n")
msgs = parse_transcript(whitespace)
test("Skips messages with only whitespace content",
     len(msgs) == 1 and msgs[0][0] == "assistant",
     f"got {len(msgs)} messages")
os.unlink(whitespace)

# Content with colon (shouldn't split on mid-line colons)
colon = write_tmp("User: Here's a dict: {key: value}\nAssistant: Got it\n")
msgs = parse_transcript(colon)
test("Colon in content doesn't break parsing",
     len(msgs) == 2, f"got {len(msgs)}")
if len(msgs) == 2:
    test("Content with colon preserved",
         "{key: value}" in msgs[0][1],
         f"got '{msgs[0][1]}'")
os.unlink(colon)


# ═══════════════════════════════════════════════════════════════════════════════
#  6. PARSE TRANSCRIPT — SAMPLE FILE
# ═══════════════════════════════════════════════════════════════════════════════
section("6. parse_transcript — Sample Transcript File")

sample_path = os.path.join(REPO_DIR, "scripts", "sample_transcript.txt")
if os.path.exists(sample_path):
    msgs = parse_transcript(sample_path)
    test("Sample transcript parses", len(msgs) > 0, "empty")
    test("Sample has 6 messages (3 User + 3 Assistant)",
         len(msgs) == 6, f"got {len(msgs)}")
    roles_found = [r for r, _ in msgs]
    test("Alternating user/assistant roles",
         roles_found == ["user", "assistant", "user", "assistant", "user", "assistant"],
         f"got {roles_found}")
    test("First message mentions Postgres",
         "postgres" in msgs[0][1].lower(),
         f"got '{msgs[0][1][:40]}...'")
    test("Last message mentions tsvector or GIN",
         "tsvector" in msgs[5][1].lower() or "gin" in msgs[5][1].lower())
else:
    test("Sample transcript exists", False, f"not found at {sample_path}")


# ═══════════════════════════════════════════════════════════════════════════════
#  7. TITLE EXTRACTION LOGIC
# ═══════════════════════════════════════════════════════════════════════════════
section("7. Title Extraction from Filename")

# Replicate the title logic from ingest.py main()
def extract_title(filepath: str) -> str:
    return filepath.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("_", " ").title()

test("'transcript.txt' -> 'Transcript'",
     extract_title("/path/to/transcript.txt") == "Transcript")
test("'my_cool_chat.txt' -> 'My Cool Chat'",
     extract_title("/tmp/my_cool_chat.txt") == "My Cool Chat")
test("'sample_transcript.txt' -> 'Sample Transcript'",
     extract_title("scripts/sample_transcript.txt") == "Sample Transcript")
test("No extension handled",
     extract_title("notes") == "Notes")
test("Deep path handled",
     extract_title("/a/b/c/d/file_name.txt") == "File Name")


# ═══════════════════════════════════════════════════════════════════════════════
#  8. UUID MAPPING (Integration Test Infra)
# ═══════════════════════════════════════════════════════════════════════════════
section("8. Integration Test — UUID Mapping")

try:
    from scripts.test_integration import make_uuid, NAMESPACE
    test("Import make_uuid from test_integration", True)
except Exception as e:
    test("Import make_uuid", False, str(e))

# Deterministic
test("make_uuid is deterministic",
     make_uuid("test") == make_uuid("test"))

# Different inputs -> different UUIDs
test("Different inputs produce different UUIDs",
     make_uuid("u-alex") != make_uuid("u-jamie"))

# Output is valid UUID string
try:
    result = make_uuid("n-07")
    uuid.UUID(result)
    test("make_uuid output is valid UUID", True)
except ValueError:
    test("make_uuid output is valid UUID", False, f"got '{result}'")

# Uses uuid5 with correct namespace
expected = str(uuid.uuid5(NAMESPACE, "u-alex"))
test("Matches uuid5(NAMESPACE, 'u-alex')",
     make_uuid("u-alex") == expected,
     f"got {make_uuid('u-alex')}, expected {expected}")

# All seed IDs produce distinct UUIDs
seed_ids = ["u-alex", "u-jamie", "br-main", "br-auth", "br-recipe-crud",
            "br-search", "n-01", "n-05", "n-07", "conv-recipebox"]
uuids = [make_uuid(sid) for sid in seed_ids]
test("All 10 seed IDs produce unique UUIDs",
     len(set(uuids)) == 10, f"got {len(set(uuids))} unique")


# ═══════════════════════════════════════════════════════════════════════════════
#  9. INTEGRATION TEST — STRUCTURE VERIFICATION
# ═══════════════════════════════════════════════════════════════════════════════
section("9. Integration Test — Structure & Coverage")

import scripts.test_integration as integration_mod

# Has main function
test("test_integration has main() function",
     hasattr(integration_mod, "main") and callable(integration_mod.main))

# Has section and test helpers
test("Has section() helper", hasattr(integration_mod, "section"))
test("Has test() helper", hasattr(integration_mod, "test"))

# Check the source covers all required endpoint paths
source = inspect.getsource(integration_mod)

endpoint_patterns = [
    ("/nodes/",              "GET /api/nodes/:id"),
    ("/search",              "GET /api/search"),
    ("/diverge/",            "GET /api/branches/:a/diverge/:b"),
    ("/pins",                "Pins endpoints"),
    ("/imports",             "Imports endpoints"),
    ("/health",              "Health check"),
]

for pattern, label in endpoint_patterns:
    test(f"Covers: {label}",
         pattern in source,
         f"'{pattern}' not found in source")

# Verify it tests CRUD lifecycle (create -> list -> delete)
test("Tests pin creation (POST)",
     'post(f"{api}/branches/' in source.lower() or "post(f\"{api}/branches/" in source)
test("Tests pin deletion (DELETE)",
     'delete(f"{api}/pins/' in source.lower() or "delete(f\"{api}/pins/" in source)
test("Tests 409 duplicate pin",
     "409" in source)
test("Tests 404 missing node",
     "404" in source and "00000000-0000-0000-0000-000000000000" in source)


# ═══════════════════════════════════════════════════════════════════════════════
#  10. REGEX PATTERN CORRECTNESS
# ═══════════════════════════════════════════════════════════════════════════════
section("10. Transcript Regex Pattern Validation")

pattern = r"^(User|Assistant|System):\s*"

# Matches at line start
test("Pattern matches 'User: hello'",
     bool(re.match(pattern, "User: hello")))
test("Pattern matches 'Assistant: hi'",
     bool(re.match(pattern, "Assistant: hi")))
test("Pattern matches 'System: prompt'",
     bool(re.match(pattern, "System: prompt")))

# Does NOT match mid-line
text = "some text User: not a role"
splits = re.split(pattern, text, flags=re.MULTILINE)
test("Does not split on mid-line 'User:'",
     len(splits) == 1,
     f"split into {len(splits)} parts")

# Captures role group correctly
match = re.match(pattern, "Assistant: hello world")
test("Captures role group 'Assistant'",
     match and match.group(1) == "Assistant")

# Handles extra whitespace after colon
match = re.match(pattern, "User:    lots of space")
test("Handles extra whitespace after colon",
     match is not None)


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
