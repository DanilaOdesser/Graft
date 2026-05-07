export default function SearchResults({ results, query, onImport, onView }) {
  if (!results.length) return null;

  const roleBadge = (role) => {
    const styles = {
      user: "bg-[var(--color-cyan-dim)] text-[var(--color-cyan)]",
      assistant: "bg-[var(--color-violet-dim)] text-[var(--color-violet)]",
      system: "bg-[var(--color-amber-dim)] text-[var(--color-amber)]",
    };
    return styles[role] || styles.system;
  };

  const relevanceBar = (rank) => {
    const pct = Math.min(rank * 100, 100);
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-1 rounded-full bg-[var(--color-surface-3)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--color-cyan)] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-text-faint)]">
          {rank.toFixed(2)}
        </span>
      </div>
    );
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--color-text-dim)]">
          <span className="font-[family-name:var(--font-mono)] text-[var(--color-cyan)]">{results.length}</span>
          {" "}result{results.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
        </p>
      </div>

      <div className="space-y-3 stagger">
        {results.map((r) => (
          <div
            key={r.node_id}
            className="group border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)] p-4 hover:border-[var(--color-border-bright)] hover:bg-[var(--color-surface-2)] transition-all duration-200"
          >
            {/* Header row */}
            <div className="flex items-center gap-2 mb-2.5">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${roleBadge(r.role)}`}>
                {r.role}
              </span>
              <span className="text-[11px] text-[var(--color-text-faint)] font-[family-name:var(--font-mono)]">
                {r.branch_name}
              </span>
              <span className="text-[var(--color-text-faint)]">&middot;</span>
              <span className="text-[11px] text-[var(--color-text-faint)]">
                {r.conversation_title}
              </span>
              <div className="ml-auto">
                {relevanceBar(r.rank)}
              </div>
            </div>

            {/* Content */}
            <p className="text-sm text-[var(--color-text-dim)] leading-relaxed mb-3">
              {r.content.slice(0, 220)}
              {r.content.length > 220 && (
                <span className="text-[var(--color-text-faint)]">...</span>
              )}
            </p>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <button
                onClick={() => onView(r)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-cyan)] px-2.5 py-1 rounded-md hover:bg-[var(--color-cyan-dim)] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                View in context
              </button>
              <button
                onClick={() => onImport(r)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)] hover:text-[var(--color-emerald)] px-2.5 py-1 rounded-md hover:bg-[var(--color-emerald-dim)] transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Import to...
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
