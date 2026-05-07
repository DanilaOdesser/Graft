import { useState, useEffect } from "react";
import { api } from "../api";

export default function PinsPanel({ branchId, onClose }) {
  const [pins, setPins] = useState([]);

  useEffect(() => {
    if (branchId) api.getPins(branchId).then((d) => setPins(Array.isArray(d) ? d : [])).catch(() => setPins([]));
  }, [branchId]);

  const handleUnpin = async (pinId) => {
    await api.deletePin(pinId);
    setPins(pins.filter((p) => p.id !== pinId));
  };

  return (
    <div className="w-64 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--color-border)]">
        <h3 className="text-xs font-semibold text-[var(--color-text)]">Pinned Context</h3>
        <button onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {pins.length === 0 && <p className="text-[11px] text-[var(--color-text-faint)] text-center py-4">No pins on this branch</p>}
        {pins.map((pin) => (
          <div key={pin.id} className="group rounded-lg border border-[var(--color-border)] p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="font-[family-name:var(--font-mono)] text-[10px] font-medium bg-[var(--color-amber-dim)] text-[var(--color-amber)] px-1.5 py-0.5 rounded">P:{pin.priority}</span>
              {pin.reason && <span className="text-[10px] text-[var(--color-text-faint)] truncate">{pin.reason}</span>}
            </div>
            <p className="text-[11px] text-[var(--color-text-dim)] line-clamp-2">{pin.node_content || "..."}</p>
            <button onClick={() => handleUnpin(pin.id)} className="text-[10px] text-[var(--color-text-faint)] hover:text-[var(--color-red)] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Unpin</button>
          </div>
        ))}
      </div>
    </div>
  );
}
