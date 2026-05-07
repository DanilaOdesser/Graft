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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <h3 className="font-semibold text-lg">Import Node to Branch</h3>
        <p className="text-sm text-gray-500 mt-2 truncate">
          Source: &quot;{sourceNode.content?.slice(0, 80)}...&quot;
        </p>

        <div className="mt-4">
          <label className="text-sm font-medium block mb-1">
            Target branch:
          </label>
          <select
            className="w-full border rounded px-2 py-1"
            value={targetBranchId}
            onChange={(e) => setTargetBranchId(e.target.value)}
          >
            <option value="">Select a branch...</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm">
          <input
            type="checkbox"
            checked={includeDescendants}
            onChange={(e) => setIncludeDescendants(e.target.checked)}
          />
          Include descendants
        </label>

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!targetBranchId || importing}
            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
