import { useState } from "react";

export default function BranchSidebar({
  branches = [],
  selectedId,
  onSelect,
  onCreate,
}) {
  const [name, setName] = useState("");
  const [showForm, setShowForm] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim());
    setName("");
    setShowForm(false);
  }

  return (
    <aside className="w-64 border-r bg-white flex flex-col">
      <div className="p-3 border-b text-xs font-semibold text-gray-500 uppercase">
        Branches
      </div>
      <ul className="flex-1 overflow-y-auto">
        {branches.map((b) => {
          const active = b.id === selectedId;
          return (
            <li key={b.id}>
              <button
                onClick={() => onSelect(b)}
                className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-gray-50 ${
                  active ? "bg-blue-50 font-medium" : ""
                }`}
              >
                <span className="block">{b.name}</span>
                {b.base_node_id && (
                  <span className="text-xs text-gray-400">
                    forked @ {b.base_node_id.slice(0, 8)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t p-3">
        {showForm ? (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="branch name"
              className="border rounded px-2 py-1 text-sm"
              autoFocus
            />
            <div className="flex gap-2">
              <button className="flex-1 px-2 py-1 bg-blue-600 text-white text-sm rounded">
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-2 py-1 text-sm rounded border"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full px-2 py-1 text-sm border rounded hover:bg-gray-50"
          >
            + New branch
          </button>
        )}
      </div>
    </aside>
  );
}
