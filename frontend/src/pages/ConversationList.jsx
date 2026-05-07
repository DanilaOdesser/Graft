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
      .then(setItems)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const conv = await api.createConversation({
        title: title.trim(),
        owner_id: DEFAULT_USER_ID,
      });
      navigate(`/conversations/${conv.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Conversations</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New conversation title…"
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          disabled={creating || !title.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-500">No conversations yet.</p>
      ) : (
        <ul className="divide-y border rounded bg-white">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={`/conversations/${c.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-gray-500">
                  Updated {new Date(c.updated_at).toLocaleString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
