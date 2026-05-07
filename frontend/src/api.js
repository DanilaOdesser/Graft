// Shared API client. Both DEV-A and DEV-B import from here; only DEV-A edits.
//
// During dev, the Vite proxy forwards /api/* to http://localhost:8000.
// In prod, set VITE_API_URL to the Render backend URL at build time.

const BASE = import.meta.env.VITE_API_URL || ''

// Deterministic UUID for seed user "u-alex" (uuid5 of NAMESPACE + "u-alex").
// This lets the frontend run against seed data without an auth flow for v1.
export const DEFAULT_USER_ID = '2f75cca7-7ebc-5af0-a919-f0bfe59e4125'

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

// ============================================================================
// DEV-A endpoints
// ============================================================================

export const conversations = {
  create: ({ title, owner_id = DEFAULT_USER_ID }) =>
    request('/api/conversations', { method: 'POST', body: { title, owner_id } }),

  list: ({ owner_id = DEFAULT_USER_ID } = {}) =>
    request('/api/conversations', { query: { owner_id } }),

  get: (id) => request(`/api/conversations/${id}`),
}

export const branches = {
  create: ({ conv_id, name, fork_node_id, created_by = DEFAULT_USER_ID }) =>
    request(`/api/conversations/${conv_id}/branches`, {
      method: 'POST',
      body: { name, fork_node_id, created_by },
    }),

  get: (id) => request(`/api/branches/${id}`),

  archive: (id) =>
    request(`/api/branches/${id}/archive`, { method: 'POST' }),
}

export const nodes = {
  context: (node_id, budget = 4096) =>
    request(`/api/nodes/${node_id}/context`, { query: { budget } }),
}

export const agent = {
  turn: ({ node_id, user_message, budget = 4096 }) =>
    request('/api/agent/turn', {
      method: 'POST',
      body: { node_id, user_message, budget },
    }),
}

// ============================================================================
// DEV-B endpoints (stubs — DEV-B implements the backend; do not edit these
// signatures without coordinating)
// ============================================================================

export const nodesEdit = {
  create: ({ branch_id, parent_id, role, content }) =>
    request('/api/nodes', {
      method: 'POST',
      body: { branch_id, parent_id, role, content },
    }),

  get: (id) => request(`/api/nodes/${id}`),
}

export const pins = {
  create: ({ branch_id, node_id, reason, priority = 0,
             pinned_by = DEFAULT_USER_ID }) =>
    request(`/api/branches/${branch_id}/pins`, {
      method: 'POST',
      body: { node_id, reason, priority, pinned_by },
    }),

  remove: (id) => request(`/api/pins/${id}`, { method: 'DELETE' }),
}

export const imports = {
  create: ({ target_branch_id, source_node_id, include_descendants = false,
             imported_by = DEFAULT_USER_ID }) =>
    request(`/api/branches/${target_branch_id}/imports`, {
      method: 'POST',
      body: { source_node_id, include_descendants, imported_by },
    }),

  remove: (id) => request(`/api/imports/${id}`, { method: 'DELETE' }),
}

export const search = {
  run: ({ q, k = 10 }) =>
    request('/api/search', { query: { q, k } }),

  diverge: (a, b) => request(`/api/branches/${a}/diverge/${b}`),
}

// ============================================================================
// health (sanity-check during dev)
// ============================================================================

export const health = () => request('/health')
