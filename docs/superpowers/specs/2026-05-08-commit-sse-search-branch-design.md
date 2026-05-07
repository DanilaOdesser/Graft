# Graft — Commit, SSE, Graph Search, Branch-from-Node Design

**Date:** 2026-05-08  
**Status:** Approved  
**Scope:** Four interconnected features for the Graft conversation graph UI

---

## 1. Commit + Node Summarize

### What it does

After several agent turns, the user can "commit" the accumulated messages into a single named summary node. The commit collapses those turns in context (via the existing `node_summaries` table) so future LLM calls see a compact summary instead of every raw turn.

### Backend

**New endpoint:** `POST /branches/{branch_id}/commit`

Request body:
```json
{ "commit_message": "short label the user typed" }
```

Steps:
1. Walk ancestors from `branch.head_node_id` back to the most recent `node_type = "summary"` node (or root if none). These are the uncommitted nodes.
2. If zero uncommitted non-summary nodes exist, return 400 ("nothing to commit").
3. Call LLM with those nodes to generate a 1–2 sentence summary of what happened.
4. Create a new `Node`:
   - `node_type = "summary"`, `role = "summary"`
   - `parent_id = current HEAD`
   - `content = "{commit_message}\n\n{llm_summary}"`
   - `branch_id = branch.id`
5. Insert one `NodeSummary(summary_node_id, summarized_node_id)` row per uncommitted node.
6. Advance `branch.head_node_id` to the new summary node.
7. Publish SSE event `commit_created` with payload `{ node: <summary node>, branch: <updated branch> }`.
8. Return `{ node, commit_message, llm_summary }`.

No schema changes required. Uses existing `node_summaries`, `nodes`, and `branches` tables.

### Frontend — SendBox

Add a second row below the chat input:

```
[ Commit message...              ] [ Commit ]
[ Send a message...              ] [ Send   ]
```

- "Commit" button disabled when `branch.head_node_id` points to a summary node (nothing to commit).
- On click: `POST /branches/{branch_id}/commit` with `{ commit_message }`.
- SSE event handles state update automatically (no manual refresh).
- Input clears on success.

### Graph — Summary Node Appearance

- Icon: `Σ` (already defined in `roleIcons.summary`)
- Label: first line of `content` (the commit message the user typed)
- Detail panel: shows the full second paragraph (LLM-generated summary)
- Visual: same branch color, but with a double-ring shadow to distinguish from message nodes

---

## 2. SSE Real-time Graph Updates

### What it does

All graph state (nodes, branches, pins, imports) updates instantly across the UI when any mutation occurs — no manual refresh, no polling.

### Backend

**New endpoint:** `GET /conversations/{conv_id}/stream`  
Response: `text/event-stream`

In-process pub/sub using a module-level dict:
```python
_channels: dict[str, list[asyncio.Queue]] = {}
```

Every mutation endpoint publishes after DB commit using a helper:
```python
await publish(conv_id, event_type, payload)
```

**Event types and payloads:**

| Event | Payload |
|---|---|
| `node_created` | `{ node: NodeObject }` |
| `branch_updated` | `{ branch: BranchObject }` |
| `pin_created` | `{ pin: PinObject }` |
| `pin_deleted` | `{ pin_id: string }` |
| `import_created` | `{ import: ImportObject }` |
| `import_deleted` | `{ import_id: string }` |
| `commit_created` | `{ node: NodeObject, branch: BranchObject }` |

SSE wire format:
```
event: node_created
data: {"node": {...}}

```

Connection lifecycle: client subscribes on mount, server keeps connection open with 30s heartbeat comments (`": heartbeat\n\n"`), client closes on unmount.

### Frontend

`ConversationView` opens `EventSource("/api/conversations/{id}/stream")` on mount. Each event type triggers a targeted state merge:

| Event | State update |
|---|---|
| `node_created` | `setAllNodes(prev => [...prev, node])` |
| `branch_updated` | replace branch in `branches`; update `selected` if matching |
| `pin_created` | `setAllPins(prev => [...prev, pin])` |
| `pin_deleted` | `setAllPins(prev => prev.filter(p => p.id !== pin_id))` |
| `import_created` | `setAllImports(prev => [...prev, imp])` |
| `import_deleted` | `setAllImports(prev => prev.filter(i => i.id !== import_id))` |
| `commit_created` | append node + update branch (covers both node_created + branch_updated) |

The graph `useMemo` in `ConversationGraph` recomputes automatically when any of these states change. No full re-fetches needed after initial load.

---

## 3. In-Graph Search

### What it does

A search input overlaid on the graph canvas lets users find nodes by content and jump to them instantly.

### Frontend

**Placement:** Absolute-positioned in the top-right of the `ConversationGraph` wrapper div, above the ReactFlow canvas.

**Component:** Inline in `ConversationGraph.jsx` — receives `conversationId` and `userId` as new props.

**Behaviour:**
1. User types in search input.
2. 300ms debounce → `api.search(q, userId, 20)`.
3. Results filtered client-side to `node.conversation_id === conversationId`.
4. Dropdown shows up to 8 matches: role badge + first 60 chars of content.
5. Clicking a result:
   - Calls `onNodeSelect(matchedNode)` → opens detail panel.
   - Sets `selectedNodeId` → graph highlights the node.
   - Calls `reactFlowInstance.fitView({ nodes: [{ id }], padding: 0.4 })` to scroll/zoom to it.
6. Escape or outside click closes the dropdown.
7. "No matches in this conversation" shown when filtered results are empty.

**No backend changes.** Existing `/api/search` endpoint is reused; conversation scoping is client-side.

---

## 4. Branch from Any Node

### What it does

In the graph detail panel, any node can be used as a fork point for a new branch — not just the current branch HEAD.

### Backend

No change. `POST /conversations/{conv_id}/branches` already accepts `fork_node_id` pointing to any node.

### Frontend — Node Detail Panel

Add below the existing Pin and Import buttons:

```
[ + Create branch here ]
  Branch name: [_____________] [ Create ]
```

- Clicking "Create branch here" expands an inline form within the panel.
- Form: text input for branch name + Create button (disabled if empty).
- On submit: `api.createBranch(convId, { name, fork_node_id: selectedNode.id, created_by: userId })`.
- On success: SSE `branch_updated` event updates `branches` state automatically. The new branch is set as `selected` so the user can immediately send messages on it.
- 409 from server (duplicate name) shows an inline error: "Branch name already exists."
- Form dismisses on success; detail panel stays open.

---

## Component Changes Summary

| File | Change |
|---|---|
| `backend/routers/branches.py` | Add `POST /{branch_id}/commit` |
| `backend/routers/conversations.py` | Add `GET /{conv_id}/stream` (SSE) |
| `backend/sse.py` | New: in-process pub/sub helper (`publish`, channel registry) |
| `backend/llm.py` | Add `summarize_nodes(nodes) -> str` function |
| `backend/routers/agent.py` | Call `publish` after commit |
| `backend/routers/branches.py` | Call `publish` after pin/import/branch mutations |
| `frontend/src/components/SendBox.jsx` | Add commit row (input + button) |
| `frontend/src/components/ConversationGraph.jsx` | Add search overlay; accept `conversationId`, `userId` props |
| `frontend/src/pages/ConversationView.jsx` | Open/close EventSource; handle SSE events; pass new graph props; add branch-create form in node detail panel |
| `frontend/src/api.js` | Add `commitBranch(branchId, data)` |

---

## Out of Scope

- Persistent SSE across page reload (handled by initial data fetch on mount)
- Multi-user conflict resolution (Graft is currently single-user)
- Editing or undoing a commit
- Commit diff view (what changed between two commits)
