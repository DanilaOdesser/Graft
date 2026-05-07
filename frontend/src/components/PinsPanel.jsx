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
    <div className="w-64 border-l p-4 overflow-y-auto bg-white">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-sm">Pinned Context</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xs"
        >
          close
        </button>
      </div>
      {pins.length === 0 && (
        <p className="text-xs text-gray-400">No pins on this branch.</p>
      )}
      {pins.map((pin) => (
        <div key={pin.id} className="border rounded p-2 mb-2">
          <div className="flex justify-between text-xs">
            <span className="font-mono bg-blue-100 px-1 rounded">
              P:{pin.priority}
            </span>
          </div>
          {pin.reason && (
            <p className="text-xs text-gray-500 mt-1">{pin.reason}</p>
          )}
          <p className="text-xs mt-1 truncate">
            {pin.node_content || "Loading..."}
          </p>
          <button
            onClick={() => handleUnpin(pin.id)}
            className="text-xs text-red-500 hover:text-red-700 mt-1"
          >
            Unpin
          </button>
        </div>
      ))}
    </div>
  );
}
