# Phase 0 — Joint Setup (30 minutes)

Both developers work together. This phase locks in the 1x tier.

**Prerequisite files (already in the repo):**
- `docs/03_database_schema.md` — full PostgreSQL DDL in correct execution order
- `db/queries.sql` — all three core queries with comments
- `db/seed/data.json` — 715 lines of sample data (RecipeBox scenario)
- `db/seed/relations.md` — explains relationships in the sample data
- `db/schema.dbml` — schema for dbdiagram.io visualization

---

## Step 1: Create Supabase Project (5 min)

1. Go to [supabase.com](https://supabase.com), create a new project
2. Note the connection string: `postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres`
3. Create `.env` at repo root:
   ```
   DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
   ```
4. Verify: both devs can connect via `psql $DATABASE_URL`

## Step 2: Run DDL (5 min)

Run the full DDL from `docs/03_database_schema.md` in order:

```sql
-- Run in this exact order (deferred FKs require it):
-- 1. users
-- 2. conversations (without FKs to nodes/branches)
-- 3. nodes (without FK to branches)
-- 4. node_ancestry + trigger
-- 5. branches
-- 6. ALTER TABLE statements for deferred FKs
-- 7. context_pins, context_imports, node_summaries
-- 8. tags, node_tags, branch_shares
-- 9. All CREATE INDEX statements
```

Verify: `\dt` shows all 11 tables. `\df` shows `maintain_node_ancestry` function. `\di` shows all indexes.

## Step 3: Verify Trigger (5 min)

DEV-B runs this test:

```sql
-- Create test data
INSERT INTO users (id, email, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'test@test.com', 'Test');

INSERT INTO conversations (id, owner_id, title) VALUES
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Test Conv');

INSERT INTO branches (id, conversation_id, name, created_by) VALUES
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'main', '00000000-0000-0000-0000-000000000001');

-- Insert root node (no parent)
INSERT INTO nodes (id, conversation_id, parent_id, branch_id, node_type, role, content) VALUES
  ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', NULL, '00000000-0000-0000-0000-000000000020', 'message', 'system', 'You are a helpful assistant.');

-- Insert child node
INSERT INTO nodes (id, conversation_id, parent_id, branch_id, node_type, role, content) VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000020', 'message', 'user', 'Hello world');

-- Insert grandchild
INSERT INTO nodes (id, conversation_id, parent_id, branch_id, node_type, role, content) VALUES
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000020', 'message', 'assistant', 'Hi there!');

-- Verify closure table
SELECT ancestor_id, descendant_id, depth FROM node_ancestry ORDER BY descendant_id, depth;
```

**Expected output: 6 rows:**
| ancestor | descendant | depth |
|----------|-----------|-------|
| ...0100 | ...0100 | 0 |
| ...0101 | ...0101 | 0 |
| ...0100 | ...0101 | 1 |
| ...0102 | ...0102 | 0 |
| ...0101 | ...0102 | 1 |
| ...0100 | ...0102 | 2 |

**Branching test** — fork from node ...0101:

```sql
INSERT INTO nodes (id, conversation_id, parent_id, branch_id, node_type, role, content) VALUES
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000020', 'message', 'user', 'Branched message');

-- Node 103 should share ancestors 0100 and 0101 with node 0102, but NOT be an ancestor of 0102
SELECT * FROM node_ancestry WHERE descendant_id = '00000000-0000-0000-0000-000000000103' ORDER BY depth;
-- Expected: (0103,0103,0), (0101,0103,1), (0100,0103,2)
```

Clean up test data:
```sql
DELETE FROM node_ancestry;
DELETE FROM nodes;
DELETE FROM branches;
DELETE FROM conversations;
DELETE FROM users;
```

## Step 4: Load Seed Data (5 min)

Load `db/seed/data.json` into the database. Write a quick Python script or use `psql` with INSERT statements generated from the JSON.

**Note:** The seed data has UUIDs like `u-01`, `conv-01`, `br-01`, `n-01` which are not valid UUIDs. You'll need to either:
- (Option A) Map them to real UUIDs in a loading script
- (Option B) Change the PK types to VARCHAR for seed loading, then switch back (not recommended)
- (Option C) Write a `scripts/load_seed.py` that maps short IDs to deterministic UUIDs using `uuid5`

**Recommended: Option C.** Quick script:
```python
import uuid
NAMESPACE = uuid.UUID('12345678-1234-1234-1234-123456789abc')
def make_uuid(short_id: str) -> str:
    return str(uuid.uuid5(NAMESPACE, short_id))
```

## Step 5: Verify Queries (5 min)

Run each query from `db/queries.sql` against seed data:

**Query 1 (Context Assembly):**
- Use node `n-36` (summary node on feat/auth branch), budget = 5000
- Should return: the summary node + ancestors + any pinned nodes, within budget

**Query 2 (Branch Divergence):**
- Compare `feat/recipe-crud` and `feat/search` branches
- Should return: LCA at node `n-07` (schema finalized), nodes unique to each side

**Query 3 (Full-Text Search):**
- Search for `"recipe"` as user `u-01`
- Should return multiple nodes across recipe-related branches
- Run `EXPLAIN (ANALYZE, BUFFERS)` to confirm GIN index is used

Record the `EXPLAIN` output for the write-up.

## Step 6: Scaffold Repository (5 min)

**DEV-A creates:**

```bash
# Backend
cd backend/
python -m venv venv
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv
pip freeze > requirements.txt

# Create main.py with health check
# Create db.py with engine + session

# Frontend
cd ../
npm create vite@latest frontend -- --template react
cd frontend/
npm install
npm install -D tailwindcss @tailwindcss/vite
```

**DEV-A pushes scaffold, DEV-B pulls.** Sprint begins.
