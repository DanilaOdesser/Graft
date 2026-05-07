import { useState, useEffect } from "react";
import { api } from "../api";

export default function PinsPanel({ branchId, onClose }) {
  const [pins, setPins] = useState([]);

  useEffect(() => {
    if (branchId) {
      api.getPins(branchId).then(setPins);
    }
  }, [branchId]);

  const handleUnpin = async (pinId) => {
    await api.deletePin(pinId);
    setPins(pins.filter((p) => p.id !== pinId));
  };

  return (
    <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-[var(--color-amber-dim)] flex items-center justify-center">
            <svg className="w-3 h-3 text-[var(--color-amber)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.789l1.599.799L9 4.323V3a1 1 0 011-1z" />
            </svg>
          </div>
          <h3 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-text)]">
            Pinned Context
          </h3>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-text-faint)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Pin list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 stagger">
        {pins.length === 0 && (
          <div className="text-center py-8">
            <div className="text-2xl mb-2 opacity-20">◇</div>
            <p className="text-[11px] text-[var(--color-text-faint)]">
              No pins on this branch
            </p>
            <p className="text-[10px] text-[var(--color-text-faint)] mt-0.5">
              Pin important nodes to keep them in context
            </p>
          </div>
        )}

        {pins.map((pin) => (
          <div
            key={pin.id}
            className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 hover:border-[var(--color-border-bright)] transition-colors"
          >
            {/* Priority + reason */}
            <div className="flex items-center gap-2 mb-2">
              <span className="font-[family-name:var(--font-mono)] text-[10px] font-medium bg-[var(--color-amber-dim)] text-[var(--color-amber)] px-1.5 py-0.5 rounded">
                P:{pin.priority}
              </span>
              {pin.reason && (
                <span className="text-[11px] text-[var(--color-text-dim)] truncate">
                  {pin.reason}
                </span>
              )}
            </div>

            {/* Content preview */}
            <p className="text-xs text-[var(--color-text-faint)] leading-relaxed line-clamp-2 mb-2">
              {pin.node_content || "Loading..."}
            </p>

            {/* Unpin button */}
            <button
              onClick={() => handleUnpin(pin.id)}
              className="flex items-center gap-1 text-[11px] text-[var(--color-text-faint)] hover:text-[var(--color-red)] opacity-0 group-hover:opacity-100 transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Unpin
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
