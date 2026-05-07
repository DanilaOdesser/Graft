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
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

const NODE_W = 180;
const NODE_H = 52;

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

function getColorForBranch(branchId, branchList) {
  const idx = branchList.findIndex((b) => b.id === branchId);
  return branchPalette[idx >= 0 ? idx % branchPalette.length : 0];
}

function buildTreeLayout(rawNodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 30,
    ranksep: 65,
    marginx: 30,
    marginy: 30,
    align: "UL",
  });
  rawNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rawNodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

/* ── Custom Node ───────────────────────────────────────────── */

function GraphNode({ data, selected }) {
  const c = data._colors;
  const icon = roleIcons[data.role] || roleIcons[data.node_type] || "?";
  const isHead = data._isHead;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />

      {/* Hover tooltip */}
      <NodeToolbar isVisible={data._hovered} position={Position.Right} offset={12}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3.5 max-w-[300px] text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: c.main }}>
              {data.role || data.node_type}
            </span>
            <span className="text-[9px] font-mono text-gray-400">{data._branchName}</span>
            {isHead && <span className="text-[8px] font-bold px-1 py-0.5 rounded text-white" style={{ background: c.main }}>HEAD</span>}
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed whitespace-pre-wrap">
            {data.content?.slice(0, 300)}{data.content?.length > 300 ? "..." : ""}
          </p>
          <div className="flex gap-3 mt-2 text-[9px] text-gray-400">
            <span>{data.token_count} tok</span>
            <span className="font-mono">{data.id?.slice(0, 8)}</span>
          </div>
        </div>
      </NodeToolbar>

      {/* Node body */}
      <div
        className="rounded-lg border-2 px-2.5 py-1.5 text-left cursor-pointer transition-all duration-150"
        style={{
          width: NODE_W,
          background: selected ? c.light : "white",
          borderColor: selected ? c.main : `${c.main}25`,
          boxShadow: selected
            ? `0 0 0 3px ${c.ring}`
            : isHead
            ? `0 2px 8px ${c.main}18`
            : "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Icon circle */}
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{ background: c.main }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-semibold text-gray-700 truncate">{data._label}</span>
              {isHead && (
                <span className="text-[7px] font-bold uppercase px-1 rounded text-white shrink-0" style={{ background: c.main }}>
                  HEAD
                </span>
              )}
            </div>
            <span className="text-[9px] text-gray-400 font-mono">{data._branchName}</span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />
    </>
  );
}

const nodeTypes = { graphNode: GraphNode };

/* ── Main Component ────────────────────────────────────────── */

export default function ConversationGraph({ allNodes, branches, onNodeSelect, selectedNodeId }) {
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

  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!allNodes?.length) return { nodes: [], edges: [] };

    const nodeMap = new Map();
    const edges = [];

    // Sort by created_at so the tree builds in order
    const sorted = [...allNodes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    sorted.forEach((n) => {
      if (nodeMap.has(n.id)) return;

      const br = branchMap.get(n.branch_id);
      const branchName = br?.name || "?";
      const colors = getColorForBranch(n.branch_id, branches);
      const isHead = headNodeIds.has(n.id);

      // Short label from content
      const words = (n.content || "").split(/\s+/).slice(0, 4).join(" ");
      const label = words.length > 30 ? words.slice(0, 30) + "..." : words;

      nodeMap.set(n.id, {
        id: n.id,
        type: "graphNode",
        data: {
          ...n,
          _branchName: branchName,
          _colors: colors,
          _isHead: isHead,
          _label: label,
          _hovered: false,
        },
        position: { x: 0, y: 0 },
      });

      // Edge to parent — this is what builds the TREE
      if (n.parent_id && nodeMap.has(n.parent_id)) {
        const parentBranchId = sorted.find((p) => p.id === n.parent_id)?.branch_id;
        const isFork = parentBranchId && parentBranchId !== n.branch_id;

        edges.push({
          id: `e-${n.parent_id}-${n.id}`,
          source: n.parent_id,
          target: n.id,
          type: "smoothstep",
          animated: isFork,
          style: {
            stroke: colors.main,
            strokeWidth: isFork ? 1.5 : 2,
            strokeDasharray: isFork ? "6 4" : undefined,
            opacity: 0.7,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 8,
            height: 8,
            color: colors.main,
          },
        });
      }
    });

    const rawNodes = Array.from(nodeMap.values());
    const laidOut = buildTreeLayout(rawNodes, edges);
    return { nodes: laidOut, edges };
  }, [allNodes, branchMap, branches, headNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  // Sync layout + hover + selection
  useEffect(() => {
    setNodes(
      flowNodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...n.data, _hovered: n.id === hoveredNode },
      }))
    );
  }, [flowNodes, selectedNodeId, hoveredNode, setNodes]);

  const handleNodeClick = useCallback((_, node) => {
    onNodeSelect?.(node.data);
  }, [onNodeSelect]);

  const handleMouseEnter = useCallback((_, node) => setHoveredNode(node.id), []);
  const handleMouseLeave = useCallback(() => setHoveredNode(null), []);

  const minimapColor = useCallback((node) => node.data?._colors?.main || "#d4d4d4", []);

  if (!allNodes?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">
        No nodes to display
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--color-bg)] overflow-hidden">
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
        <Controls
          showInteractive={false}
          className="!bg-white !border-[var(--color-border)] !shadow-sm !rounded-lg"
        />
        <MiniMap
          nodeColor={minimapColor}
          nodeStrokeWidth={2}
          pannable
          zoomable
          className="!bg-white/90 !border-[var(--color-border)] !shadow-sm !rounded-lg"
          style={{ width: 160, height: 110 }}
        />
      </ReactFlow>

      {/* Branch legend */}
      <div className="absolute bottom-3 left-3 bg-white/90 backdrop-blur border border-[var(--color-border)] rounded-lg px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 max-w-xs">
        {branches.map((b) => {
          const c = getColorForBranch(b.id, branches);
          return (
            <div key={b.id} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: c.main }} />
              <span className="text-[10px] text-gray-600 font-medium">{b.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
