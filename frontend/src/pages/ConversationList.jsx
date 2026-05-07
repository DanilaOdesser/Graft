import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, DEFAULT_USER_ID } from "../api";

export default function ConversationList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.getConversations(DEFAULT_USER_ID)
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const conv = await api.createConversation({ title: title.trim(), owner_id: DEFAULT_USER_ID });
      navigate(`/conversations/${conv.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-8 animate-in">
      <div className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--color-text)]">Conversations</h1>
        <p className="text-[13px] text-[var(--color-text-faint)] mt-0.5">Your agent conversation workspaces</p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New conversation title..."
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)] focus:ring-2 focus:ring-[var(--color-blue-ring)] transition-all"
        />
        <button
          disabled={creating || !title.trim()}
          className="px-4 py-2 rounded-lg bg-[var(--color-blue)] text-white text-sm font-medium hover:brightness-95 disabled:opacity-40 transition-all"
        >
          {creating ? "Creating..." : "Create"}
        </button>
      </form>

      {loading ? (
        <div className="text-center py-16 text-[var(--color-text-faint)] text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-[var(--color-border)] rounded-xl">
          <p className="text-[var(--color-text-faint)] text-sm">No conversations yet</p>
          <p className="text-[var(--color-text-faint)] text-xs mt-1">Create one above to get started</p>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-xl overflow-hidden bg-[var(--color-surface)] stagger">
          {items.map((c, i) => (
            <Link
              key={c.id}
              to={`/conversations/${c.id}`}
              className={`flex items-center justify-between px-4 py-3 hover:bg-[var(--color-surface-2)] transition-colors ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}
            >
              <div>
                <div className="text-sm font-medium text-[var(--color-text)]">{c.title}</div>
                <div className="text-[11px] text-[var(--color-text-faint)] mt-0.5">
                  Updated {new Date(c.updated_at).toLocaleString()}
                </div>
              </div>
              <svg className="w-4 h-4 text-[var(--color-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
