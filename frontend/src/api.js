const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

export const DEFAULT_USER_ID = "2f75cca7-7ebc-5af0-a919-f0bfe59e4125"; // uuid5("u-alex")

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (options.method === "DELETE") return res;
  return res.json();
}

export const api = {
  // DEV-A endpoints
  getConversations: (ownerId) =>
    request(`/conversations?owner_id=${ownerId}`),
  getConversation: (id) =>
    request(`/conversations/${id}`),
  createConversation: (data) =>
    request("/conversations", { method: "POST", body: JSON.stringify(data) }),
  getBranch: (id) =>
    request(`/branches/${id}`),
  createBranch: (convId, data) =>
    request(`/conversations/${convId}/branches`, { method: "POST", body: JSON.stringify(data) }),
  archiveBranch: (id) =>
    request(`/branches/${id}/archive`, { method: "POST" }),
  getContext: (nodeId, budget) =>
    request(`/nodes/${nodeId}/context?budget=${budget}`),
  agentTurn: (data) =>
    request("/agent/turn", { method: "POST", body: JSON.stringify(data) }),
  exportClaude: (nodeId, launch = true) =>
    request(`/nodes/${nodeId}/export-claude?launch=${launch}`, { method: "POST" }),
  syncClaude: (branchId) =>
    request(`/branches/${branchId}/sync-claude`, { method: "POST" }),

  // DEV-B endpoints
  createNode: (data) =>
    request("/nodes", { method: "POST", body: JSON.stringify(data) }),
  getNode: (id) =>
    request(`/nodes/${id}`),
  getConversationNodes: (convId) =>
    request(`/conversations/${convId}/nodes`),
  search: (q, userId, k = 20, tag = null) => {
    const params = new URLSearchParams({ q, user_id: userId, k: String(k) });
    if (tag) params.append("tag", tag);
    return request(`/search?${params.toString()}`);
  },
  getDivergence: (branchA, branchB) =>
    request(`/branches/${branchA}/diverge/${branchB}`),
  createPin: (branchId, data) =>
    request(`/branches/${branchId}/pins`, { method: "POST", body: JSON.stringify(data) }),
  getPins: (branchId) =>
    request(`/branches/${branchId}/pins`),
  deletePin: (pinId) =>
    request(`/pins/${pinId}`, { method: "DELETE" }),
  createImport: (branchId, data) =>
    request(`/branches/${branchId}/imports`, { method: "POST", body: JSON.stringify(data) }),
  getImports: (branchId) =>
    request(`/branches/${branchId}/imports`),
  deleteImport: (importId) =>
    request(`/imports/${importId}`, { method: "DELETE" }),
  commitBranch: (branchId, data) =>
    request(`/branches/${branchId}/commit`, { method: "POST", body: JSON.stringify(data) }),
  summarizeNode: (nodeId, data) =>
    request(`/nodes/${nodeId}/summarize`, { method: "POST", body: JSON.stringify(data) }),
  registerUser: (data) =>
    request("/users/register", { method: "POST", body: JSON.stringify(data) }),
  loginUser: (data) =>
    request("/users/login", { method: "POST", body: JSON.stringify(data) }),
  getTags: () =>
    request("/tags"),
  createTag: (name) =>
    request("/tags", { method: "POST", body: JSON.stringify({ name }) }),
  getNodeTags: (nodeId) =>
    request(`/nodes/${nodeId}/tags`),
  setNodeTags: (nodeId, tagIds) =>
    request(`/nodes/${nodeId}/tags`, { method: "PUT", body: JSON.stringify({ tag_ids: tagIds }) }),
};
