# Domain Description

> **Goal of this document:** Provide enough context about the problem domain that someone who has never seen the project could reconstruct the database schema using only this description.

---

## The Domain: AI Agent Conversation Management

### What is this system for?

Graft manages conversation histories between humans and AI agents (like Claude, ChatGPT, or Copilot). The central idea is that a conversation is not a flat list of messages. It is a **tree** -- a directed acyclic graph (DAG) where messages can branch, be cherry-picked across branches, and be summarized to save space. Think of git, but for chat history instead of source code.

### Who uses it?

Developers who work with AI coding assistants in long, multi-session interactions. A developer might:
- Have a conversation that spans days or weeks.
- Want to try a risky idea without ruining their working thread.
- Want to reuse a solution from one conversation thread inside another.
- Need the AI to "remember" critical context (like a database schema) even as the conversation grows long.

---

## Core Domain Concepts

### Conversation

A conversation is the top-level container. It is owned by one user and has a title. It holds two things: a DAG of **nodes** and a set of **branches**.

Every conversation has a root node (the first message, typically a system prompt) and a default branch (typically called "main"). Both are set immediately after the conversation is created.

**To reconstruct the schema:** A conversation needs an owner (FK to users), a title, a pointer to its root node, a pointer to its default branch, and timestamps. The root_node and default_branch pointers are nullable because the conversation is created before those objects exist; they are backfilled right after.

---

### Node

A node is one unit of content in the conversation. The most common type is a **message** (what the user typed or what the AI responded), but nodes can also be **commits** (a checkpoint marker), **merges** (where two branches converge), or **summaries** (a condensed version of older nodes).

Every node belongs to exactly one conversation. Every node except the root has exactly one parent -- this parent-child relationship forms the DAG. When a user forks a branch, the new branch's first node has the same parent as the fork point, creating two children of the same parent.

Nodes that are messages have a **role**: `user`, `assistant`, or `system`. Nodes that are commits or merges have no role (null).

Each node stores its text content and a pre-computed **token count**. Token count is critical because the system must assemble context for the AI under a strict token budget. Summing token counts across candidate nodes determines what fits.

For search, each node also has a **full-text search vector** (`tsvector`), a PostgreSQL-native data structure generated automatically from the content column. This enables fast relevance-ranked search.

**To reconstruct the schema:** A node needs: conversation_id (FK), parent_id (self-referential FK, nullable for root), branch_id (FK to branches -- which branch authored it), node_type (enum-like string), role (nullable string), content (text), token_count (integer), content_tsv (generated tsvector), created_at. The tsvector column is a `GENERATED ALWAYS AS (to_tsvector('english', content)) STORED` column.

---

### Node Ancestry (Closure Table)

The tree structure of nodes (parent -> child -> grandchild) needs to be queried efficiently. The most frequent query in the system is "give me all ancestors of node X" -- this runs on every AI turn to assemble the conversation history.

A naive approach would use a recursive query (`WITH RECURSIVE`) that walks from X to the root one step at a time. This is O(depth) in query complexity and doesn't parallelize well.

Instead, the system pre-computes **all** ancestor-descendant pairs in a separate table. For every node X and every ancestor A of X (including X itself), there is one row storing `(ancestor=A, descendant=X, depth=distance)`. This is called a **closure table**.

With a closure table, "all ancestors of X" is a single `WHERE descendant_id = X` query -- one indexed lookup, O(1) complexity.

The closure table is maintained by a **trigger on the nodes table**. When a new node is inserted with parent P:
1. Copy all rows where `descendant_id = P`, increment their `depth` by 1, and change `descendant_id` to the new node.
2. Add one row `(new_node, new_node, 0)` for the self-referential entry.

**To reconstruct the schema:** The closure table has three columns: ancestor_id (FK to nodes), descendant_id (FK to nodes), depth (integer). The PK is (ancestor_id, descendant_id). There is a secondary index on (descendant_id, depth) for the "all ancestors of X" query. The table is never written to directly by the application; it is maintained entirely by a trigger.

---

### Branch

A branch is a named pointer to a node in the DAG. It does not "contain" nodes. It points at a **head** (the current latest node on the branch) and optionally a **base** (the node from which the branch was forked).

The root branch (usually called "main") has no base -- its `base_node_id` is null. Every other branch records its fork point. As new messages are added to a branch, the head pointer advances.

Branches can be **archived**. An archived branch is a soft-delete: its nodes remain in the DAG and can still be accessed via ancestry, but the branch is excluded from search results and active-branch listings.

Branch names are unique within a conversation but not globally. Two different conversations can both have a branch called "main".

**To reconstruct the schema:** A branch needs: conversation_id (FK), name (string), head_node_id (FK to nodes, nullable for fresh empty branches), base_node_id (FK to nodes, nullable only for the root branch), created_by (FK to users), is_archived (boolean), created_at. Unique constraint on (conversation_id, name).

---

### Context Pin

A pin says: "When assembling context on this branch, always include this node, regardless of whether it is an ancestor of the current head."

Pins have a **priority** (integer). During context assembly, pinned nodes are sorted by priority descending. When the token budget is tight, high-priority pins survive while low-priority ones may be dropped.

Users can attach a **reason** to a pin (e.g. "Core database schema -- always needed") for documentation.

A node can be pinned to many branches. A node can only be pinned once per branch (enforced by unique constraint on (branch_id, node_id)).

**To reconstruct the schema:** A pin needs: branch_id (FK), node_id (FK), pinned_by (FK to users), reason (nullable text), priority (smallint, default 0), created_at. Unique constraint on (branch_id, node_id). Index on (branch_id, priority) for ordered retrieval during context assembly.

---

### Context Import

An import is a cherry-pick: "Pull this node from another branch into my branch's context." The node is not copied; the import is a reference. During context assembly, imported nodes are included alongside ancestors and pins.

An import can optionally include the entire **subtree** rooted at the source node (`include_descendants = true`). When this flag is set, context assembly uses the closure table to expand the import to all descendants of the source node.

**To reconstruct the schema:** An import needs: target_branch_id (FK to branches), source_node_id (FK to nodes), include_descendants (boolean), imported_by (FK to users), imported_at (timestamp). Index on (target_branch_id, imported_at) for recent-imports listing. Index on source_node_id for reverse lookup.

---

### Node Summary

A summary node replaces a range of older nodes to save tokens. The summary itself is a regular node (with `node_type = 'summary'`). The mapping between a summary and the nodes it replaces is stored in a separate join table.

During context assembly, if a summary node appears in the candidate set, all nodes it summarizes are **elided** (excluded). This means the AI sees the concise summary instead of the verbose original messages.

One summary can replace many nodes (e.g. a 6-message conversation condensed into one paragraph). A node can only be summarized once (by one summary node).

**To reconstruct the schema:** The summary mapping table has two columns: summary_node_id (FK to nodes) and summarized_node_id (FK to nodes). PK is (summary_node_id, summarized_node_id). Index on summarized_node_id for the elision lookup during context assembly.

---

### Tag

A reusable label for categorizing nodes by concern (e.g. "schema-design", "api-endpoint", "security", "architecture-decision"). Tags are global (not scoped to a conversation).

**To reconstruct the schema:** Tags table: id (UUID PK), name (unique, varchar). Junction table node_tags: (node_id FK, tag_id FK), PK on both columns.

---

### Branch Share

A permission grant allowing another user (or the public) to access a branch. Permission levels are `view` (read-only), `fork` (create a branch based on this one), and `comment` (view plus add comments).

Setting `shared_with` to null means the branch is public (anyone can access it with the specified permission).

**To reconstruct the schema:** A share needs: branch_id (FK), shared_with (FK to users, nullable for public), permission (string enum), created_at. Unique constraint on (branch_id, shared_with).

---

## Key Domain Rules

These invariants must be enforced by the schema:

1. **Every node has exactly one parent**, except the root node (parent_id is null).
2. **Branch names are unique per conversation**, not globally.
3. **A node can only be pinned once per branch** (duplicate pins are prevented).
4. **Closure table depth is always non-negative** and depth 0 always means "self."
5. **The closure table is never written to directly** -- it is maintained exclusively by the trigger on the nodes table.
6. **One review per user per branch share** -- a branch can only be shared with a given user once.
7. **Archived branches are excluded from search** but their nodes remain in the DAG.
8. **Summary elision only occurs when the summary node is itself a candidate** -- if the summary is outside the current context window, the original nodes are kept.

---

## The Three Operations the Database Must Support Efficiently

### 1. Context Assembly (the hot path)

On every agent turn, the system must assemble the context window for the AI. Given the current node and a token budget, it must:
- Find all ancestors of the current node (via closure table).
- Add all nodes pinned to the current branch (ordered by priority).
- Add all nodes imported into the current branch (with optional descendant expansion).
- Exclude nodes that have been summarized by a summary node also in the set.
- Rank the remaining candidates: pinned (by priority), then ancestors (closest first), then imports, then by recency.
- Truncate at the token budget using a cumulative sum.

This query touches: nodes, node_ancestry, context_pins, context_imports, node_summaries, branches.

### 2. Branch Divergence

Given two branches, find where they diverged and what is unique to each side. This requires:
- Finding the ancestor set of each branch's head (via closure table).
- Computing the intersection to find common ancestors.
- Selecting the lowest common ancestor (smallest max-depth in both sets).
- Computing set differences to find nodes exclusive to each branch.

This query touches: branches, node_ancestry.

### 3. Full-Text Search

Given a natural-language query, find the most relevant nodes across all of a user's conversations. This requires:
- Converting the query to a tsquery (supporting OR, exclusion, exact phrases).
- Matching against the pre-computed tsvector on each node via GIN index.
- Filtering to non-archived branches and the user's own conversations.
- Ranking by relevance score, breaking ties by recency.

This query touches: nodes, branches, conversations.

---

## Domain Glossary

| Term | Meaning |
|------|---------|
| DAG | Directed acyclic graph -- the tree structure of nodes in a conversation |
| Head | The latest (leaf) node on a branch |
| Base / Fork point | The node from which a branch was created |
| Closure table | A pre-computed table of all ancestor-descendant pairs for fast lookups |
| Pin | A marker that forces a node into context assembly on a branch |
| Import / Cherry-pick | A reference that includes a node from another branch into the current branch's context |
| Elision | Excluding original nodes from context when a summary node is present |
| Token budget | The maximum number of LLM tokens that can be assembled for one AI turn |
| tsvector | PostgreSQL's native full-text search data structure |
| LCA | Lowest common ancestor -- the most recent shared node between two branches |
