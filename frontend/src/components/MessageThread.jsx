const ROLE_STYLES = {
  system: "bg-gray-100 italic text-gray-600",
  user: "bg-blue-50 border-l-4 border-blue-400",
  assistant: "bg-white border-l-4 border-emerald-400",
  summary: "bg-amber-50 border-l-4 border-amber-400",
};

const SOURCE_BADGE = {
  ancestor: "bg-gray-200 text-gray-700",
  pinned: "bg-amber-200 text-amber-800",
  imported: "bg-purple-200 text-purple-800",
};

export default function MessageThread({ nodes = [], loading }) {
  if (loading) {
    return <div className="p-6 text-gray-500">Loading context…</div>;
  }
  if (!nodes.length) {
    return (
      <div className="p-6 text-gray-500">
        No messages yet. Send one below to start the conversation.
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-3">
      {nodes.map((n) => (
        <div
          key={n.id}
          className={`rounded p-3 ${ROLE_STYLES[n.role || ""] || "bg-white border"}`}
        >
          <div className="flex justify-between text-xs text-gray-500">
            <span>{n.role || "—"}</span>
            <span>{n.token_count} tok</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap">{n.content}</p>
          <div className="mt-2 flex gap-1 items-center">
            <span
              className={`text-xs px-2 py-0.5 rounded ${
                SOURCE_BADGE[n.source] || "bg-gray-200"
              }`}
            >
              {n.source}
            </span>
            {/* DEV-B: action buttons -- pin, import */}
          </div>
        </div>
      ))}
    </div>
  );
}
