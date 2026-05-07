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

const NODE_W = 200;
const NODE_H = 56;

const branchColors = [
  "#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626",
  "#0891b2", "#4f46e5", "#c026d3", "#ea580c", "#65a30d",
];

function getBranchColor(branchName, branchList) {
  const idx = branchList.indexOf(branchName);
  return branchColors[idx >= 0 ? idx % branchColors.length : 0];
}

const roleIcons = {
  user: "U",
  assistant: "A",
  system: "S",
  summary: "\u03A3",
};

function buildLayout(rawNodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 70, marginx: 20, marginy: 20 });
  rawNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rawNodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

function GraphNode({ data, selected }) {
  const color = data._branchColor || "#2563eb";
  const isHead = data._isHead;
  const icon = roleIcons[data.role] || roleIcons[data.node_type] || "?";

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-gray-300 !border-0" />

      {/* Hover toolbar with summary */}
      <NodeToolbar isVisible={data._hovered} position={Position.Right} offset={8}>
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 max-w-[280px] text-left pointer-events-none">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded text-white" style={{ background: color }}>
              {data.role || data.node_type}
            </span>
            <span className="text-[9px] font-mono text-gray-400">{data._branchName}</span>
          </div>
          <p className="text-[11px] text-gray-600 leading-relaxed">{data.content?.slice(0, 250)}{data.content?.length > 250 ? "..." : ""}</p>
          <div className="flex items-center gap-2 mt-2 text-[9px] text-gray-400">
            <span>{data.token_count} tokens</span>
            <span>id: {data.id?.slice(0, 8)}</span>
          </div>
        </div>
      </NodeToolbar>

      <div
        className="rounded-xl border-2 px-3 py-2 text-left cursor-pointer transition-all duration-150"
        style={{
          width: NODE_W,
          background: selected ? `${color}08` : "white",
          borderColor: selected ? color : `${color}30`,
          boxShadow: selected ? `0 0 0 3px ${color}15` : isHead ? `0 2px 8px ${color}15` : "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{ background: color }}
          >
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-semibold text-gray-700 truncate">
                {data._label}
              </span>
              {isHead && (
                <span className="text-[8px] font-bold uppercase px-1 py-0.5 rounded text-white shrink-0" style={{ background: color }}>
                  HEAD
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 truncate leading-tight mt-0.5">
              {data.content?.slice(0, 50)}
            </p>
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-gray-300 !border-0" />
    </>
  );
}

const nodeTypes = { graphNode: GraphNode };

export default function ConversationGraph({
  allNodes,
  branches,
  onNodeSelect,
  selectedNodeId,
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  const branchNames = useMemo(() => branches.map((b) => b.name), [branches]);

  // Build a map of branch_id -> branch info
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

    const seen = new Map();
    const edges = [];

    allNodes.forEach((n) => {
      if (seen.has(n.id)) return;

      const br = branchMap.get(n.branch_id);
      const branchName = br?.name || "unknown";
      const color = getBranchColor(branchName, branchNames);
      const isHead = headNodeIds.has(n.id);

      // Generate a readable label
      const roleLabel = (n.role || n.node_type || "").charAt(0).toUpperCase() + (n.role || n.node_type || "").slice(1);
      const contentPreview = n.content?.split(/\s+/).slice(0, 4).join(" ") || "";
      const label = `${roleLabel}: ${contentPreview}`;

      seen.set(n.id, {
        id: n.id,
        type: "graphNode",
        data: {
          ...n,
          _branchName: branchName,
          _branchColor: color,
          _isHead: isHead,
          _label: label.slice(0, 35),
          _hovered: false,
        },
        position: { x: 0, y: 0 },
      });

      if (n.parent_id && allNodes.some((p) => p.id === n.parent_id)) {
        const parentBr = branchMap.get(allNodes.find((p) => p.id === n.parent_id)?.branch_id);
        const isCrossBranch = parentBr?.id !== n.branch_id;

        edges.push({
          id: `e-${n.parent_id}-${n.id}`,
          source: n.parent_id,
          target: n.id,
          type: "smoothstep",
          animated: isCrossBranch,
          style: {
            stroke: color,
            strokeWidth: isCrossBranch ? 1.5 : 2,
            strokeDasharray: isCrossBranch ? "5 5" : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 10,
            height: 10,
            color: color,
          },
        });
      }
    });

    const rawNodes = Array.from(seen.values());
    const laid = buildLayout(rawNodes, edges);
    return { nodes: laid, edges };
  }, [allNodes, branchMap, branchNames, headNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => {
    setNodes(flowNodes.map((n) => ({
      ...n,
      selected: n.id === selectedNodeId,
      data: { ...n.data, _hovered: n.id === hoveredNode },
    })));
  }, [flowNodes, selectedNodeId, hoveredNode, setNodes]);

  const handleNodeClick = useCallback((_, node) => {
    if (onNodeSelect) onNodeSelect(node.data);
  }, [onNodeSelect]);

  const handleNodeMouseEnter = useCallback((_, node) => {
    setHoveredNode(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  const minimapColor = useCallback((node) => {
    return node.data?._branchColor || "#d4d4d4";
  }, []);

  if (!allNodes?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">
        No nodes to display
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--color-surface-2)] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e5e5" gap={24} size={1} />
        <Controls
          showInteractive={false}
          className="!bg-white !border-[var(--color-border)] !shadow-sm !rounded-lg"
        />
        <MiniMap
          nodeColor={minimapColor}
          nodeStrokeWidth={2}
          pannable
          zoomable
          className="!bg-white !border-[var(--color-border)] !shadow-sm !rounded-lg"
          style={{ width: 150, height: 100 }}
        />
      </ReactFlow>
    </div>
  );
}
