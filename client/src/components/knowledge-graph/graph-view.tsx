import { useCallback } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { CodeNode, CodeEdge } from '@shared/schema';

const nodeTypes = {
  file: { style: { background: '#e6f3ff' } },
  function: { style: { background: '#f3ffe6' } },
  class: { style: { background: '#ffe6e6' } }
};

export default function GraphView() {
  const { data: nodes } = useQuery<CodeNode[]>({
    queryKey: ['/api/knowledge-graph/nodes']
  });

  const { data: edges } = useQuery<CodeEdge[]>({
    queryKey: ['/api/knowledge-graph/edges']
  });

  const [reactNodes, setNodes, onNodesChange] = useNodesState([]);
  const [reactEdges, setEdges, onEdgesChange] = useEdgesState([]);

  const transformData = useCallback(() => {
    if (!nodes || !edges) return;

    const flowNodes: Node[] = nodes.map(node => ({
      id: node.id.toString(),
      type: node.type,
      data: { label: node.name },
      position: { x: 0, y: 0 } // You might want to implement proper layout
    }));

    const flowEdges: Edge[] = edges.map(edge => ({
      id: edge.id.toString(),
      source: edge.sourceId.toString(),
      target: edge.targetId.toString(),
      label: edge.type,
      type: 'smoothstep'
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [nodes, edges, setNodes, setEdges]);

  useCallback(() => {
    transformData();
  }, [transformData]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={reactNodes}
        edges={reactEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
