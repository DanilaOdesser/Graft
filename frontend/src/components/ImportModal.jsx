import { useState, useEffect } from "react";
import { api, DEFAULT_USER_ID } from "../api";

export default function ImportModal({ sourceNode, conversationId, onClose }) {
  const [branches, setBranches] = useState([]);
  const [targetBranchId, setTargetBranchId] = useState("");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (conversationId) {
      api.getConversation(conversationId).then((conv) => setBranches(conv.branches || [])).catch(() => {});
    }
  }, [conversationId]);

  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
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
    } catch (err) { console.error("Import failed:", err); }
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-in" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div className="relative w-[400px] mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
          <h3 className="font-[family-name:var(--font-display)] font-bold text-sm">Cherry-pick Node</h3>
          <button onClick={onClose} className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-faint)] hover:bg-[var(--color-surface-2)]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-[var(--color-surface-2)] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] font-semibold mb-1">Source</div>
            <p className="text-xs text-[var(--color-text-dim)] line-clamp-2">{sourceNode.content?.slice(0, 120)}...</p>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-dim)] block mb-1.5">Target branch</label>
            <select className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm focus:outline-none focus:border-[var(--color-blue)] focus:ring-2 focus:ring-[var(--color-blue-ring)]" value={targetBranchId} onChange={(e) => setTargetBranchId(e.target.value)}>
              <option value="">Select a branch...</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer text-sm text-[var(--color-text)]">
            <input type="checkbox" checked={includeDescendants} onChange={(e) => setIncludeDescendants(e.target.checked)} className="rounded border-[var(--color-border)]" />
            Include descendants
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-border)]">
          <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]">Cancel</button>
          <button onClick={handleImport} disabled={!targetBranchId || importing} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-emerald)] text-white hover:brightness-95 disabled:opacity-40 transition-all">
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
