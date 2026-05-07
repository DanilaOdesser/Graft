# Agent Context DB — Project Summary

## What we're building

**"Git for agent conversations."** A database that lets users branch, cherry-pick, and merge context across long-running chats with an AI agent (think Claude Code, but the conversation history is a DAG instead of a flat list).

The agent itself is a thin wrapper over an LLM API. The interesting work — figuring out *what context to include on every turn* — happens in the database. That's the whole pitch: the DB is the protagonist.

## The problem it solves

Long agent conversations get bloated. You want to try something speculative without polluting your main thread, or you remember solving a problem in a different chat three days ago and want to pull that context in. Today you copy-paste. We're building proper structure for it.

## Core mental model

- **Conversation** = a DAG of nodes (messages or commits), owned by a user.
- **Branches** = named pointers into the DAG (like git branches). They don't *contain* nodes; they point at a leaf.
- **Pins** = "always include this node in my context when I'm on this branch."
- **Imports** = cherry-picked nodes (or subtrees) from another branch.
- **Memories** = distilled facts above the raw message layer. Branch-scoped by default, can be promoted to conversation-global.
- **Summaries** = a node that represents a range of older nodes; replaces them in context to save tokens.

## Schema (high level)

| Table | What it does |
|---|---|
| `users` | Owners |
| `conversations` | Top-level workspace |
| `nodes` | Every message/commit; has `parent_id`, content, embedding |
| `node_ancestry` | Closure table — fast ancestor lookups |
| `branches` | Named pointer with `head_node_id` and `base_node_id` |
| `context_pins` | "Always include this node on this branch" |
| `context_imports` | Cherry-picks from other branches |
| `memories` | Distilled facts; branch-scoped or global; supports supersession |
| `memory_promotions` | Log of memory elevation events |
| `node_summaries` | Maps a summary node to the nodes it replaces |
| `tags`, `node_tags`, `branch_shares` | Social/organization layer (Faker fodder) |

Full DBML is in `schema.dbml`.

## The four core queries

1. **Context assembly under a token budget** — the hot-path query. Walks ancestors via the closure table, unions with pinned + imported nodes, elides nodes that have been summarized, ranks by priority/recency, cumulative-sums tokens until the budget runs out. This is the showpiece.

2. **Memory promotion candidates** — find branch-scoped memories that have been imported into ≥ K *other* branches recently. Drives auto-promotion.

3. **Branch divergence report** — given two branches, find their LCA, what's only on each side, and pairs of semantically similar nodes that were independently discovered (vector similarity). Useful for "should we merge?"

4. **Semantic search across all conversations** — embed a user query, HNSW lookup, return matches with their branch/conversation context for cherry-picking.

Full SQL in `queries.sql`.

## Indexes worth talking about in the write-up

- **Closure table** `(ancestor_id, descendant_id)` — makes ancestry a single join.
- **HNSW** on `nodes.embedding` and `memories.embedding` — semantic search.
- **Composite** `(conversation_id, updated_at)` — recent conversations list.
- **Composite** `(branch_id, priority)` on pins — context assembly ordering.
- **Partial** `WHERE is_archived = false` on branches — active-branch lookups.

Each index has a query that justifies it. That's the angle for the "indexes / performance" section of the rubric.

## Stack (proposed)

- **DB**: Postgres + `pgvector` extension
- **Backend**: FastAPI + SQLAlchemy
- **Frontend**: React (minimal — show the branch DAG, let user cherry-pick)
- **Hosting**: Supabase for DB, Render or similar for backend, Vercel for frontend
- **Seed data**: real-ish chat transcripts for substantive content + Faker for the user/social layer

## Scope for the deadline

**Build for v1:**
- Full schema with closure-table maintenance triggers
- Four queries fully implemented and benchmarked on seed data
- Simple ingestion CLI (paste a transcript or import from a file — no live Claude Code integration)
- Minimal frontend showing the branch DAG and cherry-pick flow
- Agent = a stub that takes assembled context, calls an LLM, returns text

**Skip for v1 (model in schema, don't build UI):**
- Real-time collab
- Branch templates
- Auto-summarization (let the user paste a summary for now)
- Most of the social layer (use Faker for those tables, don't build UI)

## Rubric mapping

| Requirement | Where it lands |
|---|---|
| Entities + critical scenarios | This doc + a longer write-up |
| Domain description | "What we're building" + "Core mental model" |
| Schema in SQL/DBML | `schema.dbml` → DDL |
| Schema image | dbdiagram.io render |
| Fake valid data | Ingestion script + Faker for users/social |
| 3 queries | We have 4 in `queries.sql` (pick the best 3 or include all) |
| Indexes / optimization | Index list above + benchmarks |
| **(1.5x tier)** Working MVP | Stub agent + minimal frontend |
| **(1.5x tier)** Deployed app | Supabase + Render + Vercel |

## Things to decide together

- Solo vs team-of-2 (affects how much frontend we attempt)
- Going for 1x or 1.5x point tier
- Whether the demo focuses on **cherry-pick** (most distinctive) or **branch divergence** (most visual) as the headline feature
- Embedding source: real OpenAI/local embeddings, or fake deterministic vectors for development

## Files in the repo so far

- `schema.dbml` — full schema, paste into dbdiagram.io to visualize
- `queries.sql` — the four core queries with comments
- `README.md` — this file
