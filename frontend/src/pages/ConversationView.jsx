import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, DEFAULT_USER_ID } from "../api";
import BranchSidebar from "../components/BranchSidebar";
import MessageThread from "../components/MessageThread";
import SendBox from "../components/SendBox";
import PinsPanel from "../components/PinsPanel";

export default function ConversationView() {
  const { id } = useParams();
  const [conv, setConv] = useState(null);
  const [branches, setBranches] = useState([]);
  const [selected, setSelected] = useState(null);
  const [contextNodes, setContextNodes] = useState([]);
  const [loadingContext, setLoadingContext] = useState(false);
  const [showPins, setShowPins] = useState(false);

  // Initial conversation fetch
  useEffect(() => {
    api.getConversation(id).then((c) => {
      setConv(c);
      setBranches(c.branches || []);
      const main = (c.branches || []).find((b) => b.name === "main") || c.branches?.[0];
      setSelected(main || null);
    });
  }, [id]);

  // When the selected branch's head changes, refetch the context.
  const refreshContext = useCallback(async () => {
    if (!selected?.head_node_id) {
      setContextNodes([]);
      return;
    }
    setLoadingContext(true);
    try {
      const rows = await api.getContext(selected.head_node_id, 4096);
      setContextNodes(rows);
    } finally {
      setLoadingContext(false);
    }
  }, [selected?.head_node_id]);

  useEffect(() => {
    refreshContext();
  }, [refreshContext]);

  async function handleCreateBranch(name) {
    if (!selected?.head_node_id) return;
    const created = await api.createBranch(id, {
      name,
      fork_node_id: selected.head_node_id,
      created_by: DEFAULT_USER_ID,
    });
    setBranches((bs) => [...bs, created]);
    setSelected(created);
  }

  async function handleTurnComplete() {
    // Branch head has advanced server-side; refetch.
    const fresh = await api.getBranch(selected.id);
    setSelected(fresh);
    setBranches((bs) => bs.map((b) => (b.id === fresh.id ? fresh : b)));
  }

  if (!conv) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="flex h-[calc(100vh-2.5rem)]">
      <BranchSidebar
        branches={branches}
        selectedId={selected?.id}
        onSelect={setSelected}
        onCreate={handleCreateBranch}
      />
      <section className="flex-1 flex flex-col">
        <header className="border-b bg-white px-4 py-2 flex justify-between items-center">
          <div>
            <div className="font-medium">{conv.title}</div>
            {selected && (
              <div className="text-xs text-gray-500">on {selected.name}</div>
            )}
          </div>
          <button
            onClick={() => setShowPins((s) => !s)}
            className="text-xs px-2 py-1 border rounded hover:bg-gray-50"
          >
            {showPins ? "Hide pins" : "Show pins"}
          </button>
        </header>
        <MessageThread nodes={contextNodes} loading={loadingContext} />
        <SendBox
          branchId={selected?.id}
          headNodeId={selected?.head_node_id}
          onTurnComplete={handleTurnComplete}
        />
      </section>
      {showPins && selected && (
        <PinsPanel branchId={selected.id} />
      )}
    </div>
  );
}
