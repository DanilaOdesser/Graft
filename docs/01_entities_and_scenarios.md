# Entities and Critical Scenarios

## 1. Entities

Graft has 11 entities organized into four layers: core structure, DAG maintenance, cross-branch context, and social/organization.

---

### Core Structure

#### User

A person who owns conversations and performs actions (creating branches, pinning nodes, importing context, sharing).

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Login credential |
| display_name | VARCHAR(100) | NOT NULL | Shown in UI |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | Account creation time |

A user can own many conversations. A user is referenced by branches (created_by), pins (pinned_by), imports (imported_by), and shares (shared_with).

---

#### Conversation

A top-level workspace that contains a DAG of nodes and a set of branches. Analogous to a git repository.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| owner_id | UUID | NOT NULL, FK -> users | Who owns this conversation |
| title | VARCHAR(200) | NOT NULL | Human-readable name |
| root_node_id | UUID | FK -> nodes, nullable | First node in the DAG (set after creation) |
| default_branch_id | UUID | FK -> branches, nullable | The "main" branch (set after creation) |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | Creation time |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() | Last activity time |

`root_node_id` and `default_branch_id` are nullable because the conversation is created before its first node and branch exist. They are backfilled immediately after.

---

#### Node

The atomic unit of the conversation DAG. Every message, commit, merge marker, or summary is a node.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| conversation_id | UUID | NOT NULL, FK -> conversations | Which conversation this belongs to |
| parent_id | UUID | FK -> nodes, nullable | Parent in the DAG (null only for root) |
| branch_id | UUID | NOT NULL, FK -> branches | Which branch this node was authored on |
| node_type | VARCHAR(20) | NOT NULL | One of: `message`, `commit`, `merge`, `summary` |
| role | VARCHAR(20) | Nullable | One of: `user`, `assistant`, `system`, or null (for commits/merges) |
| content | TEXT | NOT NULL | The actual message text or summary text |
| token_count | INT | NOT NULL, default 0 | Pre-computed LLM token count for budget math |
| content_tsv | TSVECTOR | Generated | Full-text search vector, auto-derived from content |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | When this node was created |

**Key design decisions:**
- `parent_id` creates a tree (singly-linked toward root). Multiple children of the same parent is how branches fork.
- `branch_id` records *authorship*, not ownership. A node authored on "main" remains on "main" even if another branch includes it via ancestry or import.
- `token_count` is stored, not computed on read, because context assembly needs to sum tokens across dozens of nodes per query and recalculating each time is wasteful.
- `content_tsv` is a PostgreSQL generated column (`GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`) so full-text search is always up to date without application-level triggers.

---

#### Branch

A named pointer into the node DAG, analogous to a git branch. A branch does not "contain" nodes; it points at a leaf node (the head), and nodes between the head and the fork point (the base) are considered "on" that branch.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| conversation_id | UUID | NOT NULL, FK -> conversations | Which conversation |
| name | VARCHAR(100) | NOT NULL | Branch name (unique per conversation) |
| head_node_id | UUID | FK -> nodes, nullable | Current leaf node (null for fresh empty branch) |
| base_node_id | UUID | FK -> nodes, nullable | Fork point (null for root branch) |
| created_by | UUID | NOT NULL, FK -> users | Who created the branch |
| is_archived | boolean | NOT NULL, default false | Soft-delete flag |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | When the branch was created |

**Key design decisions:**
- `base_node_id` is null only for the root branch ("main"). All other branches record where they forked from, enabling divergence comparisons.
- `is_archived` is a soft-delete. Archived branches are excluded from search results (Query 3) and active-branch listings, but their nodes remain in the DAG and can still be found via ancestry.
- Branch names are unique per conversation (enforced by a composite unique constraint), not globally.

---

### DAG Maintenance

#### Node Ancestry (Closure Table)

A materialized representation of all ancestor-descendant relationships in the node tree. For every pair of nodes where A is an ancestor of B (including B itself), there is one row.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| ancestor_id | UUID | NOT NULL, FK -> nodes | The ancestor node |
| descendant_id | UUID | NOT NULL, FK -> nodes | The descendant node |
| depth | INT | NOT NULL | Tree distance (0 = self, 1 = parent, 2 = grandparent, ...) |

**PK:** (ancestor_id, descendant_id)

**Why a closure table instead of recursive CTEs?**
- Context assembly (Query 1) runs on every agent turn. It must find all ancestors of a node. With a closure table, this is a single indexed join: `WHERE descendant_id = :node_id`. A recursive CTE would walk the tree one level at a time, which becomes expensive for deep DAGs.
- The closure table is maintained by an `AFTER INSERT` trigger on the `nodes` table. When a new node is inserted with parent P, the trigger copies all of P's ancestor rows (incrementing depth by 1) and adds a self-referential row (depth 0).

---

### Cross-Branch Context

#### Context Pin

A user-created marker that says "always include this node in context when I'm on this branch." The node does not need to be an ancestor of the branch head.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| branch_id | UUID | NOT NULL, FK -> branches | Which branch the pin is on |
| node_id | UUID | NOT NULL, FK -> nodes | Which node to always include |
| pinned_by | UUID | NOT NULL, FK -> users | Who pinned it |
| reason | TEXT | Nullable | Optional note explaining why this was pinned |
| priority | SMALLINT | NOT NULL, default 0 | Higher = include first under budget pressure |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | When the pin was created |

**Unique constraint:** (branch_id, node_id) -- a node can only be pinned once per branch.

Pins are how users control what the LLM always sees. A common pattern is pinning a schema definition or architectural decision that every future message needs to reference.

---

#### Context Import

A cherry-pick of a node (or subtree) from one branch into another branch's context. Unlike git cherry-pick, this does not copy nodes; it creates a reference that the context assembly query includes.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| target_branch_id | UUID | NOT NULL, FK -> branches | The branch receiving the import |
| source_node_id | UUID | NOT NULL, FK -> nodes | The node being imported |
| include_descendants | BOOLEAN | NOT NULL, default false | If true, import the entire subtree rooted at source_node_id |
| imported_by | UUID | NOT NULL, FK -> users | Who performed the import |
| imported_at | TIMESTAMPTZ | NOT NULL, default now() | When the import happened |

When `include_descendants = true`, the context assembly query uses the closure table to expand the import to all descendants of the source node.

---

#### Node Summary

A mapping from a summary node to the original nodes it replaces. During context assembly, if a summary node is in the candidate set, the nodes it summarizes are excluded (elided) to save tokens.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| summary_node_id | UUID | NOT NULL, FK -> nodes | The summary node |
| summarized_node_id | UUID | NOT NULL, FK -> nodes | An original node being replaced |

**PK:** (summary_node_id, summarized_node_id)

One summary node can replace many original nodes (one-to-many). This table is a pure join table with no extra attributes.

---

### Social / Organization

#### Tag

A reusable label for organizing nodes by topic or concern.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| name | VARCHAR(50) | UNIQUE, NOT NULL | Tag text (e.g. "schema-design", "security") |

#### Node Tag (junction)

Many-to-many relationship between nodes and tags.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| node_id | UUID | NOT NULL, FK -> nodes | The tagged node |
| tag_id | UUID | NOT NULL, FK -> tags | The tag |

**PK:** (node_id, tag_id)

#### Branch Share

Grants another user (or the public) access to a branch with a specific permission level.

| Attribute | Type | Constraints | Purpose |
|-----------|------|-------------|---------|
| id | UUID | PK | Unique identifier |
| branch_id | UUID | NOT NULL, FK -> branches | The shared branch |
| shared_with | UUID | FK -> users, nullable | The recipient (null = public/anyone) |
| permission | VARCHAR(20) | NOT NULL | One of: `view`, `fork`, `comment` |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | When the share was created |

**Unique constraint:** (branch_id, shared_with) -- a branch can only be shared once per recipient.

---

## 2. Critical Scenarios (Common User Paths)

These are the core workflows that drive Graft's value. Each scenario maps to specific tables and queries.

---

### Scenario 1: Start a conversation and send messages

**Actor:** User
**Trigger:** User begins a new AI coding session.
**Flow:**

1. System creates a **conversation** with the user as `owner_id`.
2. System creates a **branch** named `main` with `base_node_id = null` (root branch).
3. Conversation's `default_branch_id` is set to this branch.
4. System creates the first **node** (the system prompt, `role = 'system'`, `parent_id = null`).
5. Conversation's `root_node_id` is set to this node. Branch `head_node_id` is set to this node.
6. The closure-table trigger inserts `(node, node, 0)` into **node_ancestry**.
7. User sends a message: a new **node** is created with `parent_id` pointing to the current head, `role = 'user'`.
8. The trigger populates node_ancestry with all ancestor pairs for the new node.
9. Branch `head_node_id` advances to the new node.
10. **Context assembly (Query 1)** runs: gather all ancestors of the new node + any pins + any imports, rank, truncate to token budget, send to LLM.
11. LLM response is persisted as another new **node** (`role = 'assistant'`). Branch head advances again.

**Tables touched:** users, conversations, branches, nodes, node_ancestry
**Queries used:** Query 1 (context assembly)

---

### Scenario 2: Branch off to explore an idea

**Actor:** User
**Trigger:** User wants to try a speculative approach without polluting the main thread.
**Flow:**

1. User picks a node on `main` (the fork point) and creates a new **branch** (e.g. `spike/try-redis`).
2. The new branch's `base_node_id` = the chosen fork point. `head_node_id` = same node initially.
3. User sends messages on the new branch. New **nodes** are created with `branch_id` pointing to the new branch. Each node's `parent_id` chains from the previous message.
4. Node ancestry is maintained as before -- the new nodes' ancestors include everything back through the fork point to the root.
5. Context assembly on the new branch includes the full ancestor chain (shared history from main + new messages on the spike branch).

**If the spike succeeds:** User continues building on it, or merges insights back to main via imports.
**If the spike fails:** User archives the branch (`is_archived = true`). The nodes remain but are excluded from search results.

**Tables touched:** branches, nodes, node_ancestry
**Queries used:** Query 1 (context assembly on the new branch)

---

### Scenario 3: Pin critical context to a branch

**Actor:** User
**Trigger:** A node contains information (e.g. a schema definition) that should always be in the LLM's context window on a specific branch.
**Flow:**

1. User selects a node and a target branch.
2. System creates a **context_pin** with the chosen `priority` (higher = survives tighter budgets).
3. On the next context assembly, the pinned node appears in the candidate set with source = `pinned`. Pinned nodes rank above ancestors and imports of equal depth.
4. User can add a `reason` (e.g. "Core DB schema -- always needed") for their own documentation.

**Example:** The database schema node is pinned with priority 10 on every feature branch. Even when the branch grows long and older ancestors fall off the token budget, the schema stays.

**Tables touched:** context_pins
**Queries used:** Query 1 (the pinned_nodes CTE)

---

### Scenario 4: Cherry-pick context from another branch

**Actor:** User
**Trigger:** User is working on branch B and needs context from branch A that is not in their ancestor chain.
**Flow:**

1. User finds the relevant node on branch A (either by browsing or via search -- Scenario 6).
2. User creates a **context_import** targeting branch B, referencing the source node.
3. User chooses whether to `include_descendants` (pull the entire sub-conversation) or just the single node.
4. On the next context assembly for branch B, the imported node(s) appear in the candidate set with source = `imported`.

**Example:** The search feature branch imports the recipe CRUD endpoint definition from the recipe-crud branch. The search implementation needs to know the Pydantic models to return correctly-shaped results, but those models were built on a different branch.

**Tables touched:** context_imports, node_ancestry (for descendant expansion)
**Queries used:** Query 1 (the imported_nodes CTE)

---

### Scenario 5: Summarize old context to save tokens

**Actor:** User (manual in v1, automated in v2)
**Trigger:** A branch has grown long. Old messages are eating token budget but the details are no longer needed -- only the conclusions matter.
**Flow:**

1. User writes (or pastes) a summary of a range of old nodes.
2. System creates a new **node** with `node_type = 'summary'` and `role = 'system'`.
3. System creates **node_summary** rows linking the summary node to each original node it replaces.
4. On the next context assembly, the `elided` CTE finds original nodes that have a summary in the candidate set. Those originals are excluded. The summary takes their place.

**Example:** A 6-message authentication session (1,645 tokens) is summarized into a single 180-token node. That is an 89% token savings while preserving all the important decisions and outcomes.

**Tables touched:** nodes, node_summaries
**Queries used:** Query 1 (the elided CTE)

---

### Scenario 6: Search across all conversations

**Actor:** User
**Trigger:** User remembers solving a problem in a past conversation and wants to find it.
**Flow:**

1. User types a natural-language query (e.g. `"cursor pagination" -offset`).
2. **Query 3** runs: `websearch_to_tsquery` converts the input to a tsquery, the GIN index on `content_tsv` finds matching nodes, results are ranked by `ts_rank` relevance and filtered to non-archived branches owned by the user.
3. Each result shows the node content, its branch name, and its conversation title.
4. User can then cherry-pick a result into their current branch (feeding into Scenario 4).

**Tables touched:** nodes, branches, conversations
**Queries used:** Query 3 (full-text search)

---

### Scenario 7: Compare branches before merging

**Actor:** User
**Trigger:** User has two branches and wants to understand how they diverge before deciding to merge.
**Flow:**

1. User selects two branches (A and B).
2. **Query 2** runs: computes the ancestor sets of both branch heads via the closure table, finds their lowest common ancestor (LCA), and returns the nodes exclusive to each side.
3. The result shows:
   - The LCA node (the last point of shared history)
   - How many nodes are unique to A and unique to B
   - The actual node IDs on each side
4. User reviews the divergence to check for conflicts (e.g. contradictory schema changes) and decides whether to merge.

**Tables touched:** branches, node_ancestry
**Queries used:** Query 2 (branch divergence)

---

### Scenario 8: Share a branch with a teammate

**Actor:** User
**Trigger:** User wants a second opinion on a branch or wants to let a teammate fork it.
**Flow:**

1. User creates a **branch_share** specifying the branch, recipient (or null for public), and permission level.
2. Permission levels:
   - `view`: recipient can read the branch and its nodes but not modify anything.
   - `fork`: recipient can create their own branch based on this one.
   - `comment`: recipient can view and add comments (future feature).
3. Recipient accesses the branch according to their permission level.

**Tables touched:** branch_shares
**Queries used:** Permission-checking queries (not one of the three core queries, but a simple lookup)

---

## 3. Scenario-to-Entity Matrix

| Scenario | users | conversations | nodes | node_ancestry | branches | context_pins | context_imports | node_summaries | tags/node_tags | branch_shares |
|----------|:-----:|:------------:|:-----:|:-------------:|:--------:|:------------:|:--------------:|:--------------:|:--------------:|:-------------:|
| 1. Send messages | R | RW | W | W (trigger) | RW | - | - | - | - | - |
| 2. Branch off | - | - | W | W (trigger) | W | - | - | - | - | - |
| 3. Pin context | - | - | R | - | R | W | - | - | - | - |
| 4. Cherry-pick | - | - | R | R | R | - | W | - | - | - |
| 5. Summarize | - | - | W | W (trigger) | - | - | - | W | - | - |
| 6. Search | R | R | R | - | R | - | - | - | - | - |
| 7. Compare branches | - | - | - | R | R | - | - | - | - | - |
| 8. Share branch | - | - | - | - | R | - | - | - | - | W |

R = read, W = write, RW = both, `-` = not involved
