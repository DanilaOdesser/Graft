import { useState } from "react";
import { api } from "../api";

export default function SendBox({ headNodeId, branchId, conversationId, onTurnComplete }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim() || !headNodeId) return;
    setSending(true);
    try {
      await api.agentTurn({ node_id: headNodeId, branch_id: branchId, user_message: message.trim(), budget: 4096 });
      setMessage("");
      onTurnComplete?.();
    } catch (err) { console.error("Send failed:", err); }
    setSending(false);
  };

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder={headNodeId ? "Send a message..." : "Select a branch first"}
          disabled={!headNodeId || sending}
          className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-blue)] focus:ring-2 focus:ring-[var(--color-blue-ring)] disabled:opacity-50 transition-all"
        />
        <button
          onClick={handleSend}
          disabled={!headNodeId || !message.trim() || sending}
          className="px-4 py-2 rounded-lg bg-[var(--color-blue)] text-white text-sm font-medium hover:brightness-95 disabled:opacity-40 transition-all"
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
