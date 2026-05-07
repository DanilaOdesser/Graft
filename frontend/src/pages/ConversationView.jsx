import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, DEFAULT_USER_ID } from "../api";
import BranchSidebar from "../components/BranchSidebar";
import MessageThread from "../components/MessageThread";
import SendBox from "../components/SendBox";
import PinsPanel from "../components/PinsPanel";
import ConversationGraph from "../components/ConversationGraph";
import ImportModal from "../components/ImportModal";

export default function ConversationView() {
  const { id } = useParams();
  const [conv, setConv] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [contextNodes, setContextNodes] = useState([]);
  const [allNodes, setAllNodes] = useState([]);
  const [showPins, setShowPins] = useState(false);
  const [showImports, setShowImports] = useState(false);
  const [imports, setImports] = useState([]);
  const [tab, setTab] = useState("thread");
  const [importTarget, setImportTarget] = useState(null);
  const [pinningNode, setPinningNode] = useState(null);
  const [pinPriority, setPinPriority] = useState(5);
  const [pinReason, setPinReason] = useState("");
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);

  // Load conversation + branches
  useEffect(() => {
    api.getConversation(id).then((data) => {
      setConv(data);
      const br = data.branches || [];
      setBranches(br);
      if (br.length > 0) setSelected(br[0]);
    }).catch(() => {});
  }, [id]);

  // Fetch context for selected branch (thread view)
  const refreshContext = useCallback(() => {
    if (!selected?.head_node_id) return;
    api.getContext(selected.head_node_id, 8000).then((data) => {
      setContextNodes(Array.isArray(data) ? data : data?.nodes || []);
    }).catch(() => setContextNodes([]));
  }, [selected]);

  useEffect(() => { refreshContext(); }, [refreshContext]);

  const [allPins, setAllPins] = useState([]);
  const [allImports, setAllImports] = useState([]);

  // Fetch ALL nodes + pins + imports for the graph view
  const refreshAllNodes = useCallback(() => {
    api.getConversationNodes(id)
      .then((data) => setAllNodes(Array.isArray(data) ? data : []))
      .catch(() => setAllNodes([]));
  }, [id]);

  const refreshPinsAndImports = useCallback(() => {
    if (!branches.length) return;
    Promise.all(branches.map((b) => api.getPins(b.id).catch(() => [])))
      .then((results) => setAllPins(results.flat()));
    Promise.all(branches.map((b) => api.getImports(b.id).catch(() => [])))
      .then((results) => setAllImports(results.flat()));
  }, [branches]);

  useEffect(() => { refreshAllNodes(); }, [refreshAllNodes]);
  useEffect(() => { refreshPinsAndImports(); }, [refreshPinsAndImports]);

  // SSE live updates
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
    const es = new EventSource(`${API_URL}/conversations/${id}/stream`);

    es.addEventListener("node_created", (e) => {
      const { node } = JSON.parse(e.data);
      setAllNodes((prev) => prev.some((n) => n.id === node.id) ? prev : [...prev, node]);
    });

    es.addEventListener("branch_updated", (e) => {
      const { branch } = JSON.parse(e.data);
      setBranches((prev) => {
        const exists = prev.some((b) => b.id === branch.id);
        return exists
          ? prev.map((b) => (b.id === branch.id ? branch : b))
          : [...prev, branch];
      });
      setSelected((prev) => (prev?.id === branch.id ? branch : prev));
    });

    es.addEventListener("pin_created", (e) => {
      const { pin } = JSON.parse(e.data);
      setAllPins((prev) => prev.some((p) => p.id === pin.id) ? prev : [...prev, pin]);
    });

    es.addEventListener("pin_deleted", (e) => {
      const { pin_id } = JSON.parse(e.data);
      setAllPins((prev) => prev.filter((p) => p.id !== pin_id));
    });

    es.addEventListener("import_created", (e) => {
      const { import: imp } = JSON.parse(e.data);
      setAllImports((prev) => prev.some((i) => i.id === imp.id) ? prev : [...prev, imp]);
    });

    es.addEventListener("import_deleted", (e) => {
      const { import_id } = JSON.parse(e.data);
      setAllImports((prev) => prev.filter((i) => i.id !== import_id));
    });

    es.addEventListener("commit_created", (e) => {
      const { node, branch } = JSON.parse(e.data);
      setAllNodes((prev) => prev.some((n) => n.id === node.id) ? prev : [...prev, node]);
      setBranches((prev) => prev.map((b) => (b.id === branch.id ? branch : b)));
      setSelected((prev) => (prev?.id === branch.id ? branch : prev));
    });

    es.onerror = () => { /* SSE auto-reconnects; suppress console noise */ };

    return () => es.close();
  }, [id]);

  // Imports
  const refreshImports = useCallback(() => {
    if (!selected?.id) return;
    api.getImports(selected.id).then((data) => setImports(Array.isArray(data) ? data : [])).catch(() => setImports([]));
  }, [selected]);

  useEffect(() => { if (showImports) refreshImports(); }, [showImports, refreshImports]);

  const handleCreateBranch = async (name) => {
    if (!selected?.head_node_id) return;
    const br = await api.createBranch(id, { name, fork_node_id: selected.head_node_id, created_by: DEFAULT_USER_ID });
    setBranches((prev) => [...prev, br]);
    setSelected(br);
  };

  const handleArchiveBranch = async (branchId) => {
    await api.archiveBranch(branchId);
    setBranches((prev) => prev.filter((b) => b.id !== branchId));
    if (selected?.id === branchId) setSelected(branches[0] || null);
  };

  const handleTurnComplete = () => {
    refreshContext();   // still needed for thread view; SSE handles branch/node state
  };

  const handlePin = async () => {
    if (!pinningNode || !selected) return;
    await api.createPin(selected.id, {
      node_id: pinningNode.id,
      priority: pinPriority,
      reason: pinReason,
      pinned_by: DEFAULT_USER_ID,
    });
    setPinningNode(null);
    setPinPriority(5);
    setPinReason("");
  };

  const handleDeleteImport = async (impId) => {
    await api.deleteImport(impId);
    setImports((prev) => prev.filter((i) => i.id !== impId));
  };

  const handleGraphNodeSelect = (nodeData) => {
    setSelectedGraphNode(nodeData);
  };

  if (!conv) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left sidebar */}
      <BranchSidebar
        branches={branches}
        selected={selected}
        onSelect={setSelected}
        onCreate={handleCreateBranch}
        onArchive={handleArchiveBranch}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="h-11 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-4 gap-3 shrink-0">
          <Link to="/" className="text-[var(--color-text-faint)] hover:text-[var(--color-text)] text-xs">
            &larr; Back
          </Link>
          <span className="text-sm font-medium text-[var(--color-text)] truncate">{conv.title}</span>

          <div className="ml-auto flex items-center gap-1">
            {["thread", "graph"].map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSelectedGraphNode(null); if (t === "graph") { refreshAllNodes(); refreshPinsAndImports(); } }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-[var(--color-blue-dim)] text-[var(--color-blue)]"
                    : "text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                }`}
              >
                {t === "thread" ? "Thread" : "Graph"}
              </button>
            ))}
            <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
            <button
              onClick={() => { setShowPins(!showPins); setShowImports(false); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                showPins
                  ? "bg-[var(--color-amber-dim)] text-[var(--color-amber)]"
                  : "text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
              }`}
            >
              Pins
            </button>
            <button
              onClick={() => { setShowImports(!showImports); setShowPins(false); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                showImports
                  ? "bg-[var(--color-violet-dim)] text-[var(--color-violet)]"
                  : "text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
              }`}
            >
              Imports
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0">
            {tab === "thread" ? (
              <>
                <MessageThread
                  nodes={contextNodes}
                  onPin={(node) => setPinningNode(node)}
                  onImport={(node) => setImportTarget(node)}
                />
                <SendBox
                  headNodeId={selected?.head_node_id}
                  branchId={selected?.id}
                  conversationId={id}
                  onTurnComplete={handleTurnComplete}
                />
              </>
            ) : (
              <ConversationGraph
                allNodes={allNodes}
                branches={branches}
                pins={allPins}
                imports={allImports}
                onNodeSelect={handleGraphNodeSelect}
                selectedNodeId={selectedGraphNode?.id}
              />
            )}
          </div>

          {/* Graph detail panel (right side, only in graph tab) */}
          {tab === "graph" && selectedGraphNode && (
            <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-y-auto shrink-0 animate-in">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <h3 className="text-xs font-semibold text-[var(--color-text)]">Node Details</h3>
                <button
                  onClick={() => setSelectedGraphNode(null)}
                  className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Meta */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white"
                      style={{ background: selectedGraphNode._branchColor }}
                    >
                      {selectedGraphNode.role || selectedGraphNode.node_type}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--color-text-faint)]">
                      {selectedGraphNode._branchName}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[var(--color-text-faint)]">
                    <span>ID: <span className="font-mono">{selectedGraphNode.id?.slice(0, 12)}...</span></span>
                    <span>{selectedGraphNode.token_count} tokens</span>
                    {selectedGraphNode.source && <span>Source: {selectedGraphNode.source}</span>}
                    {selectedGraphNode.depth != null && <span>Depth: {selectedGraphNode.depth}</span>}
                  </div>
                </div>

                {/* Content */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] font-semibold mb-1.5">Content</div>
                  <div className="rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] p-3 max-h-64 overflow-y-auto">
                    <p className="text-xs text-[var(--color-text-dim)] leading-relaxed whitespace-pre-wrap">
                      {selectedGraphNode.content}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-faint)] font-semibold mb-2">Actions</div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={() => setPinningNode(selectedGraphNode)}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-dim)] hover:border-[var(--color-amber)] hover:text-[var(--color-amber)] hover:bg-[var(--color-amber-dim)] transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.789l1.599.799L9 4.323V3a1 1 0 011-1z" />
                      </svg>
                      Pin to current branch
                    </button>
                    <button
                      onClick={() => setImportTarget(selectedGraphNode)}
                      className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-dim)] hover:border-[var(--color-emerald)] hover:text-[var(--color-emerald)] hover:bg-[var(--color-emerald-dim)] transition-colors text-left"
                    >
                      <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Import to another branch
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pins panel */}
          {showPins && selected && (
            <PinsPanel branchId={selected.id} onClose={() => setShowPins(false)} />
          )}

          {/* Imports panel */}
          {showImports && selected && (
            <div className="w-64 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
                <h3 className="text-xs font-semibold text-[var(--color-text)]">Imports</h3>
                <button onClick={() => setShowImports(false)} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="p-2 space-y-1.5">
                {imports.length === 0 && (
                  <p className="text-[11px] text-[var(--color-text-faint)] text-center py-4">No imports on this branch</p>
                )}
                {imports.map((imp) => (
                  <div key={imp.id} className="group rounded-lg border border-[var(--color-border)] p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--color-violet)]">
                        {imp.include_descendants ? "subtree" : "node"}
                      </span>
                      <button
                        onClick={() => handleDeleteImport(imp.id)}
                        className="text-[var(--color-text-faint)] hover:text-[var(--color-red)] opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <p className="text-[var(--color-text-faint)] mt-1 truncate">{imp.source_node_id?.slice(0, 8)}...</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pin creation dialog */}
      {pinningNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-in" onClick={(e) => e.target === e.currentTarget && setPinningNode(null)}>
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <div className="relative w-[360px] mx-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl shadow-xl">
            <div className="px-5 py-3.5 border-b border-[var(--color-border)]">
              <h3 className="font-[family-name:var(--font-display)] font-bold text-sm">Pin Node</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg bg-[var(--color-surface-2)] p-2.5">
                <p className="text-xs text-[var(--color-text-dim)] line-clamp-2">{pinningNode.content?.slice(0, 100)}...</p>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-dim)] block mb-1">Priority (0-10)</label>
                <input
                  type="number" min={0} max={10} value={pinPriority}
                  onChange={(e) => setPinPriority(Number(e.target.value))}
                  className="w-20 px-2 py-1.5 rounded border border-[var(--color-border)] text-sm focus:outline-none focus:border-[var(--color-blue)]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-dim)] block mb-1">Reason (optional)</label>
                <input
                  value={pinReason} onChange={(e) => setPinReason(e.target.value)}
                  placeholder="Why pin this?"
                  className="w-full px-3 py-1.5 rounded border border-[var(--color-border)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)]"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--color-border)]">
              <button onClick={() => setPinningNode(null)} className="px-3 py-1.5 rounded-lg text-sm text-[var(--color-text-dim)] hover:bg-[var(--color-surface-2)]">Cancel</button>
              <button onClick={handlePin} className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-amber)] text-white hover:brightness-95">Pin</button>
            </div>
          </div>
        </div>
      )}

      {importTarget && (
        <ImportModal sourceNode={importTarget} conversationId={id} onClose={() => setImportTarget(null)} />
      )}
    </div>
  );
}
