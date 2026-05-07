import { useState } from "react";
import { api, DEFAULT_USER_ID } from "../api";
import SearchResults from "../components/SearchResults";
import ImportModal from "../components/ImportModal";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.search(query, DEFAULT_USER_ID);
      setResults(data);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <a href="/" className="text-blue-600 text-sm hover:underline">
        &larr; Back to Conversations
      </a>
      <h1 className="text-xl font-semibold mt-4 mb-4">Search</h1>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          placeholder="Search across all conversations..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>
      {loading && <p className="mt-4 text-gray-500">Searching...</p>}
      <SearchResults
        results={results}
        onImport={(node) => setImportTarget(node)}
        onView={(node) =>
          (window.location.href = `/conversations/${node.conversation_id}`)
        }
      />
      {importTarget && (
        <ImportModal
          sourceNode={importTarget}
          conversationId={importTarget.conversation_id}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  );
}
