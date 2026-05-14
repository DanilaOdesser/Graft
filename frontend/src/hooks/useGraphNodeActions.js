import { useState, useRef } from "react";
import { api } from "../api";

/**
 * Manages state and handlers for the graph node detail panel:
 * node selection, branch creation from node, summarization, and tag editing.
 */
export default function useGraphNodeActions(conversationId, userId, { setSelected, setBranches }) {
  const [selectedGraphNode, setSelectedGraphNode] = useState(null);
  const [makingBranch, setMakingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [branchCreateError, setBranchCreateError] = useState("");
  const [makingSummary, setMakingSummary] = useState(false);
  const [summarizeBranchName, setSummarizeBranchName] = useState("");
  const [summarizeError, setSummarizeError] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [selectedNodeTags, setSelectedNodeTags] = useState([]);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const selectedGraphNodeRef = useRef(null);

  const handleGraphNodeSelect = (nodeData) => {
    setSelectedGraphNode(nodeData);
    selectedGraphNodeRef.current = nodeData;
    setShowTagEditor(false);
    setMakingBranch(false);
    setNewBranchName("");
    setBranchCreateError("");
    setMakingSummary(false);
    setSummarizeBranchName("");
    setSummarizeError("");
    if (nodeData?.id) {
      api.getNodeTags(nodeData.id)
        .then(tags => setSelectedNodeTags(Array.isArray(tags) ? tags : []))
        .catch(() => setSelectedNodeTags([]));
    }
  };

  const handleCreateBranchFromNode = async () => {
    if (!newBranchName.trim() || !selectedGraphNode) return;
    setBranchCreateError("");
    try {
      const br = await api.createBranch(conversationId, {
        name: newBranchName.trim(),
        fork_node_id: selectedGraphNode.id,
        created_by: userId,
      });
      if (br?.detail) {
        if (String(br.detail).toLowerCase().includes("already")) {
          setBranchCreateError("Branch name already exists.");
        } else {
          setBranchCreateError("Failed to create branch.");
        }
        return;
      }
      setSelected(br);
      setBranches((prev) => {
        const exists = prev.some((b) => b.id === br.id);
        return exists ? prev : [...prev, br];
      });
      setMakingBranch(false);
      setNewBranchName("");
    } catch {
      setBranchCreateError("Failed to create branch.");
    }
  };

  const handleSummarize = async () => {
    if (!summarizeBranchName.trim() || !selectedGraphNode) return;
    setSummarizeError("");
    setSummarizing(true);
    try {
      const res = await api.summarizeNode(selectedGraphNode.id, {
        branch_name: summarizeBranchName.trim(),
        created_by: userId,
      });
      if (res?.detail) {
        setSummarizeError(typeof res.detail === "string" ? res.detail : "Failed to summarize.");
        return;
      }
      if (res?.branch) {
        setSelected(res.branch);
        setBranches((prev) => {
          const exists = prev.some((b) => b.id === res.branch.id);
          return exists ? prev : [...prev, res.branch];
        });
      }
      setMakingSummary(false);
      setSummarizeBranchName("");
    } catch {
      setSummarizeError("Failed to summarize.");
    } finally {
      setSummarizing(false);
    }
  };

  return {
    selectedGraphNode, setSelectedGraphNode,
    makingBranch, setMakingBranch,
    newBranchName, setNewBranchName,
    branchCreateError, setBranchCreateError,
    makingSummary, setMakingSummary,
    summarizeBranchName, setSummarizeBranchName,
    summarizeError, setSummarizeError,
    summarizing,
    selectedNodeTags, setSelectedNodeTags,
    showTagEditor, setShowTagEditor,
    selectedGraphNodeRef,
    handleGraphNodeSelect,
    handleCreateBranchFromNode,
    handleSummarize,
  };
}
