export default function SearchResults({ results, onImport, onView }) {
  if (!results.length) return null;

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-gray-500">{results.length} results</p>
      {results.map((r) => (
        <div key={r.node_id} className="border rounded p-3">
          <p className="text-sm">
            {r.content.slice(0, 200)}
            {r.content.length > 200 ? "..." : ""}
          </p>
          <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
            <span>
              {r.role} &middot; {r.branch_name} &middot; {r.conversation_title}
            </span>
            <span>Relevance: {r.rank.toFixed(2)}</span>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onView(r)}
              className="text-xs text-blue-600 hover:underline"
            >
              View in context
            </button>
            <button
              onClick={() => onImport(r)}
              className="text-xs text-green-600 hover:underline"
            >
              Import to...
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
