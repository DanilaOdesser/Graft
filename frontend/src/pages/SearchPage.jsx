import { useState } from "react";
import { api, DEFAULT_USER_ID } from "../api";
import SearchResults from "../components/SearchResults";
import ImportModal from "../components/ImportModal";

export default function SearchPage() {
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
      const data = await api.search(query, DEFAULT_USER_ID);
      setResults(data);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setLoading(false);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Search header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-[var(--color-text)] mb-1">
            Search
          </h1>
          <p className="text-sm text-[var(--color-text-dim)] mb-5">
            Find nodes across all your conversations
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1 group">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-faint)] group-focus-within:text-[var(--color-cyan)] transition-colors"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] text-sm font-[family-name:var(--font-body)] focus:outline-none focus:border-[var(--color-cyan)] focus:shadow-[0_0_0_3px_var(--color-cyan-dim)] transition-all duration-200"
                placeholder="Search across all conversations... (e.g. recipe, pagination, auth)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              className="px-5 py-2.5 rounded-lg bg-[var(--color-cyan)] text-[var(--color-bg)] font-semibold text-sm hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shrink-0"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Searching
                </span>
              ) : "Search"}
            </button>
          </div>
          {/* Hints */}
          <div className="flex gap-2 mt-3">
            {["recipe", "authentication", "pagination"].map((hint) => (
              <button
                key={hint}
                onClick={() => { setQuery(hint); }}
                className="text-[11px] font-[family-name:var(--font-mono)] text-[var(--color-text-faint)] bg-[var(--color-surface-2)] px-2 py-0.5 rounded border border-[var(--color-border)] hover:border-[var(--color-border-bright)] hover:text-[var(--color-text-dim)] transition-colors"
              >
                {hint}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-6">
        {loading && (
          <div className="flex items-center justify-center py-16 animate-fade-in">
            <div className="flex items-center gap-3 text-[var(--color-text-dim)]">
              <div className="w-5 h-5 border-2 border-[var(--color-cyan)] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Searching across conversations...</span>
            </div>
          </div>
        )}

        {!loading && searched && results.length === 0 && (
          <div className="text-center py-16 animate-fade-in">
            <div className="text-3xl mb-3 opacity-30">∅</div>
            <p className="text-[var(--color-text-dim)] text-sm">No results found for &ldquo;{query}&rdquo;</p>
            <p className="text-[var(--color-text-faint)] text-xs mt-1">Try different keywords or check your spelling</p>
          </div>
        )}

        {!loading && results.length > 0 && (
          <SearchResults
            results={results}
            query={query}
            onImport={(node) => setImportTarget(node)}
            onView={(node) =>
              (window.location.href = `/conversations/${node.conversation_id}`)
            }
          />
        )}

        {!loading && !searched && (
          <div className="text-center py-16 animate-fade-in">
            <div className="text-4xl mb-4 opacity-20">⌘</div>
            <p className="text-[var(--color-text-faint)] text-sm">
              Type a query and press Enter to search
            </p>
          </div>
        )}
      </div>

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
