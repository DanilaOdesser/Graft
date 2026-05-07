# 1-Day Sprint Overview

## Timeline

Total: ~10 hours, 2 developers working in parallel.

| Time | DEV-A ("Tree & Read Path") | DEV-B ("Edits & Search Path") | Sync? |
|------|---------------------------|-------------------------------|-------|
| 0:00–0:30 | Joint setup: Supabase DB, run DDL, verify trigger, seed data, run queries | Same — verify tables, test trigger, confirm queries | **Together** |
| 0:30 | DEV-A merges scaffold (FastAPI + Vite + db.py + api.js) | DEV-B pulls scaffold | **Merge 1** |
| 0:30–3:00 | SQLAlchemy models (4 tables), conversation/branch/context endpoints | SQLAlchemy models (7 tables), nodes/pins/imports/divergence/search endpoints | Parallel |
| 3:00–4:30 | Agent stub endpoint, integration test | CLI ingestion tool, integration tests | Parallel |
| 4:30 | Both merge backend, smoke test each other's endpoints with curl | Same | **Merge 2** |
| 4:30–7:30 | Frontend scaffold, DAG sidebar, message thread, send box | Search UI, cherry-pick modal, pins panel | Parallel |
| 7:30 | Frontend merge, local golden-path test | DEV-B injects buttons into DEV-A's message thread | **Merge 3** |
| 7:30–9:00 | Deploy backend to Render, connect to Supabase, CORS | Deploy frontend to Vercel, wire API URL | Parallel |
| 9:00–10:00 | End-to-end test on deployed app, demo recording/screenshots | Write-up (docs/writeup.md), update README with URLs | Parallel |

## Tier Strategy

The plan is structured so **1x tier deliverables are done by hour 0:30**:
- Schema DDL executed and verified
- Seed data loaded
- 3 queries run and confirmed
- Indexes verified via EXPLAIN

Everything after that builds toward 1.5x (working MVP + deployment). If you fall behind, you already have 1x locked in.

## Cut List (in order of sacrifice)

If running out of time, cut from the bottom:

1. DB + queries working (1x tier) -- **never cut**
2. Backend API endpoints -- proves queries from app code
3. Frontend golden path -- conversation -> message -> branch -> context
4. Deployment -- push whatever you have
5. ~~Search UI~~ -- demo via curl
6. ~~Cherry-pick UI~~ -- demo via curl
7. ~~Pins UI~~ -- demo via curl
8. ~~Write-up polish~~ -- submit bullets instead of prose

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Database | PostgreSQL via Supabase | Managed, free tier, built-in FTS |
| Backend | FastAPI + SQLAlchemy | Python, fast to scaffold, good Supabase support |
| Frontend | React + Vite + Tailwind | Fast dev server, minimal config |
| Backend hosting | Render | Free tier, easy Python deploy |
| Frontend hosting | Vercel | Free tier, zero-config React deploy |
