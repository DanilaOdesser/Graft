import { useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, MarkerType, useNodesState, useEdgesState } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";

const NODE_W = 220;
const NODE_H = 60;

const roleColors = {
  user: { bg: "#eff6ff", border: "#2563eb", text: "#1e40af" },
  assistant: { bg: "#f0fdf4", border: "#059669", text: "#065f46" },
  system: { bg: "#fefce8", border: "#d97706", text: "#92400e" },
  summary: { bg: "#faf5ff", border: "#7c3aed", text: "#5b21b6" },
};

function buildLayout(rawNodes, edges) {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
  rawNodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rawNodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

function NodeCard({ data }) {
  const colors = roleColors[data.role] || roleColors.system;
  return (
    <div
      className="rounded-lg border-2 px-3 py-2 shadow-sm text-left cursor-pointer transition-shadow hover:shadow-md"
      style={{ width: NODE_W, background: colors.bg, borderColor: data.selected ? "#2563eb" : colors.border }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: colors.border + "20", color: colors.text }}>
          {data.role || data.node_type}
        </span>
        <span className="text-[9px] text-gray-400 font-mono truncate">{data.branch_name}</span>
      </div>
      <p className="text-[11px] leading-tight text-gray-600 line-clamp-2">{data.content?.slice(0, 80)}</p>
    </div>
  );
}

const nodeTypes = { custom: NodeCard };

export default function ConversationGraph({ contextNodes, branches, selectedBranchId, onNodeClick }) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!contextNodes?.length) return { nodes: [], edges: [] };

    const nodesMap = new Map();
    const edges = [];

    contextNodes.forEach((n) => {
      if (nodesMap.has(n.id)) return;
      nodesMap.set(n.id, {
        id: n.id,
        type: "custom",
        data: { ...n, selected: false },
        position: { x: 0, y: 0 },
      });
      if (n.parent_id && contextNodes.some((p) => p.id === n.parent_id)) {
        edges.push({
          id: `${n.parent_id}-${n.id}`,
          source: n.parent_id,
          target: n.id,
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "#d4d4d4" },
          style: { stroke: "#d4d4d4", strokeWidth: 1.5 },
        });
      }
    });

    const rawNodes = Array.from(nodesMap.values());
    const laid = buildLayout(rawNodes, edges);
    return { nodes: laid, edges };
  }, [contextNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, , onEdgesChange] = useEdgesState(flowEdges);

  // Sync when flowNodes change
  useMemo(() => { setNodes(flowNodes); }, [flowNodes, setNodes]);

  const handleNodeClick = useCallback((_, node) => {
    if (onNodeClick) onNodeClick(node.data);
  }, [onNodeClick]);

  if (!contextNodes?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-faint)] text-sm">
        Select a branch to view its graph
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[var(--color-surface-2)] rounded-lg border border-[var(--color-border)] overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e5e5e5" gap={20} size={1} />
        <Controls className="!bg-white !border-[var(--color-border)] !shadow-sm" />
      </ReactFlow>
    </div>
  );
}
