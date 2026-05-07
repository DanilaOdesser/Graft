export default function MessageThread({ nodes, onPin, onImport }) {
  const roleBadge = (role) => ({
    user: "bg-blue-50 text-blue-700",
    assistant: "bg-emerald-50 text-emerald-700",
    system: "bg-amber-50 text-amber-700",
    summary: "bg-violet-50 text-violet-700",
  }[role] || "bg-gray-100 text-gray-600");

  const sourceBadge = (src) => ({
    ancestor: "bg-gray-100 text-gray-500",
    pinned: "bg-amber-50 text-amber-600",
    imported: "bg-violet-50 text-violet-600",
  }[src] || "bg-gray-100 text-gray-500");

  if (!nodes?.length) return <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Select a branch to see messages</div>;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 stagger">
      {nodes.map((n, i) => (
        <div key={n.id || i} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:border-[var(--color-border-bright)] transition-colors">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${roleBadge(n.role || n.node_type)}`}>{n.role || n.node_type}</span>
            {n.source && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sourceBadge(n.source)}`}>{n.source}</span>}
            <span className="ml-auto text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-faint)]">{n.token_count}tok</span>
          </div>
          <p className="text-sm text-[var(--color-text-dim)] leading-relaxed whitespace-pre-wrap">{n.content}</p>
          <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {onPin && <button onClick={() => onPin(n)} className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-amber)] px-2 py-0.5 rounded hover:bg-[var(--color-amber-dim)] transition-colors">Pin</button>}
            {onImport && <button onClick={() => onImport(n)} className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-emerald)] px-2 py-0.5 rounded hover:bg-[var(--color-emerald-dim)] transition-colors">Import to...</button>}
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
