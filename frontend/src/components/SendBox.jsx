import { useState } from "react";
import { api } from "../api";

export default function SendBox({ headNodeId, onTurnComplete, disabled }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || !headNodeId) return;
    setSending(true);
    try {
      const result = await api.agentTurn({
        node_id: headNodeId,
        user_message: text.trim(),
        budget: 4096,
      });
      onTurnComplete(result);
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="border-t bg-white p-3 flex gap-2">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Send a message…"
        disabled={disabled || sending || !headNodeId}
        className="flex-1 border rounded px-3 py-2"
      />
      <button
        disabled={disabled || sending || !text.trim() || !headNodeId}
        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {sending ? "…" : "Send"}
      </button>
    </form>
  );
}
