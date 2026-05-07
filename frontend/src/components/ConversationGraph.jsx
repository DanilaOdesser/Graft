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

function getColorForBranch(branchId, branchList) {
  const idx = branchList.findIndex((b) => b.id === branchId);
  return branchPalette[idx >= 0 ? idx % branchPalette.length : 0];
}

function buildTreeLayout(rawNodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 55, marginx: 20, marginy: 20 });
  rawNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
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

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />

      <NodeToolbar isVisible={data._hovered} position={Position.Right} offset={10}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-xl p-3 max-w-[280px] text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: c.main }}>
              {data.role || data.node_type}
            </span>
            <span className="text-[9px] font-mono text-gray-400">{data._branchName}</span>
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
          borderColor: selected ? c.main : `${c.main}25`,
          boxShadow: selected
            ? `0 0 0 3px ${c.ring}`
            : isHead ? `0 2px 8px ${c.main}20` : "0 1px 3px rgba(0,0,0,0.04)",
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
            </div>
            <span className="text-[8px] text-gray-400 font-mono">{data._branchName}</span>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-1.5 !h-1.5 !border-0" style={{ background: c.main }} />
    </>
  );
}

const nodeTypes = { graphNode: GraphNode };

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

    // PASS 1: Build ALL nodes first (keyed by id)
    const nodeDataMap = new Map();
    allNodes.forEach((n) => {
      if (nodeDataMap.has(n.id)) return;
      nodeDataMap.set(n.id, n);
    });

    // PASS 2: Build flow nodes
    const flowNodeList = [];
    nodeDataMap.forEach((n) => {
      const br = branchMap.get(n.branch_id);
      const branchName = br?.name || "?";
      const colors = getColorForBranch(n.branch_id, branches);
      const isHead = headNodeIds.has(n.id);

      const words = (n.content || "").split(/\s+/).slice(0, 5).join(" ");
      const label = words.length > 28 ? words.slice(0, 28) + "..." : words;

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
        },
        position: { x: 0, y: 0 },
      });
    });

    // PASS 3: Build edges (now ALL nodes exist in the map)
    const edges = [];
    nodeDataMap.forEach((n) => {
      if (!n.parent_id) return;
      if (!nodeDataMap.has(n.parent_id)) return;

      const parent = nodeDataMap.get(n.parent_id);
      const isFork = parent.branch_id !== n.branch_id;
      const colors = getColorForBranch(n.branch_id, branches);

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

    const laidOut = buildTreeLayout(flowNodeList, edges);
    return { nodes: laidOut, edges };
  }, [allNodes, branchMap, branches, headNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => {
    setNodes(
      flowNodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...n.data, _hovered: n.id === hoveredNode },
      }))
    );
  }, [flowNodes, selectedNodeId, hoveredNode, setNodes]);

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
      </ReactFlow>
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
      </div>
    </div>
  );
}
