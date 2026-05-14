import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import { tagColor, tagDotColor } from "../tagColor";

export default function TagPopover({ nodeId, onClose, onTagsChanged, inline = false }) {
  const popoverRef = useRef(null);
  const inputRef = useRef(null);

  const [allTags, setAllTags] = useState([]);
  const [appliedIds, setAppliedIds] = useState(new Set());
  const [inputValue, setInputValue] = useState("");

  // Fetch all tags and node's current tags on mount
  useEffect(() => {
    Promise.all([api.getTags(), api.getNodeTags(nodeId)])
      .then(([tags, nodeTags]) => {
        setAllTags(Array.isArray(tags) ? tags : []);
        setAppliedIds(new Set((Array.isArray(nodeTags) ? nodeTags : []).map((t) => t.id)));
      })
      .catch(() => {});
  }, [nodeId]);

  // Autofocus the input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape (only when not inline)
  useEffect(() => {
    if (inline) return;
    const handleKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, inline]);

  // Close on click outside (only when not inline)
  useEffect(() => {
    if (inline) return;
    const handleMouseDown = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose, inline]);

  const normalizedInput = inputValue.trim().toLowerCase();

  const filteredTags = allTags.filter((tag) =>
    tag.name.toLowerCase().includes(normalizedInput)
  );

  const exactMatch = allTags.some(
    (tag) => tag.name.toLowerCase() === normalizedInput
  );
  const showCreateOption = normalizedInput.length > 0 && !exactMatch;

  const handleToggle = async (tag) => {
    const newSet = new Set(appliedIds);
    if (newSet.has(tag.id)) {
      newSet.delete(tag.id);
    } else {
      newSet.add(tag.id);
    }
    setAppliedIds(newSet);

    const updatedTags = await api.setNodeTags(nodeId, [...newSet]);
    onTagsChanged(nodeId, Array.isArray(updatedTags) ? updatedTags : []);
  };

  const handleCreate = async () => {
    if (!normalizedInput) return;
    try {
      const newTag = await api.createTag(inputValue.trim());
      setAllTags((prev) => [...prev, newTag]);

      const newSet = new Set(appliedIds);
      newSet.add(newTag.id);
      setAppliedIds(newSet);

      const updatedTags = await api.setNodeTags(nodeId, [...newSet]);
      onTagsChanged(nodeId, Array.isArray(updatedTags) ? updatedTags : []);
      setInputValue("");
    } catch (err) {
      console.error("Failed to create tag:", err);
    }
  };

  return (
    <div
      ref={popoverRef}
      className={inline
        ? "w-full bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-2 mt-1"
        : "absolute z-[200] w-52 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-2"
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder="Filter or create tag..."
        className="border border-[var(--color-border)] rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-[var(--color-blue)]"
      />
      <div className="mt-1 max-h-48 overflow-y-auto">
        {filteredTags.map((tag) => {
          const colorClass = tagDotColor(tag.name);
          const applied = appliedIds.has(tag.id);
          return (
            <div
              key={tag.id}
              onClick={() => handleToggle(tag)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-[var(--color-surface-2)] rounded"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} />
              <span className="truncate text-[var(--color-text)]">{tag.name}</span>
              {applied && (
                <span className="ml-auto text-[var(--color-blue)]">✓</span>
              )}
            </div>
          );
        })}
        {showCreateOption && (
          <div
            onClick={handleCreate}
            className="flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer hover:bg-[var(--color-surface-2)] rounded text-[var(--color-text-faint)] italic"
          >
            Create &apos;{inputValue.trim()}&apos;
          </div>
        )}
        {filteredTags.length === 0 && !showCreateOption && (
          <p className="text-[11px] text-[var(--color-text-faint)] text-center py-2">
            No tags found
          </p>
        )}
      </div>
    </div>
  );
}
