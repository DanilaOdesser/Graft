# Known Bugs

> **Status: All known bugs have been resolved.** The entries below are kept as a historical record of issues discovered and fixed during development.

## ~~1. Optimistic message sometimes doesn't appear on first send~~ ✓ Fixed

**Symptom:** After hitting Send, the user message doesn't show up in the thread immediately. Usually happens the first time a message is sent on a branch. The message does land (API succeeds) and appears after `refreshContext()` completes.

**Likely cause:** `pendingMessages` is set synchronously via `handleOptimisticSend`, but if `refreshContext()` fires first (e.g. due to SSE `branch_updated` triggering a `selected` change which re-runs the `refreshContext` effect), it clears `pendingMessages` before the render paints the optimistic message. Race between the SSE-driven context refresh and the optimistic state write.

**Files:** `frontend/src/pages/ConversationView.jsx` — `handleOptimisticSend`, `refreshContext`, the `useEffect` on `selected`.

---

## ~~2. Creating a branch from the sidebar shows it twice~~ ✓ Fixed

**Symptom:** After typing a name and clicking Fork in BranchSidebar, the new branch appears twice in the branch list.

**Likely cause:** `handleCreateBranch` in `ConversationView` adds the branch to state immediately (`setBranches(prev => [...prev, br])`), and then the SSE `branch_updated` event fires and adds it again (the dedup check in the SSE handler uses `exists = prev.some(b => b.id === branch.id)` — but if the local add races ahead of SSE this should be fine; more likely the `onCreate` call in BranchSidebar triggers a re-render that calls the API twice, or the SSE fires before the local add and both paths insert).

**Files:** `frontend/src/pages/ConversationView.jsx` — `handleCreateBranch`, SSE `branch_updated` handler. `frontend/src/components/BranchSidebar.jsx` — `handleSubmit`.

---

## ~~3. Export to Claude Code is broken with commit-node schema~~ ✓ Fixed

**Symptom:** `POST /nodes/{node_id}/export-claude` was built when every user/assistant turn was its own node. Now committed turns are stored as a single `summary` node whose `content` field contains the raw transcript (`commit_message\n\nUser: ...\nAssistant: ...`). The export query filters `role IN ('user', 'assistant')` so commit nodes (`role = NULL`, `node_type = 'summary'`) are silently skipped, producing an export that's missing all committed history.

**What needs to change:**
- The linearization query in `export.py` (`chat_rows = [r for r in rows if r["role"] in ("user", "assistant")]`) needs to handle `node_type = 'summary'` rows.
- Summary node content should be parsed back into individual user/assistant JSONL lines (splitting on the `\n\nUser:` / `\n\nAssistant:` markers written by the commit endpoint), or injected as a preamble block similar to how pins/imports are handled today.
- The `exported_message_count` accounting used for sync-back will need updating too, since the count of JSONL lines no longer equals the count of DB nodes.

**Files:** `backend/routers/export.py` — `export_to_claude_code`, `_sync_branch_from_cc`.
