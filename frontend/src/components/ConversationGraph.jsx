import { useMemo, useState, useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  NodeToolbar,
  useReactFlow,
} from "@xyflow/react";
import { api } from "../api";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

const NODE_W = 172;
const NODE_H = 48;

const branchPalette = [
  { main: "#2563eb", light: "#eff6ff", ring: "#bfdbfe" },
  { main: "#059669", light: "#ecfdf5", ring: "#a7f3d0" },
  { main: "#d97706", light: "#fffbeb", ring: "#fde68a" },
  { main: "#7c3aed", light: "#f5f3ff", ring: "#c4b5fd" },
  { main: "#dc2626", light: "#fef2f2", ring: "#fecaca" },
  { main: "#0891b2", light: "#ecfeff", ring: "#a5f3fc" },
  { main: "#c026d3", light: "#fdf4ff", ring: "#f0abfc" },
  { main: "#ea580c", light: "#fff7ed", ring: "#fed7aa" },
  { main: "#4f46e5", light: "#eef2ff", ring: "#a5b4fc" },
  { main: "#65a30d", light: "#f7fee7", ring: "#bef264" },
];

const roleIcons = { user: "U", assistant: "A", system: "S", summary: "\u03A3" };

// Amber for pins, violet for imports
const PIN_COLOR = "#d97706";
const IMPORT_COLOR = "#7c3aed";

function getColorForBranch(branchId, branchList) {
  const idx = branchList.findIndex((b) => b.id === branchId);
  return branchPalette[idx >= 0 ? idx % branchPalette.length : 0];
}

function buildTreeLayout(rawNodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 55, marginx: 20, marginy: 20 });
  rawNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  // Only feed tree edges (parent→child) to dagre — not import edges
  edges.filter((e) => e._treeEdge).forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rawNodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

function GraphNode({ data, selected }) {
  const c = data._colors;
  const icon = roleIcons[data.role] || roleIcons[data.node_type] || "?";
  const isHead = data._isHead;
  const isPinned = data._isPinned;
  const isImportSource = data._isImportSource;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />

      <NodeToolbar isVisible={data._hovered} position={Position.Right} offset={10}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 max-w-[280px] text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: c.main }}>
              {data.role || data.node_type}
            </span>
            <span className="text-[9px] font-mono text-gray-400">{data._branchName}</span>
            {isPinned && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: PIN_COLOR }}>
                📌 pinned on {data._pinnedOnBranches?.join(", ")}
              </span>
            )}
            {isImportSource && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: IMPORT_COLOR }}>
                ↗ imported by {data._importedByBranches?.join(", ")}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">
            {data.content?.slice(0, 280)}{data.content?.length > 280 ? "..." : ""}
          </p>
          <div className="flex gap-3 mt-2 text-[9px] text-gray-400">
            <span>{data.token_count} tok</span>
            <span className="font-mono">{data.id?.slice(0, 8)}</span>
          </div>
        </div>
      </NodeToolbar>

      <div
        className="rounded-lg border-2 px-2 py-1.5 text-left cursor-pointer transition-all duration-150"
        style={{
          width: NODE_W,
          background: selected ? c.light : "white",
          borderColor: selected ? c.main : isPinned ? PIN_COLOR : `${c.main}25`,
          boxShadow: selected
            ? `0 0 0 3px ${c.ring}`
            : isHead
            ? `0 2px 8px ${c.main}20`
            : "0 1px 3px rgba(0,0,0,0.04)",
          outline: isImportSource ? `2px dashed ${IMPORT_COLOR}40` : undefined,
          outlineOffset: "2px",
        }}
      >
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded flex items-center justify-center text-white text-[9px] font-bold shrink-0" style={{ background: c.main }}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-semibold text-gray-700 truncate">{data._label}</span>
              {isHead && (
                <span className="text-[7px] font-bold uppercase px-0.5 rounded text-white shrink-0" style={{ background: c.main }}>HD</span>
              )}
              {isPinned && (
                <span className="text-[8px] shrink-0" title={`Pinned on: ${data._pinnedOnBranches?.join(", ")}`}>📌</span>
              )}
              {isImportSource && (
                <span className="text-[8px] shrink-0" title={`Imported by: ${data._importedByBranches?.join(", ")}`}>↗</span>
              )}
            </div>
            <span className="text-[8px] text-gray-400 font-mono">{data._branchName}</span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />
    </>
  );
}

function SearchOverlay({ conversationId, userId, onNodeSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!query.trim()) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      try {
        const data = await api.search(query, userId, 20);
        const rows = Array.isArray(data) ? data : [];
        const filtered = rows.filter((r) => r.conversation_id === conversationId);
        setResults(filtered.slice(0, 8));
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, conversationId, userId]);

  const handleSelect = (r) => {
    onNodeSelect({ id: r.node_id, ...r });
    fitView({ nodes: [{ id: r.node_id }], padding: 0.4, duration: 300 });
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="absolute top-3 right-3 z-10 w-64">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (setOpen(false), setQuery(""))}
        placeholder="Search nodes\u2026"
        className="w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-white shadow-sm focus:outline-none focus:border-[var(--color-blue)] focus:ring-1 focus:ring-[var(--color-blue-ring)]"
      />
      {open && (
        <div className="mt-1 bg-white border border-[var(--color-border)] rounded-lg shadow-xl overflow-hidden">
          {results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-400">No matches in this conversation</div>
          ) : results.map((r) => (
            <button
              key={r.node_id}
              onClick={() => handleSelect(r)}
              className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-2)] border-b border-[var(--color-border)] last:border-0"
            >
              <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded text-white mr-1.5" style={{ background: "#6b7280" }}>
                {r.role || "?"}
              </span>
              <span className="text-[11px] text-gray-600">{(r.content || "").slice(0, 60)}\u2026</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { graphNode: GraphNode };

export default function ConversationGraph({
  allNodes, branches, pins = [], imports = [],
  onNodeSelect, selectedNodeId,
  conversationId, userId,
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  const branchMap = useMemo(() => {
    const m = new Map();
    branches.forEach((b) => m.set(b.id, b));
    return m;
  }, [branches]);

  const headNodeIds = useMemo(
    () => new Set(branches.map((b) => b.head_node_id).filter(Boolean)),
    [branches]
  );

  // node_id → array of branch names that pinned it
  const pinnedNodeMap = useMemo(() => {
    const m = new Map();
    pins.forEach((p) => {
      const brName = branchMap.get(p.branch_id)?.name || p.branch_id?.slice(0, 6);
      if (!m.has(p.node_id)) m.set(p.node_id, []);
      m.get(p.node_id).push(brName);
    });
    return m;
  }, [pins, branchMap]);

  // source_node_id → array of branch names that imported it
  const importSourceMap = useMemo(() => {
    const m = new Map();
    imports.forEach((imp) => {
      const brName = branchMap.get(imp.target_branch_id)?.name || imp.target_branch_id?.slice(0, 6);
      if (!m.has(imp.source_node_id)) m.set(imp.source_node_id, []);
      m.get(imp.source_node_id).push(brName);
    });
    return m;
  }, [imports, branchMap]);

  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!allNodes?.length) return { nodes: [], edges: [] };

    // PASS 1: Index ALL nodes by id (including uncommitted messages — needed for edge walking)
    const nodeDataMap = new Map();
    allNodes.forEach((n) => {
      if (nodeDataMap.has(n.id)) return;
      nodeDataMap.set(n.id, n);
    });

    // The graph is a commit graph: only summary nodes and the root system node are visible.
    // Uncommitted messages live in the thread view and don't appear here.
    const isVisible = (n) => n.node_type === "summary" || !n.parent_id;
    const visibleIds = new Set();
    nodeDataMap.forEach((n) => { if (isVisible(n)) visibleIds.add(n.id); });

    // Walk up parent chain to find the nearest visible ancestor of a given node.
    const findVisibleAncestor = (startId) => {
      let cur = nodeDataMap.get(startId);
      while (cur?.parent_id) {
        const parent = nodeDataMap.get(cur.parent_id);
        if (!parent) break;
        if (visibleIds.has(parent.id)) return parent;
        cur = parent;
      }
      return null;
    };

    // PASS 2: Build flow nodes for visible nodes only
    const flowNodeList = [];
    nodeDataMap.forEach((n) => {
      if (!isVisible(n)) return;

      const br = branchMap.get(n.branch_id);
      const branchName = br?.name || "?";
      const colors = getColorForBranch(n.branch_id, branches);
      const isHead = headNodeIds.has(n.id);
      const pinnedOnBranches = pinnedNodeMap.get(n.id);
      const importedByBranches = importSourceMap.get(n.id);

      // Summary nodes: use commit message (first line). Root: use first words.
      const rawLabel = n.node_type === "summary"
        ? (n.content || "").split("\n")[0]
        : (n.content || "").split(/\s+/).slice(0, 5).join(" ");
      const label = rawLabel.length > 32 ? rawLabel.slice(0, 32) + "\u2026" : rawLabel;

      flowNodeList.push({
        id: n.id,
        type: "graphNode",
        data: {
          ...n,
          _branchName: branchName,
          _colors: colors,
          _isHead: isHead,
          _label: label,
          _hovered: false,
          _isPinned: !!pinnedOnBranches,
          _pinnedOnBranches: pinnedOnBranches || [],
          _isImportSource: !!importedByBranches,
          _importedByBranches: importedByBranches || [],
        },
        position: { x: 0, y: 0 },
      });
    });

    // PASS 3: Build tree edges between visible nodes.
    // A commit node's parent_id points to the last message node before it, not the
    // previous commit. Walk up the parent chain to find the nearest visible ancestor.
    const edges = [];
    nodeDataMap.forEach((n) => {
      if (!isVisible(n) || !n.parent_id) return;

      const visibleParent = visibleIds.has(n.parent_id)
        ? nodeDataMap.get(n.parent_id)
        : findVisibleAncestor(n.id);
      if (!visibleParent) return;

      const isFork = visibleParent.branch_id !== n.branch_id;
      const colors = getColorForBranch(n.branch_id, branches);

      edges.push({
        id: `e-${visibleParent.id}-${n.id}`,
        source: visibleParent.id,
        target: n.id,
        type: "smoothstep",
        animated: isFork,
        _treeEdge: true,
        style: {
          stroke: colors.main,
          strokeWidth: isFork ? 1.5 : 2,
          strokeDasharray: isFork ? "6 4" : undefined,
          opacity: 0.75,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 8,
          height: 8,
          color: colors.main,
        },
      });
    });

    // PASS 4: Build import edges (source_node → importing branch HEAD, both must be visible)
    imports.forEach((imp) => {
      const targetBranch = branchMap.get(imp.target_branch_id);
      const targetHead = targetBranch?.head_node_id;
      if (!targetHead || !visibleIds.has(imp.source_node_id) || !visibleIds.has(targetHead)) return;
      if (imp.source_node_id === targetHead) return;

      edges.push({
        id: `import-${imp.id}`,
        source: imp.source_node_id,
        target: targetHead,
        type: "smoothstep",
        animated: true,
        _treeEdge: false,
        label: "imported",
        labelStyle: { fontSize: 8, fill: IMPORT_COLOR },
        labelBgStyle: { fill: "white", fillOpacity: 0.85 },
        style: {
          stroke: IMPORT_COLOR,
          strokeWidth: 1.5,
          strokeDasharray: "4 3",
          opacity: 0.6,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 7,
          height: 7,
          color: IMPORT_COLOR,
        },
      });
    });

    const laidOut = buildTreeLayout(flowNodeList, edges);
    return { nodes: laidOut, edges };
  }, [allNodes, branchMap, branches, headNodeIds, pinnedNodeMap, importSourceMap, imports]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => {
    setNodes(
      flowNodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...n.data, _hovered: n.id === hoveredNode },
      }))
    );
  }, [flowNodes, selectedNodeId, hoveredNode, setNodes]);

  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  const handleNodeClick = useCallback((_, node) => onNodeSelect?.(node.data), [onNodeSelect]);
  const handleMouseEnter = useCallback((_, node) => setHoveredNode(node.id), []);
  const handleMouseLeave = useCallback(() => setHoveredNode(null), []);
  const minimapColor = useCallback((node) => node.data?._colors?.main || "#d4d4d4", []);

  if (!allNodes?.length) {
    return <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">No nodes to display</div>;
  }

  return (
    <div className="flex-1 bg-[var(--color-bg)] overflow-hidden relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleMouseEnter}
        onNodeMouseLeave={handleMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e5e5" gap={20} size={1} />
        <Controls showInteractive={false} className="!bg-white !border-[var(--color-border)] !shadow-sm !rounded-lg" />
        <MiniMap nodeColor={minimapColor} nodeStrokeWidth={2} pannable zoomable
          className="!bg-white/90 !border-[var(--color-border)] !shadow-sm !rounded-lg"
          style={{ width: 140, height: 90 }} />
        {conversationId && userId && (
          <SearchOverlay
            conversationId={conversationId}
            userId={userId}
            onNodeSelect={onNodeSelect}
          />
        )}
      </ReactFlow>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 flex flex-wrap gap-x-3 gap-y-1 max-w-xs">
        {branches.map((b) => {
          const c = getColorForBranch(b.id, branches);
          return (
            <div key={b.id} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ background: c.main }} />
              <span className="text-[9px] text-gray-600 font-medium">{b.name}</span>
            </div>
          );
        })}
        {pins.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[9px]">📌</span>
            <span className="text-[9px] text-gray-500">pinned</span>
          </div>
        )}
        {imports.length > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold" style={{ color: IMPORT_COLOR }}>↗</span>
            <span className="text-[9px] text-gray-500">imported</span>
          </div>
        )}
      </div>
    </div>
  );
}
