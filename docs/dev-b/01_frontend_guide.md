# DEV-B Frontend Guide

Detailed specs for each component you build. Estimated time: 3 hours total.

You plug into DEV-A's scaffold — you don't create the app, router, or API client. You import from them.

---

## SearchPage (1 hour)

**Route:** `/search` (you add this to DEV-A's `App.jsx` at merge point 3)

### Layout

```
+------------------------------------------+
| <- Back to Conversations                  |
|                                           |
| Search: [___________________________] [Go]|
|                                           |
| 5 results for "recipe"                    |
|                                           |
| +--------------------------------------+ |
| | "Let me define the Recipe model with | |
| |  the following fields: title, desc..." | |
| | assistant · feat/recipe-crud · RecipeBox|
| | Relevance: 0.89                        |
| | [View in context] [Import to...]       |
| +--------------------------------------+ |
| |                                        |
| | "For search, we need to index the     |
| |  recipe title and description..."      |
| | user · feat/search · RecipeBox         |
| | Relevance: 0.72                        |
| | [View in context] [Import to...]       |
| +--------------------------------------+ |
+------------------------------------------+
```

### Implementation

```jsx
import { useState } from 'react';
import { api } from '../api';
import SearchResults from '../components/SearchResults';
import ImportModal from '../components/ImportModal';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState(null); // node to import

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const data = await api.search(query, USER_ID);
    setResults(data);
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <a href="/" className="text-blue-600 text-sm">← Back to Conversations</a>
      <div className="flex gap-2 mt-4">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Search across all conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} className="bg-blue-600 text-white px-4 py-2 rounded">
          Search
        </button>
      </div>

      {loading && <p className="mt-4 text-gray-500">Searching...</p>}

      <SearchResults
        results={results}
        onImport={(node) => setImportTarget(node)}
        onView={(node) => window.location.href = `/conversations/${node.conversation_id}`}
      />

      {importTarget && (
        <ImportModal
          sourceNode={importTarget}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  );
}
```

### SearchResults Component

**Props:** `results`, `onImport`, `onView`

Each result card shows:
- Content snippet (first 200 chars + ellipsis)
- Role badge (user/assistant/system)
- Branch name + conversation title
- Relevance score (formatted to 2 decimal places)
- Two buttons: "View in context" and "Import to..."

```jsx
export default function SearchResults({ results, onImport, onView }) {
  if (!results.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-500">{results.length} results</p>
      {results.map((r) => (
        <div key={r.node_id} className="border rounded p-3">
          <p className="text-sm">{r.content.slice(0, 200)}{r.content.length > 200 ? '...' : ''}</p>
          <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
            <span>{r.role} · {r.branch_name} · {r.conversation_title}</span>
            <span>Relevance: {r.rank.toFixed(2)}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => onView(r)} className="text-xs text-blue-600">View in context</button>
            <button onClick={() => onImport(r)} className="text-xs text-green-600">Import to...</button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## ImportModal (45 min)

Triggered from search results or from "Import" button on a message bubble.

### Layout

```
+----------------------------------+
| Import Node to Branch            |
|                                  |
| Source: "Recipe CRUD models..."  |
|                                  |
| Target branch: [dropdown v]      |
|                                  |
| [ ] Include descendants          |
|                                  |
|        [Cancel] [Import]         |
+----------------------------------+
```

### Implementation

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function ImportModal({ sourceNode, conversationId, onClose }) {
  const [branches, setBranches] = useState([]);
  const [targetBranchId, setTargetBranchId] = useState('');
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    // Fetch branches for the current conversation (or all conversations)
    if (conversationId) {
      api.getConversation(conversationId).then(conv => {
        setBranches(conv.branches || []);
      });
    }
  }, [conversationId]);

  const handleImport = async () => {
    if (!targetBranchId) return;
    setImporting(true);
    await api.createImport(targetBranchId, {
      source_node_id: sourceNode.node_id || sourceNode.id,
      include_descendants: includeDescendants,
      imported_by: USER_ID,
    });
    setImporting(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-96">
        <h3 className="font-semibold">Import Node to Branch</h3>
        <p className="text-sm text-gray-500 mt-2 truncate">
          Source: "{sourceNode.content?.slice(0, 80)}..."
        </p>
        <div className="mt-4">
          <label className="text-sm font-medium">Target branch:</label>
          <select
            className="w-full border rounded px-2 py-1 mt-1"
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
          >
            <option value="">Select a branch...</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          Include descendants
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1 text-sm text-gray-600">Cancel</button>
          <button
            onClick={handleImport}
            disabled={!targetBranchId || importing}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Note:** Add `createImport` and `deleteImport` to `api.js` (coordinate with DEV-A or add it yourself — it's just two more functions in the same pattern).

---

## PinsPanel (45 min)

A collapsible sidebar or tab inside ConversationView.

### Layout

When expanded:
```
+---------------------+
| Pinned Context  [x] |
|                     |
| [P:10] Core Schema  |
| "CREATE TABLE..."   |
| [Unpin]             |
|                     |
| [P:5] Auth Config   |
| "JWT token setup..."| 
| [Unpin]             |
|                     |
| No more pins.       |
+---------------------+
```

### Implementation

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api';

export default function PinsPanel({ branchId, onClose }) {
  const [pins, setPins] = useState([]);

  useEffect(() => {
    if (branchId) {
      api.getPins(branchId).then(setPins);
    }
  }, [branchId]);

  const handleUnpin = async (pinId) => {
    await api.deletePin(pinId);
    setPins(pins.filter(p => p.id !== pinId));
  };

  return (
    <div className="w-64 border-l p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">Pinned Context</h3>
        <button onClick={onClose} className="text-gray-400 text-xs">close</button>
      </div>
      {pins.length === 0 && <p className="text-xs text-gray-400">No pins on this branch.</p>}
      {pins.map(pin => (
        <div key={pin.id} className="border rounded p-2 mb-2">
          <div className="flex justify-between text-xs">
            <span className="font-mono bg-blue-100 px-1 rounded">P:{pin.priority}</span>
          </div>
          {pin.reason && <p className="text-xs text-gray-500 mt-1">{pin.reason}</p>}
          <p className="text-xs mt-1 truncate">{pin.node_content || 'Loading...'}</p>
          <button
            onClick={() => handleUnpin(pin.id)}
            className="text-xs text-red-500 mt-1"
          >
            Unpin
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Pin Button on Messages

At merge point 3, add a "Pin" button to each message in DEV-A's `MessageThread.jsx`:

```jsx
{/* DEV-B: action buttons -- pin, import */}
<button
  onClick={() => onPin(node.id)}
  className="text-xs text-blue-600"
>
  Pin
</button>
<button
  onClick={() => onImport(node)}
  className="text-xs text-green-600"
>
  Import to...
</button>
```

The `onPin` handler opens a small inline form for priority + reason, then calls `api.createPin(branchId, { node_id, priority, reason, pinned_by })`.

---

## API Functions

**All API functions are already in `api.js` from Merge 1.** DEV-A pre-includes stubs for all endpoints (both DEV-A's and DEV-B's). You do NOT need to add any functions to `api.js`.

Functions you'll use:
- `api.search(q, userId, k)` — search endpoint
- `api.createPin(branchId, data)` — create a pin
- `api.deletePin(pinId)` — remove a pin
- `api.createImport(branchId, data)` — create an import
- `api.deleteImport(importId)` — remove an import
- `api.getConversation(id)` — fetch branches for import modal dropdown
- `api.getPins(branchId)` — list pins for pins panel
- `api.getDivergence(branchA, branchB)` — branch comparison

Also available: `DEFAULT_USER_ID` export for the hardcoded test user.
