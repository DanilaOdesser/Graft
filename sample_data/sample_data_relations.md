# Sample Data Relations Guide

This document explains the relationships in `sample_data.json` and demonstrates how each Graft feature works within a realistic scenario.

---

## The Scenario

**Alex Chen** is building **RecipeBox**, a recipe-sharing web app, using an AI coding assistant. The project spans 6 coding sessions over a week. Each session tackles a different feature on its own branch — exactly how a developer would use git branches, but applied to the *conversation itself*.

---

## Conversation DAG (Node Tree)

Below is the full node tree. Each node is a message (user, assistant, or system). Indentation shows parent-child relationships. Branch ownership is labeled on the right.

```
n-01 [system] "You are an expert full-stack developer..."          ── main
└── n-02 [user] "Starting RecipeBox..."                            ── main
    └── n-03 [assistant] Project scaffold                          ── main  ★ pinned on main
        └── n-04 [user] "Define the database schema"               ── main
            └── n-05 [assistant] Core schema (4 tables)            ── main  ★ pinned on 4 branches
                └── n-06 [user] "Add junction + reviews table"     ── main
                    └── n-07 [assistant] Updated schema (6 tables) ── main  ← FORK POINT
                        │
                        ├── n-08 [user] "Build JWT auth"                   ── feat/auth
                        │   └── n-09 [assistant] Auth module               ── feat/auth
                        │       └── n-10 [user] "Add email verification"   ── feat/auth
                        │           └── n-11 [assistant] Verification flow ── feat/auth
                        │               └── n-12 [user] "Add Google OAuth" ── feat/auth
                        │                   └── n-13 [assistant] OAuth     ── feat/auth  (HEAD)
                        │
                        ├── n-14 [user] "Build recipe CRUD"                 ── feat/recipe-crud
                        │   └── n-15 [assistant] CRUD endpoints             ── feat/recipe-crud
                        │       └── n-16 [user] "Add pagination"            ── feat/recipe-crud
                        │           └── n-17 [assistant] Cursor pagination  ── feat/recipe-crud  (HEAD)
                        │               │
                        │               └── n-18 [user] "Image upload options?"      ── feat/image-upload
                        │                   └── n-19 [assistant] S3 vs Cloudinary    ── feat/image-upload  (HEAD)
                        │                       │
                        │                       ├── n-20 [user] "Try S3"                     ── spike/s3-upload
                        │                       │   └── n-21 [assistant] S3 presigned URLs   ── spike/s3-upload
                        │                       │       └── n-22 [user] "Need Lambda resize" ── spike/s3-upload
                        │                       │           └── n-23 [assistant] Lambda pipe  ── spike/s3-upload  (HEAD, ARCHIVED)
                        │                       │
                        │                       └── n-24 [user] "Try Cloudinary"               ── spike/cloudinary-upload
                        │                           └── n-25 [assistant] Cloudinary SDK        ── spike/cloudinary-upload
                        │                               └── n-26 [user] "This is simpler"      ── spike/cloudinary-upload
                        │                                   └── n-27 [assistant] Final impl    ── spike/cloudinary-upload  (HEAD)
                        │
                        ├── n-28 [user] "Add full-text search"                ── feat/search
                        │   └── n-29 [assistant] PostgreSQL FTS              ── feat/search
                        │       └── n-30 [user] "Add autocomplete"           ── feat/search
                        │           └── n-31 [assistant] Trigram autocomplete ── feat/search  (HEAD)
                        │
                        ├── n-32 [user] "Compare auth and recipe-crud"  ── main
                        │   └── n-33 [assistant] Divergence report      ── main
                        │       └── n-34 [user] "Merge everything"      ── main
                        │           └── n-35 [assistant] Final overview  ── main  (HEAD)
                        │
                        └── n-36 [summary] Auth session condensed       ── feat/auth
```

---

## Table-by-Table Relationships

### users → conversations (one-to-many)
```
u-alex ──owns──→ conv-recipebox
```
Alex owns the single conversation. Jamie exists as a collaborator (see branch_shares).

### conversations → branches (one-to-many)
```
conv-recipebox
├── br-main                  (default branch)
├── br-auth                  (forked from n-07)
├── br-recipe-crud           (forked from n-07)
├── br-image-upload          (forked from n-17)
├── br-s3-approach           (forked from n-19, ARCHIVED)
├── br-cloudinary            (forked from n-19)
└── br-search                (forked from n-07)
```

### branches → nodes via head_node_id and base_node_id

| Branch | base_node_id | head_node_id | Meaning |
|--------|-------------|-------------|---------|
| main | null | n-35 | Root branch, currently at final integration |
| feat/auth | n-07 | n-13 | Forked after schema finalized, head at OAuth |
| feat/recipe-crud | n-07 | n-17 | Forked after schema, head at pagination |
| feat/image-upload | n-17 | n-19 | Forked after CRUD, head at comparison |
| spike/s3-upload | n-19 | n-23 | Forked from comparison, ended at Lambda complexity |
| spike/cloudinary-upload | n-19 | n-27 | Forked from comparison, head at final impl |
| feat/search | n-07 | n-31 | Forked after schema, head at autocomplete |

### nodes → nodes via parent_id (the DAG)

Every node has exactly one parent (except n-01, the root). The parent-child chain creates the tree shown above. Key fork points:

- **n-07** is the parent of n-08, n-14, n-28, n-32, and n-36 — five children from four branches. This is where "main" diverges into features.
- **n-17** is the parent of n-18 — recipe-crud feeds into image-upload.
- **n-19** is the parent of both n-20 and n-24 — the S3/Cloudinary spike split.

### node_ancestry (closure table)

The closure table stores *every* ancestor-descendant pair, not just direct parents. This allows O(1) ancestor lookups instead of recursive tree walks.

Example for **n-13** (deepest node on feat/auth):

| ancestor | descendant | depth |
|----------|-----------|-------|
| n-13 | n-13 | 0 (self) |
| n-12 | n-13 | 1 (parent) |
| n-11 | n-13 | 2 |
| n-10 | n-13 | 3 |
| n-09 | n-13 | 4 |
| n-08 | n-13 | 5 |
| n-07 | n-13 | 6 (fork point) |
| n-06 | n-13 | 7 |
| n-05 | n-13 | 8 (schema) |
| ... | ... | ... |
| n-01 | n-13 | 12 (root) |

All 13 pairs are pre-computed. Query 1 joins on this table once to get all ancestors instantly.

---

## Feature Showcases

### 1. Branching — Explore without polluting main

**What happens:** Alex creates `spike/s3-upload` and `spike/cloudinary-upload` from the same parent (n-19) to prototype two approaches in parallel. The S3 spike reveals too much complexity (Lambda, IAM, cold starts), so Alex **archives** it and proceeds with Cloudinary.

**Why it matters:** Without Graft, Alex would have one linear conversation thread cluttered with the abandoned S3 code. With Graft, the S3 exploration lives on its own archived branch — invisible to future context assembly but searchable if ever needed.

**Data evidence:**
- `br-s3-approach.is_archived = true`
- `br-s3-approach.base_node_id = n-19` (same parent as Cloudinary)
- `br-cloudinary.base_node_id = n-19` (same parent)

---

### 2. Context Pins — Keep critical info always visible

**What happens:** Node n-05 (the core database schema) is pinned on **four** feature branches with priority 10 (highest). This ensures the schema definition is always included in the context window, even though n-05 is an ancestor of the fork point and would normally be deep in the history.

**Why it matters:** In a long conversation, ancestors far from the current node might get truncated under token budget pressure. Pinning guarantees the schema is always present, so the assistant never generates code that contradicts the table structure.

**Data evidence:**
```
pin-01: n-05 pinned on br-auth        (priority 10)
pin-02: n-05 pinned on br-recipe-crud (priority 10)
pin-03: n-05 pinned on br-search      (priority 10)
pin-04: n-05 pinned on br-image-upload (priority 10)
pin-05: n-03 pinned on br-main        (priority 5, lower — project structure)
```

---

### 3. Context Imports — Cherry-pick across branches

**What happens:**
- **imp-01:** The search branch imports n-15 (recipe CRUD endpoints) from `feat/recipe-crud`. Alex needs to know the Pydantic models and endpoint patterns to build search that returns `RecipeResponse` objects.
- **imp-03:** The main branch imports n-27 (final Cloudinary implementation) for the integration session.
- **imp-04:** The main branch imports n-29 (search implementation) **with `include_descendants = true`**, pulling in both n-29 and its child n-31 (autocomplete).

**Why it matters:** Without imports, the search branch has no knowledge of the recipe model — it was built on a parallel branch. Imports are Graft's version of `git cherry-pick` for context.

**Data evidence:**
```
imp-01: br-search    ← n-15 (recipe CRUD)       descendants: false
imp-02: br-cloudinary ← n-19 (S3 vs Cloudinary)  descendants: false
imp-03: br-main      ← n-27 (Cloudinary final)   descendants: false
imp-04: br-main      ← n-29 (search impl)        descendants: true  → also gets n-31
```

---

### 4. Summarization — Save tokens on old context

**What happens:** The 6-node auth conversation (n-08 through n-13) totals **~1,645 tokens**. Node n-36 is a summary that condenses all of it into **180 tokens** — an 89% reduction.

**Why it matters:** When context is assembled for the main branch integration (Session 6), the summary replaces the verbose originals. The assistant still knows auth uses JWT + bcrypt + email verification + Google OAuth, but the detailed code doesn't eat the token budget.

**Data evidence:**
```
node_summaries:
  n-36 summarizes → n-08, n-09, n-10, n-11, n-12, n-13

Token savings:
  Before: 42 + 35 + 520 + 32 + 480 + 28 + 550 = 1,645 tokens
  After:  180 tokens (the summary node)
  Saved:  1,465 tokens (~89%)
```

**How Query 1 uses this:** The `elided` CTE finds nodes that appear in `node_summaries.summarized_node_id` where the summary node is also a candidate. Those original nodes are excluded; only n-36 remains.

---

### 5. Branch Divergence — Compare before merging (Query 2)

**What happens:** In Session 6, Alex asks to compare `feat/auth` and `feat/recipe-crud`. Query 2 computes:
- **LCA (Lowest Common Ancestor):** n-07 — the last shared node
- **Only on auth:** n-08, n-09, n-10, n-11, n-12, n-13 (6 nodes)
- **Only on recipe-crud:** n-14, n-15, n-16, n-17 (4 nodes)

**Why it matters:** Before merging, Alex sees exactly what each branch contributed. The divergence report in n-33 confirms no schema conflicts — auth added columns to `users`, recipe-crud didn't touch `users`.

**Data evidence:** Compare the ancestor sets:
```
Ancestors of n-13 (auth head):
  {n-01, n-02, n-03, n-04, n-05, n-06, n-07, n-08, n-09, n-10, n-11, n-12, n-13}

Ancestors of n-17 (recipe-crud head):
  {n-01, n-02, n-03, n-04, n-05, n-06, n-07, n-14, n-15, n-16, n-17}

Common:     {n-01 .. n-07}
LCA:        n-07  (smallest max-depth among common ancestors)
Only auth:  {n-08, n-09, n-10, n-11, n-12, n-13}
Only CRUD:  {n-14, n-15, n-16, n-17}
```

---

### 6. Full-Text Search — Find patterns across history (Query 3)

**What happens:** Suppose Alex searches for `"pagination cursor"`. Query 3 runs `websearch_to_tsquery('english', 'pagination cursor')` against the `content_tsv` column. It would match:
- **n-17** (cursor-based pagination implementation) — highest relevance
- **n-16** (the user request mentioning pagination) — secondary match

Both are on `feat/recipe-crud` (not archived), owned by Alex. Results include branch name and conversation title for context, so Alex can cherry-pick the relevant node into another branch.

**Why it matters:** Months later, when building a different project that needs pagination, Alex can search across all conversations, find the pattern, and import it.

---

### 7. Tags — Organize nodes by concern

| Tag | Tagged Nodes | Purpose |
|-----|-------------|---------|
| schema-design | n-05, n-07 | Schema definition nodes |
| api-endpoint | n-09, n-15, n-17, n-29 | Nodes that define API endpoints |
| architecture-decision | n-19, n-27 | Decision points (S3 vs Cloudinary) |
| security | n-09, n-11, n-13 | Auth and security-related code |

Tags enable filtered browsing: "show me all architecture decisions" or "show me all API endpoints across branches."

---

### 8. Branch Shares — Collaboration

| Share | Branch | Shared With | Permission |
|-------|--------|------------|------------|
| share-01 | spike/s3-upload | Jamie Lee | comment |
| share-02 | main | (public) | view |

Alex shares the S3 spike with Jamie for a second opinion before deciding on Cloudinary. After integration, the main branch is made public (shared_with = null) so the whole team can see the final result.

---

## Context Assembly Walkthrough (Query 1)

Here's a concrete example of what Query 1 returns when assembling context for **n-31** (autocomplete, on `feat/search`) with a **budget of 2000 tokens**:

### Step 1: Gather ancestors via closure table
| Node | Tokens | Depth | Source |
|------|--------|-------|--------|
| n-31 | 480 | 0 | ancestor (self) |
| n-30 | 32 | 1 | ancestor |
| n-29 | 550 | 2 | ancestor |
| n-28 | 38 | 3 | ancestor |
| n-07 | 380 | 4 | ancestor |
| n-06 | 30 | 5 | ancestor |
| n-05 | 450 | 6 | ancestor |
| n-04 | 35 | 7 | ancestor |
| n-03 | 185 | 8 | ancestor |
| n-02 | 55 | 9 | ancestor |
| n-01 | 42 | 10 | ancestor |

### Step 2: Add pinned nodes
| Node | Tokens | Priority | Source |
|------|--------|----------|--------|
| n-05 | 450 | 10 | pinned (pin-03) |

(Already in ancestors, but pinned status boosts its rank.)

### Step 3: Add imported nodes
| Node | Tokens | Source |
|------|--------|--------|
| n-15 | 600 | imported (imp-01) |

### Step 4: Rank and budget-cut
Ranking order: pin priority DESC, then source type (pinned → ancestor → imported), then depth ASC, then recency.

| Rank | Node | Source | Tokens | Running Total |
|------|------|--------|--------|---------------|
| 1 | n-05 | pinned (pri=10) | 450 | 450 |
| 2 | n-31 | ancestor (depth 0) | 480 | 930 |
| 3 | n-30 | ancestor (depth 1) | 32 | 962 |
| 4 | n-29 | ancestor (depth 2) | 550 | 1,512 |
| 5 | n-28 | ancestor (depth 3) | 38 | 1,550 |
| 6 | n-15 | imported | 600 | 2,150 **> budget** |

**Result:** Nodes n-05, n-31, n-30, n-29, n-28 are included (1,550 tokens). Node n-15 (the imported recipe CRUD) is **excluded** because it would exceed the 2,000-token budget. The older ancestors (n-07, n-06, n-04, n-03, n-02, n-01) are also excluded.

If the budget were raised to 3,000, n-15 and n-07 would also make it in.

---

## Entity-Relationship Summary

```
users ─────────────┐
  │                 │
  │ owns            │ created_by / pinned_by / imported_by / shared_with
  ▼                 │
conversations       │
  │                 │
  ├── branches ◄────┘
  │     │  ▲
  │     │  │ head_node_id, base_node_id
  │     │  │
  │     ├── context_pins ──────→ nodes
  │     ├── context_imports ───→ nodes
  │     └── branch_shares ────→ users
  │
  └── nodes
        │  ▲
        │  │ parent_id (tree edge)
        │  │
        ├── node_ancestry (closure table: all ancestor pairs)
        ├── node_summaries (summary_node → summarized_node)
        └── node_tags ──→ tags
```

---

## Key Takeaways

1. **n-07 is the hub** — four branches fork from it, making it the most connected node in the DAG
2. **n-05 is the most-pinned node** — pinned on 4 branches because the schema is universally needed context
3. **The S3 vs Cloudinary spike** shows how branching enables safe exploration — try both, archive the loser
4. **Summarization** reduced auth context from 1,645 to 180 tokens (89% savings) without losing information
5. **Imports** let the search branch access recipe models it was never part of building
6. **The closure table** makes all of this efficient — context assembly is a single indexed join, not a recursive walk
