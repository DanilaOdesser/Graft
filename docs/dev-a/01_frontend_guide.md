# DEV-A Frontend Guide

Detailed specs for each component you build. Estimated time: 3 hours total.

---

## App Scaffold (30 min)

### Setup

```bash
cd frontend/
npm create vite@latest . -- --template react
npm install react-router-dom
npm install -D tailwindcss @tailwindcss/vite
```

Configure Tailwind in `vite.config.js`:
```js
import tailwindcss from '@tailwindcss/vite'
export default {
  plugins: [tailwindcss()]
}
```

Add to `src/index.css`:
```css
@import "tailwindcss";
```

### API Client (`src/api.js`)

```js
const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

// DEFAULT_USER_ID: first user from seed data. Both devs use this for testing.
// After seed loading in Phase 0, replace with the actual UUID generated for user "u-01".
export const DEFAULT_USER_ID = '<set-after-seed-loading>';

export const api = {
  // Conversations (DEV-A endpoints)
  getConversations: (ownerId) => request(`/conversations?owner_id=${ownerId}`),
  getConversation: (id) => request(`/conversations/${id}`),
  createConversation: (data) => request('/conversations', { method: 'POST', body: JSON.stringify(data) }),

  // Branches (DEV-A endpoints)
  getBranch: (id) => request(`/branches/${id}`),
  createBranch: (convId, data) => request(`/conversations/${convId}/branches`, { method: 'POST', body: JSON.stringify(data) }),
  archiveBranch: (id) => request(`/branches/${id}/archive`, { method: 'POST' }),

  // Context (DEV-A endpoints)
  getContext: (nodeId, budget = 4096) => request(`/nodes/${nodeId}/context?budget=${budget}`),

  // Agent (DEV-A endpoints)
  sendMessage: (data) => request('/agent/turn', { method: 'POST', body: JSON.stringify(data) }),

  // ---- DEV-B endpoints below ----
  // DEV-A includes these stubs in Merge 1 so DEV-B can use them immediately.
  // DEV-B: do NOT add duplicate functions -- they are already here.

  // Nodes (DEV-B endpoints)
  createNode: (data) => request('/nodes', { method: 'POST', body: JSON.stringify(data) }),
  getNode: (id) => request(`/nodes/${id}`),

  // Pins (DEV-B endpoints)
  getPins: (branchId) => request(`/branches/${branchId}/pins`),
  createPin: (branchId, data) => request(`/branches/${branchId}/pins`, { method: 'POST', body: JSON.stringify(data) }),
  deletePin: (pinId) => request(`/pins/${pinId}`, { method: 'DELETE' }),

  // Imports (DEV-B endpoints)
  getImports: (branchId) => request(`/branches/${branchId}/imports`),
  createImport: (branchId, data) => request(`/branches/${branchId}/imports`, { method: 'POST', body: JSON.stringify(data) }),
  deleteImport: (importId) => request(`/imports/${importId}`, { method: 'DELETE' }),

  // Search (DEV-B endpoints)
  search: (q, userId, k = 20) => request(`/search?q=${encodeURIComponent(q)}&user_id=${userId}&k=${k}`),

  // Divergence (DEV-B endpoints)
  getDivergence: (branchA, branchB) => request(`/branches/${branchA}/diverge/${branchB}`),
};
```

### Router (`src/App.jsx`)

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ConversationList from './pages/ConversationList';
import ConversationView from './pages/ConversationView';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ConversationList />} />
        <Route path="/conversations/:id" element={<ConversationView />} />
        {/* DEV-B: add SearchPage route */}
      </Routes>
    </BrowserRouter>
  );
}
```

---

## ConversationList Page (30 min)

**Route:** `/`

**Behavior:**
- On mount, fetch conversations for a hardcoded user ID (or from localStorage)
- Display as a list: title, last updated time, branch count
- Click → navigate to `/conversations/:id`
- "New Conversation" button → create via API → navigate to the new one

**Layout:**
```
+------------------------------------------+
| Graft                    [New Conversation]|
|                                           |
| RecipeBox           3 branches  2min ago  |
| Auth Refactor       2 branches  1hr ago   |
| DB Migration Plan   1 branch   3hr ago    |
+------------------------------------------+
```

**Key shortcuts:**
- Hardcode `owner_id` to the first user from seed data (or a config constant)
- No auth system — just pass user ID around
- Minimal styling: Tailwind utility classes only

---

## ConversationView Page (1.5 hours)

**Route:** `/conversations/:id`

**This is the main workspace.** It has three parts: BranchSidebar, MessageThread, SendBox.

### Layout

```jsx
export default function ConversationView() {
  const { id } = useParams();
  const [conversation, setConversation] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [contextNodes, setContextNodes] = useState([]);

  // Fetch conversation + branches on mount
  // When branch selected, fetch context for that branch's head node

  return (
    <div className="flex h-screen">
      <BranchSidebar
        branches={conversation?.branches}
        selected={selectedBranch}
        onSelect={setSelectedBranch}
        onCreateBranch={handleCreateBranch}
      />
      <div className="flex-1 flex flex-col">
        <MessageThread
          nodes={contextNodes}
          onNodeAction={handleNodeAction}
        />
        {/* DEV-B: pins panel toggle */}
        <SendBox
          branchId={selectedBranch?.id}
          headNodeId={selectedBranch?.head_node_id}
          onMessageSent={handleMessageSent}
        />
      </div>
    </div>
  );
}
```

### BranchSidebar Component

**Props:** `branches`, `selected`, `onSelect`, `onCreateBranch`

**Display:**
- List of branch names with indicators:
  - `*` or highlight for selected branch
  - `(archived)` for archived branches (greyed out)
  - Fork info: "forked from main @ node #7"
- "New Branch" button at bottom → modal/prompt asking for name and fork-point

**Implementation:**
- Simple `<ul>` with click handlers
- Show `branch.name` and node count (if available)
- Selected branch gets a highlighted background
- Don't show archived branches by default (toggle if time allows)

### MessageThread Component

**Props:** `nodes` (from context assembly), `onNodeAction`

**Display:**
- Vertical list of messages, styled by role:
  - `system`: grey background, italic
  - `user`: right-aligned or blue background
  - `assistant`: left-aligned or white background
  - `summary`: yellow/amber background with "Summary" badge
- Each message shows: role badge, content (maybe truncated at 500 chars with expand), token count
- Source indicator: small tag showing "ancestor", "pinned", or "imported"

```jsx
function MessageBubble({ node }) {
  return (
    <div className={`p-3 rounded mb-2 ${roleStyles[node.role]}`}>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{node.role || node.source}</span>
        <span>{node.token_count} tokens</span>
      </div>
      <p className="mt-1">{node.content}</p>
      <div className="mt-1 flex gap-1">
        <span className="text-xs px-1 rounded bg-gray-200">{node.source}</span>
        {/* DEV-B: action buttons -- pin, import */}
      </div>
    </div>
  );
}
```

### SendBox Component

**Props:** `branchId`, `headNodeId`, `onMessageSent`

**Behavior:**
- Text input + Send button
- On send: call `api.sendMessage({node_id: headNodeId, user_message: text})`
- On response: call `onMessageSent(response)` which refreshes the message thread
- Disable while waiting for response, show loading indicator

---

## BranchCreate Flow (30 min)

When user clicks "New Branch":
1. Show a simple form: branch name input
2. Fork point = current branch's head node (or let user click a message to fork from there)
3. Call `api.createBranch(convId, {name, fork_node_id, created_by})`
4. On success: add new branch to sidebar, select it
5. Message thread shows the context up to the fork point

**Simplification:** For v1, always fork from the selected branch's head node. "Fork from specific message" is a nice-to-have.
