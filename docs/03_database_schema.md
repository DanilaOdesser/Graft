# Database Schema -- SQL DDL and DBML

This document contains the full database schema in two formats:
1. **PostgreSQL DDL** -- executable SQL that creates all tables, indexes, constraints, and triggers.
2. **DBML** -- the schema description language used by [dbdiagram.io](https://dbdiagram.io/d) for visualization.

---

## PostgreSQL DDL

### Users and Workspaces

```sql
-- ============================================================================
-- USERS
-- ============================================================================

CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    display_name    VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per person. Referenced by conversations (owner), branches (creator),
-- pins (pinned_by), imports (imported_by), and shares (shared_with).
```

```sql
-- ============================================================================
-- CONVERSATIONS
-- ============================================================================

CREATE TABLE conversations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id            UUID        NOT NULL REFERENCES users(id),
    title               VARCHAR(200) NOT NULL,
    root_node_id        UUID,       -- set after first node is inserted
    default_branch_id   UUID,       -- set after "main" branch is created
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- root_node_id and default_branch_id are nullable because the conversation
-- is created before its first node and branch exist. They are backfilled
-- immediately after creation.

CREATE INDEX idx_conv_owner        ON conversations(owner_id);
CREATE INDEX idx_conv_owner_recent ON conversations(owner_id, updated_at DESC);

-- idx_conv_owner_recent: supports "list my most recent conversations" sorted
-- by last activity. The DESC ordering means Postgres can scan the index
-- backwards for a top-N query without a sort step.
```

### The DAG: Nodes

```sql
-- ============================================================================
-- NODES
-- ============================================================================
-- The atomic unit of conversation content. Every message, commit, merge, or
-- summary is a node. The parent_id chain forms a tree (DAG).

CREATE TABLE nodes (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL REFERENCES conversations(id),
    parent_id       UUID        REFERENCES nodes(id),       -- null only for root
    branch_id       UUID        NOT NULL,                    -- FK added after branches table
    node_type       VARCHAR(20) NOT NULL
                    CHECK (node_type IN ('message', 'commit', 'merge', 'summary')),
    role            VARCHAR(20)
                    CHECK (role IN ('user', 'assistant', 'system') OR role IS NULL),
    content         TEXT        NOT NULL,
    token_count     INT         NOT NULL DEFAULT 0,
    content_tsv     TSVECTOR    GENERATED ALWAYS AS (
                        to_tsvector('english', content)
                    ) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- content_tsv: a generated column. PostgreSQL automatically recomputes the
-- tsvector whenever content changes. No application-level trigger needed.
-- The 'english' dictionary handles stemming (e.g. "running" -> "run").

CREATE INDEX idx_nodes_conv          ON nodes(conversation_id);
CREATE INDEX idx_nodes_parent        ON nodes(parent_id);
CREATE INDEX idx_nodes_branch        ON nodes(branch_id);
CREATE INDEX idx_nodes_conv_recent   ON nodes(conversation_id, created_at DESC);
CREATE INDEX idx_nodes_content_tsv   ON nodes USING gin(content_tsv);

-- idx_nodes_conv_recent: supports "show recent messages in this conversation."
-- idx_nodes_content_tsv: GIN index for full-text search (Query 3). GIN
--   (Generalized Inverted Index) maps each lexeme to the set of rows
--   containing it, making @@ matching O(log n) instead of a full scan.
```

### Closure Table: Node Ancestry

```sql
-- ============================================================================
-- NODE_ANCESTRY (closure table)
-- ============================================================================
-- Pre-computed ancestor-descendant pairs. For every node X and every ancestor A
-- of X (including X itself), one row: (ancestor=A, descendant=X, depth=distance).
--
-- This table is NEVER written to by the application. It is maintained entirely
-- by the trigger below.

CREATE TABLE node_ancestry (
    ancestor_id     UUID    NOT NULL REFERENCES nodes(id),
    descendant_id   UUID    NOT NULL REFERENCES nodes(id),
    depth           INT     NOT NULL CHECK (depth >= 0),

    PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX idx_ancestry_desc_depth ON node_ancestry(descendant_id, depth);

-- idx_ancestry_desc_depth: the primary access pattern is "all ancestors of X"
-- (WHERE descendant_id = X). The depth column in the index lets the planner
-- do an index-only scan when only depth is needed (e.g. for LCA computation).
```

```sql
-- ============================================================================
-- CLOSURE TABLE MAINTENANCE TRIGGER
-- ============================================================================
-- Fires after every INSERT on nodes. Populates node_ancestry for the new node
-- by copying the parent's ancestor rows (incrementing depth) + adding self.

CREATE OR REPLACE FUNCTION maintain_node_ancestry()
RETURNS TRIGGER AS $$
BEGIN
    -- Self-referential row: every node is its own ancestor at depth 0.
    INSERT INTO node_ancestry (ancestor_id, descendant_id, depth)
    VALUES (NEW.id, NEW.id, 0);

    -- If the node has a parent, copy all of the parent's ancestors
    -- and increment their depth by 1.
    IF NEW.parent_id IS NOT NULL THEN
        INSERT INTO node_ancestry (ancestor_id, descendant_id, depth)
        SELECT na.ancestor_id, NEW.id, na.depth + 1
        FROM node_ancestry na
        WHERE na.descendant_id = NEW.parent_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_node_ancestry
    AFTER INSERT ON nodes
    FOR EACH ROW
    EXECUTE FUNCTION maintain_node_ancestry();

-- Example: inserting node C with parent B (whose ancestors are A->B):
--   Before: (A,A,0), (A,B,1), (B,B,0)
--   Trigger inserts: (C,C,0), (A,C,2), (B,C,1)
--   After:  (A,A,0), (A,B,1), (B,B,0), (C,C,0), (B,C,1), (A,C,2)
```

### Branches

```sql
-- ============================================================================
-- BRANCHES
-- ============================================================================
-- Named pointers into the node DAG. A branch does not "contain" nodes; it
-- points at a head (current leaf) and a base (fork point).

CREATE TABLE branches (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL REFERENCES conversations(id),
    name            VARCHAR(100) NOT NULL,
    head_node_id    UUID        REFERENCES nodes(id),    -- null for fresh empty branch
    base_node_id    UUID        REFERENCES nodes(id),    -- null for root branch only
    created_by      UUID        NOT NULL REFERENCES users(id),
    is_archived     BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now add the deferred FK from nodes.branch_id -> branches.id
ALTER TABLE nodes
    ADD CONSTRAINT fk_nodes_branch
    FOREIGN KEY (branch_id) REFERENCES branches(id);

-- Add deferred FKs from conversations to branches and nodes
ALTER TABLE conversations
    ADD CONSTRAINT fk_conv_root_node
    FOREIGN KEY (root_node_id) REFERENCES nodes(id);

ALTER TABLE conversations
    ADD CONSTRAINT fk_conv_default_branch
    FOREIGN KEY (default_branch_id) REFERENCES branches(id);

CREATE UNIQUE INDEX uniq_branch_name_per_conv
    ON branches(conversation_id, name);

CREATE INDEX idx_branch_head     ON branches(head_node_id);
CREATE INDEX idx_branch_base     ON branches(base_node_id);
CREATE INDEX idx_branch_active   ON branches(conversation_id)
    WHERE is_archived = false;

-- uniq_branch_name_per_conv: branch names are unique within a conversation,
--   not globally. Two conversations can both have a "main" branch.
-- idx_branch_active: a partial index that only includes non-archived branches.
--   Queries that filter on is_archived = false use this smaller index instead
--   of scanning the full table. Particularly useful for Query 3 (FTS search).
```

### Cross-Branch Context Features

```sql
-- ============================================================================
-- CONTEXT_PINS
-- ============================================================================
-- "Always include this node in context when assembling on this branch."
-- The node does not need to be an ancestor of the branch head.

CREATE TABLE context_pins (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id   UUID        NOT NULL REFERENCES branches(id),
    node_id     UUID        NOT NULL REFERENCES nodes(id),
    pinned_by   UUID        NOT NULL REFERENCES users(id),
    reason      TEXT,                       -- optional: "Core schema - always needed"
    priority    SMALLINT    NOT NULL DEFAULT 0,  -- higher = include first
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (branch_id, node_id)
);

CREATE INDEX idx_pins_branch_priority
    ON context_pins(branch_id, priority DESC);

-- idx_pins_branch_priority: context assembly fetches all pins for a branch
-- ordered by priority descending. This index gives an ordered scan with no
-- sort step.
```

```sql
-- ============================================================================
-- CONTEXT_IMPORTS
-- ============================================================================
-- Cherry-pick a node (or subtree) from another branch into this branch's context.
-- This is a reference, not a copy. The original node stays where it is.

CREATE TABLE context_imports (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_branch_id    UUID        NOT NULL REFERENCES branches(id),
    source_node_id      UUID        NOT NULL REFERENCES nodes(id),
    include_descendants BOOLEAN     NOT NULL DEFAULT false,
    imported_by         UUID        NOT NULL REFERENCES users(id),
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_imports_target_recent
    ON context_imports(target_branch_id, imported_at DESC);
CREATE INDEX idx_imports_source
    ON context_imports(source_node_id);

-- idx_imports_target_recent: "all imports on this branch, newest first."
-- idx_imports_source: reverse lookup — "which branches imported this node?"
```

### Summarization

```sql
-- ============================================================================
-- NODE_SUMMARIES
-- ============================================================================
-- Maps a summary node to the original nodes it replaces in context.
-- During context assembly, if the summary is a candidate, the originals
-- are elided (excluded).

CREATE TABLE node_summaries (
    summary_node_id     UUID    NOT NULL REFERENCES nodes(id),
    summarized_node_id  UUID    NOT NULL REFERENCES nodes(id),

    PRIMARY KEY (summary_node_id, summarized_node_id)
);

CREATE INDEX idx_summaries_original ON node_summaries(summarized_node_id);

-- idx_summaries_original: used by the elision CTE in Query 1 to quickly
-- check "is this node summarized by something in my candidate set?"
```

### Tags and Social Layer

```sql
-- ============================================================================
-- TAGS
-- ============================================================================

CREATE TABLE tags (
    id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name    VARCHAR(50) UNIQUE NOT NULL
);

-- ============================================================================
-- NODE_TAGS (junction table)
-- ============================================================================

CREATE TABLE node_tags (
    node_id UUID    NOT NULL REFERENCES nodes(id),
    tag_id  UUID    NOT NULL REFERENCES tags(id),

    PRIMARY KEY (node_id, tag_id)
);

CREATE INDEX idx_node_tags_tag ON node_tags(tag_id);

-- idx_node_tags_tag: supports "find all nodes with tag X" (reverse lookup).
-- The PK already covers "find all tags for node Y."
```

```sql
-- ============================================================================
-- BRANCH_SHARES
-- ============================================================================

CREATE TABLE branch_shares (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_id   UUID        NOT NULL REFERENCES branches(id),
    shared_with UUID        REFERENCES users(id),   -- null = public
    permission  VARCHAR(20) NOT NULL
                CHECK (permission IN ('view', 'fork', 'comment')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (branch_id, shared_with)
);

-- UNIQUE (branch_id, shared_with): a branch can be shared with a given user
-- at most once. Note: PostgreSQL treats NULLs as distinct in unique constraints,
-- so multiple "public" shares (shared_with = NULL) on the same branch are allowed.
-- In practice the application enforces at most one public share per branch.
```

---

## Index Summary

| Index | Table | Columns | Type | Justifies |
|-------|-------|---------|------|-----------|
| PK (ancestor_id, descendant_id) | node_ancestry | ancestor_id, descendant_id | B-tree | Closure table lookups in all three queries |
| idx_ancestry_desc_depth | node_ancestry | descendant_id, depth | B-tree | "All ancestors of X" (Query 1), LCA computation (Query 2) |
| idx_nodes_content_tsv | nodes | content_tsv | GIN | Full-text search matching (Query 3) |
| idx_nodes_conv_recent | nodes | conversation_id, created_at DESC | B-tree | Recent messages in a conversation |
| idx_pins_branch_priority | context_pins | branch_id, priority DESC | B-tree | Ordered pin retrieval during context assembly (Query 1) |
| idx_imports_target_recent | context_imports | target_branch_id, imported_at DESC | B-tree | Import listing during context assembly (Query 1) |
| idx_branch_active | branches | conversation_id (WHERE is_archived=false) | Partial B-tree | Active-branch filtering (Query 3) |
| idx_conv_owner_recent | conversations | owner_id, updated_at DESC | B-tree | "My recent conversations" listing |
| uniq_branch_name_per_conv | branches | conversation_id, name | B-tree (unique) | Enforce unique branch names per conversation |
| idx_summaries_original | node_summaries | summarized_node_id | B-tree | Elision check during context assembly (Query 1) |

---

## DBML (for dbdiagram.io)

The following DBML can be pasted directly into [dbdiagram.io](https://dbdiagram.io/d) to generate a visual schema diagram.

```dbml
// =============================================================================
// Agent Context Management DB
// "Git for agent conversations" - branchable chats with cross-branch context
// =============================================================================

// ---------- Users & workspaces ----------

Table users {
  id uuid [pk]
  email varchar(255) [unique, not null]
  display_name varchar(100) [not null]
  created_at timestamptz [not null, default: `now()`]
}

Table conversations {
  id uuid [pk]
  owner_id uuid [not null, ref: > users.id]
  title varchar(200) [not null]
  root_node_id uuid           // set after first node is created
  default_branch_id uuid      // typically the "main" branch
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  Indexes {
    owner_id
    (owner_id, updated_at) [name: 'idx_conv_owner_recent']
  }
}

// ---------- The DAG: nodes are the unit of conversation history ----------

Table nodes {
  id uuid [pk]
  conversation_id uuid [not null, ref: > conversations.id]
  parent_id uuid [ref: > nodes.id]   // null only for the root node
  branch_id uuid [not null, ref: > branches.id]  // which branch this node was authored on
  node_type varchar(20) [not null]   // 'message' | 'commit' | 'merge' | 'summary'
  role varchar(20)                   // 'user' | 'assistant' | 'system' | null for commits
  content text [not null]
  token_count int [not null, default: 0]
  // Generated column in DDL:
  //   tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
  content_tsv tsvector
  created_at timestamptz [not null, default: `now()`]

  Indexes {
    conversation_id
    parent_id
    branch_id
    (conversation_id, created_at) [name: 'idx_nodes_conv_recent']
    content_tsv [type: gin, name: 'idx_nodes_content_tsv']
  }
}

// Closure table: one row per (ancestor, descendant) pair, including self.
// Lets ancestry checks be a single indexed join instead of recursive walks.
Table node_ancestry {
  ancestor_id uuid [not null, ref: > nodes.id]
  descendant_id uuid [not null, ref: > nodes.id]
  depth int [not null]   // 0 = self, 1 = direct parent, etc.

  Indexes {
    (ancestor_id, descendant_id) [pk]
    (descendant_id, depth) [name: 'idx_ancestry_desc_depth']
  }
}

// ---------- Branches: named pointers into the DAG ----------

Table branches {
  id uuid [pk]
  conversation_id uuid [not null, ref: > conversations.id]
  name varchar(100) [not null]
  head_node_id uuid [ref: > nodes.id]    // current leaf; null for a fresh empty branch
  base_node_id uuid [ref: > nodes.id]    // fork point; null for the root branch
  created_by uuid [not null, ref: > users.id]
  is_archived boolean [not null, default: false]
  created_at timestamptz [not null, default: `now()`]

  Indexes {
    (conversation_id, name) [unique, name: 'uniq_branch_name_per_conv']
    head_node_id
    base_node_id
    (conversation_id, is_archived) [name: 'idx_branch_active']
  }
}

// ---------- Cross-branch context features ----------

Table context_pins {
  id uuid [pk]
  branch_id uuid [not null, ref: > branches.id]
  node_id uuid [not null, ref: > nodes.id]
  pinned_by uuid [not null, ref: > users.id]
  reason text
  priority smallint [not null, default: 0]
  created_at timestamptz [not null, default: `now()`]

  Indexes {
    (branch_id, node_id) [unique]
    (branch_id, priority) [name: 'idx_pins_branch_priority']
  }
}

Table context_imports {
  id uuid [pk]
  target_branch_id uuid [not null, ref: > branches.id]
  source_node_id uuid [not null, ref: > nodes.id]
  include_descendants boolean [not null, default: false]
  imported_by uuid [not null, ref: > users.id]
  imported_at timestamptz [not null, default: `now()`]

  Indexes {
    (target_branch_id, imported_at) [name: 'idx_imports_target_recent']
    source_node_id
  }
}

// ---------- Summarization ----------

Table node_summaries {
  summary_node_id uuid [not null, ref: > nodes.id]
  summarized_node_id uuid [not null, ref: > nodes.id]

  Indexes {
    (summary_node_id, summarized_node_id) [pk]
    summarized_node_id
  }
}

// ---------- Tags & social layer ----------

Table tags {
  id uuid [pk]
  name varchar(50) [unique, not null]
}

Table node_tags {
  node_id uuid [not null, ref: > nodes.id]
  tag_id uuid [not null, ref: > tags.id]

  Indexes {
    (node_id, tag_id) [pk]
    tag_id
  }
}

Table branch_shares {
  id uuid [pk]
  branch_id uuid [not null, ref: > branches.id]
  shared_with uuid [ref: > users.id]   // null = public
  permission varchar(20) [not null]     // 'view' | 'fork' | 'comment'
  created_at timestamptz [not null, default: `now()`]

  Indexes {
    (branch_id, shared_with) [unique]
  }
}
```

---

## Table Count and Relationship Summary

| # | Table | Row concept | PK | Notable FKs |
|---|-------|------------|-----|-------------|
| 1 | users | A person | id | -- |
| 2 | conversations | A workspace / chat | id | owner_id -> users |
| 3 | nodes | A message or summary | id | conversation_id -> conversations, parent_id -> nodes (self), branch_id -> branches |
| 4 | node_ancestry | Ancestor-descendant pair | (ancestor_id, descendant_id) | both -> nodes |
| 5 | branches | Named DAG pointer | id | conversation_id -> conversations, head_node_id -> nodes, base_node_id -> nodes, created_by -> users |
| 6 | context_pins | Pinned node on branch | id | branch_id -> branches, node_id -> nodes, pinned_by -> users |
| 7 | context_imports | Cherry-picked node | id | target_branch_id -> branches, source_node_id -> nodes, imported_by -> users |
| 8 | node_summaries | Summary mapping | (summary_node_id, summarized_node_id) | both -> nodes |
| 9 | tags | Label | id | -- |
| 10 | node_tags | Node-tag link | (node_id, tag_id) | node_id -> nodes, tag_id -> tags |
| 11 | branch_shares | Access grant | id | branch_id -> branches, shared_with -> users |

**Total: 11 tables, 1 trigger function, 10 explicit indexes (+ PK/unique indexes).**
