import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import TagPopover from "./TagPopover";
import { tagColor } from "../tagColor";

// Pins and imports are reference context, rendered at the top. The actual
// chat flow (ancestors) sits below in chronological order so the newest
// message lands at the very bottom — matching standard chat UX.
const SOURCE_ORDER = { pinned: 0, imported: 1, ancestor: 2 };

function orderForThread(nodes) {
  return [...nodes].sort((a, b) => {
    const sa = SOURCE_ORDER[a.source] ?? 9;
    const sb = SOURCE_ORDER[b.source] ?? 9;
    if (sa !== sb) return sa - sb;
    if (a.source === "ancestor" && b.source === "ancestor") {
      return (b.depth ?? 0) - (a.depth ?? 0);
    }
    return 0;
  });
}

export default function MessageThread({ nodes, onPin, onImport, onExportSynced, nodeTags = new Map(), onTagsChanged }) {
  const ordered = useMemo(() => orderForThread(nodes ?? []), [nodes]);
  const bottomRef = useRef(null);
  const [exportingId, setExportingId] = useState(null);
  const [exportResult, setExportResult] = useState(null);
  const [taggingNodeId, setTaggingNodeId] = useState(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [ordered]);

  async function handleExport(node) {
    if (!node.id) return;
    setExportingId(node.id);
    setExportResult(null);
    try {
      const r = await api.exportClaude(node.id, true);
      setExportResult(r);
      // If new turns came back from CC, the branch head moved — let the
      // parent refetch so the thread reflects the appended messages.
      if (r?.synced_from_claude > 0 && onExportSynced) onExportSynced();
    } catch (e) {
      setExportResult({ error: String(e) });
    } finally {
      setExportingId(null);
    }
  }

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

  if (!ordered.length) return <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Select a branch to see messages</div>;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 stagger">
      {ordered.map((n, i) => (
        <div key={n.id || i} className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:border-[var(--color-border-bright)] transition-colors">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${roleBadge(n.role || n.node_type)}`}>{n.role || n.node_type}</span>
            {n.source && <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${sourceBadge(n.source)}`}>{n.source}</span>}
            {(nodeTags.get(n.id) ?? []).map(t => (
              <span key={t.id} className={`text-[9px] px-1.5 py-0.5 rounded-full ${tagColor(t.name)}`}>{t.name}</span>
            ))}
            <span className="ml-auto text-[10px] font-[family-name:var(--font-mono)] text-[var(--color-text-faint)]">{n.token_count}tok</span>
          </div>
          {n._loading ? (
            <div className="flex gap-1 items-center py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-faint)] animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-dim)] leading-relaxed whitespace-pre-wrap">{n.content}</p>
          )}
          {!n._loading && (
            <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="relative">
                <button
                  onClick={() => setTaggingNodeId(taggingNodeId === n.id ? null : n.id)}
                  className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-violet)] px-2 py-0.5 rounded hover:bg-[var(--color-violet-dim)] transition-colors"
                >
                  Tag
                </button>
                {taggingNodeId === n.id && (
                  <TagPopover
                    nodeId={n.id}
                    onClose={() => setTaggingNodeId(null)}
                    onTagsChanged={onTagsChanged}
                  />
                )}
              </div>
              {onPin && <button onClick={() => onPin(n)} className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-amber)] px-2 py-0.5 rounded hover:bg-[var(--color-amber-dim)] transition-colors">Pin</button>}
              {onImport && <button onClick={() => onImport(n)} className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-emerald)] px-2 py-0.5 rounded hover:bg-[var(--color-emerald-dim)] transition-colors">Import to...</button>}
              <button
                onClick={() => handleExport(n)}
                disabled={exportingId === n.id}
                className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-blue)] px-2 py-0.5 rounded hover:bg-[var(--color-blue-dim)] transition-colors disabled:opacity-50"
              >
                {exportingId === n.id ? "Exporting…" : "→ Claude"}
              </button>
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />

      {exportResult && (
        <div className="fixed bottom-4 right-4 max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg z-50">
          {exportResult.error ? (
            <>
              <div className="text-sm font-semibold text-red-600 mb-1">Export failed</div>
              <div className="text-xs text-[var(--color-text-dim)] break-all">{exportResult.error}</div>
            </>
          ) : (
            <>
              <div className="text-sm font-semibold text-[var(--color-text)] mb-1">
                {exportResult.launched ? "Launched in Terminal" : "Export ready (run manually)"}
              </div>
              <div className="text-xs text-[var(--color-text-dim)] mb-2">
                {exportResult.message_count} messages → session{" "}
                <code className="font-[family-name:var(--font-mono)]">{exportResult.session_id?.slice(0, 8)}</code>
                {exportResult.synced_from_claude > 0 && (
                  <span className="ml-2 text-emerald-700">
                    · synced {exportResult.synced_from_claude} from Claude
                  </span>
                )}
              </div>
              {exportResult.launch_error && (
                <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-2 break-all">
                  Launch failed: {exportResult.launch_error}
                </div>
              )}
              <pre className="text-[10px] bg-black/5 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all">{exportResult.command}</pre>
            </>
          )}
          <button
            onClick={() => setExportResult(null)}
            className="mt-2 text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
