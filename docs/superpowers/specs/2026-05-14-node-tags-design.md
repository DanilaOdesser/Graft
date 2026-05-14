# Node Tags — Design Spec

**Date:** 2026-05-14  
**Status:** Approved

---

## Overview

Allow users to attach arbitrary labels (tags) to individual nodes. Tags are global (shared across all conversations), created on-the-fly from the message card UI, and surfaced as search facets in the search page.

The `tags` and `node_tags` tables already exist in the schema. This feature wires them up end-to-end.

---

## Backend

### New router: `routers/tags.py`

Register under the `/api` prefix in `main.py`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tags` | Return all tags `[{id, name}]` — used for autocomplete |
| `POST` | `/tags` | Create a tag by name. Idempotent: if a tag with that name already exists, return it with `200` instead of `201`. Body: `{name: str}` |
| `GET` | `/nodes/{id}/tags` | Return tags currently applied to this node `[{id, name}]` |
| `PUT` | `/nodes/{id}/tags` | Replace the full tag set for this node. Body: `{tag_ids: [uuid]}`. Deletes all existing `NodeTag` rows for the node, inserts new ones. Returns `[{id, name}]`. |

After `PUT /nodes/{id}/tags`, publish SSE event:
```
event_type: "node_tags_updated"
payload: { node_id: str, tags: [{id, name}] }
```

### Search endpoint change (`routers/search.py`)

Add optional query param `tag: str | None`. When provided, filter results to nodes that have a `NodeTag` row for a tag whose `name` matches (case-insensitive). Join: `nodes → node_tags → tags`.

---

## Frontend

### `src/api.js` additions

```js
getTags: () => request("/tags"),
createTag: (name) => request("/tags", { method: "POST", body: JSON.stringify({ name }) }),
getNodeTags: (nodeId) => request(`/nodes/${nodeId}/tags`),
setNodeTags: (nodeId, tagIds) => request(`/nodes/${nodeId}/tags`, { method: "PUT", body: JSON.stringify({ tag_ids: tagIds }) }),
```

### Tag color utility (`src/tagColor.js`)

Deterministic color from tag name — no storage needed:

```js
const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

export function tagColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
```

### `src/components/TagPopover.jsx` (new)

Props: `nodeId`, `onClose`

Behavior:
1. On mount: fetch `GET /nodes/{nodeId}/tags` → `appliedTags`. Fetch `GET /tags` → `allTags`.
2. Render a text input (autofocused) and a dropdown list.
3. Dropdown shows `allTags` filtered by the input value (case-insensitive substring match). Each entry shows a colored dot, the tag name, and a checkmark if it's in `appliedTags`.
4. If the typed value doesn't match any existing tag, show a **"Create 'xyz'"** entry at the bottom.
5. Clicking an existing tag: toggle it in the local selected set, call `PUT /nodes/{nodeId}/tags` with the new full set.
6. Clicking "Create 'xyz'": call `POST /tags`, then immediately toggle the new tag on and call `PUT /nodes/{nodeId}/tags`.
7. Close on Escape or click-outside.

### `src/components/MessageThread.jsx` changes

- Import `TagPopover` and `tagColor`.
- Accept `nodeTags` as a prop (`Map<nodeId, Tag[]>`) — state is owned by `ConversationView` (see below).
- In each message card header, after the source badge and before the token count, render tag chips:
  ```jsx
  {(nodeTags.get(n.id) ?? []).map(t => (
    <span key={t.id} className={`text-[9px] px-1.5 py-0.5 rounded-full ${tagColor(t.name)}`}>{t.name}</span>
  ))}
  ```
- In the hover action row, add a **Tag** button that opens `<TagPopover nodeId={n.id} onClose={...} />` positioned relative to the button.

### `ConversationView.jsx` changes

**State:** Add `nodeTags` (`Map<nodeId, Tag[]>`), initialized empty.

**Initial load:** After `refreshContext()` resolves and the visible node list is known, fire `Promise.all(visibleNodeIds.map(id => api.getNodeTags(id)))` in parallel and populate `nodeTags`. This ensures chips appear for tags set in previous sessions.

**SSE handler:** Add case for `node_tags_updated`:
```js
case "node_tags_updated":
  setNodeTags(prev => {
    const next = new Map(prev);
    next.set(data.node_id, data.tags);
    return next;
  });
```

Pass `nodeTags` down to `MessageThread` as a prop.

### `src/pages/SearchPage.jsx` changes

- On mount, fetch `GET /tags` → `allTags`.
- Render a tag facet bar above results: a row of tag chips. Clicking a chip sets `selectedTag` state (one at a time; clicking again deselects).
- When `selectedTag` is set, append `&tag=<name>` to the search API call.
- Highlight the selected tag chip with a filled style vs outlined.

---

## Data flow summary

```
User clicks Tag on message card
  → TagPopover opens
  → fetches current tags for node
  → user selects/creates tags
  → PUT /nodes/{id}/tags
  → SSE node_tags_updated fires
  → MessageThread updates chip display for that node
```

---

## Out of scope (MVP)

- Multi-tag filtering in search (only one tag facet at a time)
- Tag rename / delete
- Tag color customization (colors are deterministic)
- Tags in context assembly / LLM pipeline
