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
- **Summaries** = a node that represents a range of older nodes; replaces them in context to save tokens.

## Schema (high level)

| Table | What it does |
|---|---|
| `users` | Owners |
| `conversations` | Top-level workspace |
| `nodes` | Every message/commit; has `parent_id`, content, full-text search vector |
| `node_ancestry` | Closure table — fast ancestor lookups |
| `branches` | Named pointer with `head_node_id` and `base_node_id` |
| `context_pins` | "Always include this node on this branch" |
| `context_imports` | Cherry-picks from other branches |
| `node_summaries` | Maps a summary node to the nodes it replaces |
| `tags`, `node_tags`, `branch_shares` | Social/organization layer (Faker fodder) |

Full DBML is in `db/schema.dbml`.

## The three core queries

1. **Context assembly under a token budget** — the hot-path query. Walks ancestors via the closure table, unions with pinned + imported nodes, elides nodes that have been summarized, ranks by priority/recency, cumulative-sums tokens until the budget runs out. This is the showpiece.

2. **Branch divergence report** — given two branches, find their LCA, what's only on each side, and the size of the divergence. Useful for "should we merge?"

3. **Full-text search across all conversations** — user enters a natural-language query; Postgres full-text search (`tsvector` + `websearch_to_tsquery`) ranks matches by relevance and returns them with their branch/conversation context for cherry-picking.

Full SQL in `db/queries.sql`.

## Indexes worth talking about in the write-up

- **Closure table** `(ancestor_id, descendant_id)` — makes ancestry a single join.
- **GIN** on `nodes.content_tsv` — full-text search.
- **Composite** `(conversation_id, updated_at)` — recent conversations list.
- **Composite** `(branch_id, priority)` on pins — context assembly ordering.
- **Partial** `WHERE is_archived = false` on branches — active-branch lookups.

Each index has a query that justifies it. That's the angle for the "indexes / performance" section of the rubric.

## Stack (proposed)

- **DB**: Postgres (built-in full-text search; no extensions needed)
- **Backend**: FastAPI + SQLAlchemy
- **Frontend**: React (minimal — show the branch DAG, let user cherry-pick)
- **Hosting**: Supabase for DB, Render or similar for backend, Vercel for frontend
- **Seed data**: real-ish chat transcripts for substantive content + Faker for the user/social layer

## Scope for the deadline

**Build for v1:**
- Full schema with closure-table maintenance triggers
- Three queries fully implemented and benchmarked on seed data
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
| Entities + critical scenarios | `docs/01_entities_and_scenarios.md` |
| Domain description | `docs/02_domain_description.md` |
| Schema in SQL/DBML | `docs/03_database_schema.md` + `db/schema.dbml` |
| Schema image | dbdiagram.io render |
| Fake valid data | `db/seed/data.json` + Faker for users/social |
| 3 queries | `db/queries.sql` |
| Indexes / optimization | Index list above + benchmarks |
| **(1.5x tier)** Working MVP | Stub agent + minimal frontend |
| **(1.5x tier)** Deployed app | Supabase + Render + Vercel |

## Things to decide together

- Solo vs team-of-2 (affects how much frontend we attempt)
- Going for 1x or 1.5x point tier
- Whether the demo focuses on **cherry-pick** (most distinctive) or **branch divergence** (most visual) as the headline feature

## Repository structure

```
Graft/
├── README.md
├── backend/
│   └── main.py               # FastAPI entry point (stub)
├── db/
│   ├── schema.dbml            # Full schema for dbdiagram.io
│   ├── queries.sql            # Three core queries with comments
│   └── seed/
│       ├── data.json          # Sample data (valid against schema)
│       └── relations.md       # Explains relationships in sample data
└── docs/
    ├── ROADMAP.md             # 15-day implementation plan
    ├── 01_entities_and_scenarios.md
    ├── 02_domain_description.md
    └── 03_database_schema.md  # SQL DDL + DBML + index justifications
```

---

## Course project requirements

**Minimum requirements (X points max):**
- Entities description, most critical scenarios description: common user paths
- Domain description: what field you chose, answer the question "What should I know to reconstruct the database schema you presented using only this description?"
- Database schema in SQL and DBML – code description / DDL (use e.g. https://dbdiagram.io/d for it)
- Database schema image
- Some fake (but valid in terms of db constraints) data in db (you can use Faker e.g.)
- 3 queries to your db and SQLs to answer them
- Indexes for columns that needed it / other db performance optimizations

**Recommended requirements (1.5X points max):**
- Everything from minimum requirements
- Working MVP (at least locally, recorded demo) showing that data in db updates
- Link to deployed fully-functional app with db, frontend and backend hosted in cloud

**Advices on stack:**
- Frontend: React
- Backend: FastAPI (Python)
- Database: Postgres
- You can use any ORM library for your preferred language, e.g. for Python: sqlalchemy

**Advices on deployment:**
- Supabase for fast database hosting + auto backend APIs from db schema
- And/Or Render, Heroku, PythonAnywhere to host stand alone python backend + db
- Netlify, Vercel, or GitHub Pages for deploying frontend
