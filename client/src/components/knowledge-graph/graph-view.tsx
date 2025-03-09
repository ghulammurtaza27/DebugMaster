import { useCallback, useEffect } from 'react';
import ReactFlow, {
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

interface GraphNode extends Node {
  type: 'file' | 'function' | 'class';
  data: {
    name: string;
    content?: string;
    type: string;
  };
}

interface GraphEdge extends Edge {
  type: string;
  data?: {
    relationship: string;
  };
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const nodeTypes = {
  file: { style: { background: '#6366f1', color: 'white' } },
  function: { style: { background: '#8b5cf6', color: 'white' } },
  class: { style: { background: '#ec4899', color: 'white' } },
};

export default function GraphView() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { data: graphData, isLoading, error } = useQuery<GraphData>({
    queryKey: ['knowledge-graph'],
    queryFn: async () => {
      console.log('Fetching knowledge graph data...');
      const response = await apiRequest('GET', '/api/knowledge-graph');
      console.log('Knowledge graph data received:', response);
      return response;
    },
  });

  useEffect(() => {
    console.log('useEffect triggered with graphData:', graphData);
    
    if (graphData && graphData.nodes && graphData.edges) {
      console.log('Graph data received:', graphData);
      console.log('Nodes count:', graphData.nodes.length);
      console.log('Edges count:', graphData.edges.length);
      
      // Transform nodes to include proper styling and positioning
      const transformedNodes = graphData.nodes.map((node, index) => {
        console.log('Processing node:', node);
        return {
          ...node,
          position: { 
            x: (index % 5) * 200, 
            y: Math.floor(index / 5) * 100 
          },
          style: {
            ...nodeTypes[node.type]?.style,
            width: 180,
            padding: 10,
          },
          data: {
            ...node.data,
            label: node.data.name,
          },
        };
      });

      // Transform edges to include proper styling
      const transformedEdges = graphData.edges.map((edge) => {
        console.log('Processing edge:', edge);
        return {
          ...edge,
          type: 'smoothstep',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: '#94a3b8' },
          label: edge.data?.relationship,
        };
      });

      console.log('Setting nodes:', transformedNodes);
      console.log('Setting edges:', transformedEdges);
      
      setNodes(transformedNodes);
      setEdges(transformedEdges);
    } else {
      console.log('No graph data available or data is incomplete');
    }
  }, [graphData, setNodes, setEdges]);

  console.log('Rendering GraphView with nodes:', nodes.length, 'and edges:', edges.length);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="text-red-500 text-xl mb-4">
          {error instanceof Error ? error.message : 'An error occurred while loading the knowledge graph'}
        </div>
        {error instanceof Error && error.message.includes('rate limit') && (
          <div className="text-gray-600 max-w-lg">
            <p className="mb-4">
              GitHub API rate limit has been exceeded. This happens when too many requests are made to GitHub in a short period.
            </p>
            <p className="mb-4">
              You can either wait until the rate limit resets, or enable mock mode by setting <code className="bg-gray-100 p-1 rounded">USE_MOCK_GITHUB=true</code> in your <code className="bg-gray-100 p-1 rounded">.env</code> file.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        attributionPosition="bottom-right"
      >
        <Controls />
        <MiniMap />
        <Background gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}