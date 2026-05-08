import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import SearchResults from "../components/SearchResults";
import ImportModal from "../components/ImportModal";

export default function SearchPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await api.search(query, user.id);
      setResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Search failed:", err);
      setResults([]);
    }
    setLoading(false);
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--color-text)] mb-1">Search</h1>
          <p className="text-[13px] text-[var(--color-text-faint)] mb-4">Find nodes across all conversations</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-faint)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)] focus:ring-2 focus:ring-[var(--color-blue-ring)] transition-all"
                placeholder="Search conversations... (e.g. recipe, auth, pagination)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-5 py-2 rounded-lg bg-[var(--color-blue)] text-white text-sm font-medium hover:brightness-95 disabled:opacity-40 transition-all"
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-5 h-5 border-2 border-[var(--color-blue)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!loading && searched && results.length === 0 && (
          <div className="text-center py-12 text-[var(--color-text-faint)] text-sm">No results for &ldquo;{query}&rdquo;</div>
        )}
        {!loading && results.length > 0 && (
          <SearchResults results={results} query={query} onImport={(n) => setImportTarget(n)} onView={(n) => (window.location.href = `/conversations/${n.conversation_id}`)} />
        )}
        {!loading && !searched && (
          <div className="text-center py-12 text-[var(--color-text-faint)] text-sm">Type a query and press Enter</div>
        )}
      </div>
      {importTarget && <ImportModal sourceNode={importTarget} conversationId={importTarget.conversation_id} onClose={() => setImportTarget(null)} />}
    </div>
  );
}
