import { useState } from "react";
import { api } from "../api";

/**
 * Manages Claude Code sync state and provides the sync handler.
 * Returns { syncing, syncToast, handleSyncClaude }.
 */
export default function useSyncClaude(selected, onTurnComplete) {
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState(null);

  const handleSyncClaude = async () => {
    if (!selected || syncing) return;
    setSyncing(true);
    setSyncToast(null);
    try {
      const r = await api.syncClaude(selected.id);
      setSyncToast({ count: r.synced_from_claude });
      if (r.synced_from_claude > 0) onTurnComplete();
      setTimeout(() => setSyncToast(null), 3500);
    } catch (e) {
      setSyncToast({ error: String(e) });
    } finally {
      setSyncing(false);
    }
  };

  return { syncing, syncToast, handleSyncClaude };
}
