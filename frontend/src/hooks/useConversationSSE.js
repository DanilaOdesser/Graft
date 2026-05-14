import { useEffect } from "react";

/**
 * Subscribes to SSE events for a conversation and updates state via setters.
 * Handles all 8 event types: node_created, branch_updated, pin_created,
 * pin_deleted, import_created, import_deleted, commit_created, node_tags_updated.
 */
export default function useConversationSSE(conversationId, {
  setBranches,
  setSelected,
  setAllNodes,
  setAllPins,
  setAllImports,
  setSelectedNodeTags,
  selectedGraphNodeRef,
}) {
  useEffect(() => {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";
    const es = new EventSource(`${API_URL}/conversations/${conversationId}/stream`);

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
      const { node, branch, summarized_node_ids = [] } = JSON.parse(e.data);
      setAllNodes((prev) => {
        const filtered = prev.filter((n) => !summarized_node_ids.includes(n.id));
        return filtered.some((n) => n.id === node.id) ? filtered : [...filtered, node];
      });
      setBranches((prev) => prev.map((b) => (b.id === branch.id ? branch : b)));
      setSelected((prev) => (prev?.id === branch.id ? branch : prev));
    });

    es.addEventListener("node_tags_updated", (e) => {
      const { node_id, tags } = JSON.parse(e.data);
      if (node_id === selectedGraphNodeRef.current?.id) {
        setSelectedNodeTags(Array.isArray(tags) ? tags : []);
      }
    });

    es.onerror = () => { /* SSE auto-reconnects; suppress console noise */ };

    return () => es.close();
  }, [conversationId]);
}
