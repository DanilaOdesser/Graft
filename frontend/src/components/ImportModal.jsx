import { useState, useEffect } from "react";
import { api, DEFAULT_USER_ID } from "../api";

export default function ImportModal({ sourceNode, conversationId, onClose }) {
  const [branches, setBranches] = useState([]);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (conversationId) {
      api.getConversation(conversationId).then((conv) => {
        setBranches(conv.branches || []);
      });
    }
  }, [conversationId]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleImport = async () => {
    if (!targetBranchId) return;
    setImporting(true);
    try {
      await api.createImport(targetBranchId, {
        source_node_id: sourceNode.node_id || sourceNode.id,
        include_descendants: includeDescendants,
        imported_by: DEFAULT_USER_ID,
      });
      onClose();
    } catch (err) {
      console.error("Import failed:", err);
    }
    setImporting(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-[420px] mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-2xl shadow-black/50 animate-slide-down">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--color-emerald-dim)] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-[var(--color-emerald)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </div>
            <h3 className="font-[family-name:var(--font-display)] font-bold text-[var(--color-text)]">
              Cherry-pick Node
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Source preview */}
          <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] mb-1.5 font-semibold">Source</div>
            <p className="text-sm text-[var(--color-text-dim)] leading-relaxed line-clamp-2">
              {sourceNode.content?.slice(0, 120)}...
            </p>
          </div>

          {/* Branch selector */}
          <div>
            <label className="text-xs font-semibold text-[var(--color-text-dim)] uppercase tracking-wider block mb-2">
              Target branch
            </label>
            <select
              className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-cyan)] focus:shadow-[0_0_0_3px_var(--color-cyan-dim)] transition-all appearance-none cursor-pointer"
              value={targetBranchId}
              onChange={(e) => setTargetBranchId(e.target.value)}
            >
              <option value="">Select a branch...</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Include descendants */}
          <label className="flex items-center gap-3 py-2 cursor-pointer group">
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
              includeDescendants
                ? "bg-[var(--color-emerald)] border-[var(--color-emerald)]"
                : "border-[var(--color-border-bright)] group-hover:border-[var(--color-text-dim)]"
            }`}>
              {includeDescendants && (
                <svg className="w-3 h-3 text-[var(--color-bg)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <input
              type="checkbox"
              className="sr-only"
              checked={includeDescendants}
              onChange={(e) => setIncludeDescendants(e.target.checked)}
            />
            <div>
              <span className="text-sm text-[var(--color-text)]">Include descendants</span>
              <span className="block text-[11px] text-[var(--color-text-faint)]">Import the entire subtree below this node</span>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!targetBranchId || importing}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--color-emerald)] text-[var(--color-bg)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-[var(--color-emerald-dim)]"
          >
            {importing ? (
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Importing...
              </span>
            ) : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
