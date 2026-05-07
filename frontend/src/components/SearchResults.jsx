export default function SearchResults({ results, query, onImport, onView }) {
  if (!results.length) return null;

  const roleBadge = (role) => ({
    user: "bg-blue-50 text-blue-700",
    assistant: "bg-emerald-50 text-emerald-700",
    system: "bg-amber-50 text-amber-700",
  }[role] || "bg-gray-50 text-gray-700");

  return (
    <div className="animate-in">
      <p className="text-xs text-[var(--color-text-dim)] mb-3">
        <span className="font-[family-name:var(--font-mono)] text-[var(--color-blue)]">{results.length}</span> result{results.length !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
      </p>
      <div className="space-y-2 stagger">
        {results.map((r) => (
          <div key={r.node_id} className="group border border-[var(--color-border)] rounded-xl bg-[var(--color-surface)] p-4 hover:border-[var(--color-border-bright)] hover:shadow-sm transition-all">
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${roleBadge(r.role)}`}>{r.role}</span>
              <span className="text-[11px] text-[var(--color-text-faint)] font-[family-name:var(--font-mono)]">{r.branch_name}</span>
              <span className="text-[var(--color-text-faint)]">&middot;</span>
              <span className="text-[11px] text-[var(--color-text-faint)]">{r.conversation_title}</span>
              <span className="ml-auto text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-faint)]">{r.rank.toFixed(2)}</span>
            </div>
            <p className="text-sm text-[var(--color-text-dim)] leading-relaxed mb-3">{r.content.slice(0, 200)}{r.content.length > 200 ? "..." : ""}</p>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => onView(r)} className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-blue)] px-2 py-1 rounded hover:bg-[var(--color-blue-dim)] transition-colors">View in context</button>
              <button onClick={() => onImport(r)} className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-emerald)] px-2 py-1 rounded hover:bg-[var(--color-emerald-dim)] transition-colors">Import to...</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
