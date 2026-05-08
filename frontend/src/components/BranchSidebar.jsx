import { useState } from "react";
import { api } from "../api";

export default function BranchSidebar({ branches, selected, onSelect, onCreate, onArchive, isHeadSummary, onCommit }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setName("");
    setShowForm(false);
  };

  const handleCommit = async () => {
    if (!commitMsg.trim() || !selected?.id) return;
    setCommitting(true);
    try {
      await api.commitBranch(selected.id, { commit_message: commitMsg.trim() });
      setCommitMsg("");
      onCommit?.();
    } catch (err) { console.error("Commit failed:", err); }
    setCommitting(false);
  };

  return (
    <div className="w-52 border-r border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
        <h3 className="text-xs font-semibold text-[var(--color-text)]">Branches</h3>
        <button onClick={() => setShowForm(!showForm)} className="w-5 h-5 rounded flex items-center justify-center text-[var(--color-text-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="p-2 border-b border-[var(--color-border)]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch name" autoFocus className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-xs placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)]" />
          <div className="flex gap-1 mt-1.5">
            <button type="submit" className="flex-1 py-1 rounded text-[10px] font-medium bg-[var(--color-blue)] text-white">Fork</button>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-1 rounded text-[10px] text-[var(--color-text-faint)] hover:bg-[var(--color-surface-2)]">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {branches.map((b) => (
          <div
            key={b.id}
            className={`group flex items-center justify-between px-2.5 py-2 rounded-md cursor-pointer text-xs transition-colors ${
              selected?.id === b.id
                ? "bg-[var(--color-blue-dim)] text-[var(--color-blue)]"
                : "text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]"
            }`}
            onClick={() => onSelect(b)}
          >
            <div className="min-w-0">
              <div className="font-medium truncate">{b.name}</div>
              {b.base_node_id && <div className="text-[10px] text-[var(--color-text-faint)] font-[family-name:var(--font-mono)] truncate">fork:{b.base_node_id?.slice(0, 8)}</div>}
            </div>
            {onArchive && b.name !== "main" && (
              <button onClick={(e) => { e.stopPropagation(); onArchive(b.id); }} className="opacity-0 group-hover:opacity-100 text-[var(--color-text-faint)] hover:text-[var(--color-red)] transition-opacity" title="Archive">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Commit section */}
      <div className="border-t border-[var(--color-border)] p-2 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-faint)] px-1">Commit</div>
        <input
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleCommit()}
          placeholder={isHeadSummary ? "Nothing to commit" : "Commit message..."}
          disabled={!selected?.id || committing || isHeadSummary}
          className="w-full px-2 py-1.5 rounded border border-[var(--color-border)] text-xs placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[#d97706] focus:ring-1 focus:ring-[#fde68a] disabled:opacity-50 transition-all"
        />
        <button
          onClick={handleCommit}
          disabled={!selected?.id || !commitMsg.trim() || committing || isHeadSummary}
          title={isHeadSummary ? "Nothing to commit — HEAD is already a commit node" : "Commit recent messages"}
          className="w-full py-1.5 rounded text-[10px] font-medium bg-[#d97706] text-white hover:brightness-95 disabled:opacity-40 transition-all"
        >
          {committing ? "Committing..." : "Commit"}
        </button>
      </div>
    </div>
  );
}
