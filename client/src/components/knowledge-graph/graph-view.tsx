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
  Handle,
  Position,
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
  isAnalyzing?: boolean;
}

const FileNode = ({ data }: { data: { name: string; content?: string } }) => (
  <div className="px-4 py-2 shadow-lg rounded-md bg-indigo-500 text-white">
    <Handle type="target" position={Position.Top} />
    <div className="font-bold">{data.name}</div>
    {data.content && (
      <div className="text-xs mt-1 text-indigo-100 truncate max-w-[160px]">
        {data.content}
      </div>
    )}
    <Handle type="source" position={Position.Bottom} />
  </div>
);

const FunctionNode = ({ data }: { data: { name: string; content?: string } }) => (
  <div className="px-4 py-2 shadow-lg rounded-md bg-purple-500 text-white">
    <Handle type="target" position={Position.Top} />
    <div className="font-bold">{data.name}()</div>
    {data.content && (
      <div className="text-xs mt-1 text-purple-100 truncate max-w-[160px]">
        {data.content}
      </div>
    )}
    <Handle type="source" position={Position.Bottom} />
  </div>
);

const ClassNode = ({ data }: { data: { name: string; content?: string } }) => (
  <div className="px-4 py-2 shadow-lg rounded-md bg-pink-500 text-white">
    <Handle type="target" position={Position.Top} />
    <div className="font-bold">class {data.name}</div>
    {data.content && (
      <div className="text-xs mt-1 text-pink-100 truncate max-w-[160px]">
        {data.content}
      </div>
    )}
    <Handle type="source" position={Position.Bottom} />
  </div>
);

const nodeTypes = {
  file: FileNode,
  function: FunctionNode,
  class: ClassNode,
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
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    console.log('useEffect triggered with graphData:', graphData);
    
    if (graphData?.nodes && graphData.edges) {
      console.log('Graph data received:', graphData);
      console.log('Nodes count:', graphData.nodes.length);
      console.log('Edges count:', graphData.edges.length);
      
      const transformedNodes = graphData.nodes.map((node, index) => {
        console.log('Processing node:', node);
        return {
          ...node,
          position: { 
            x: (index % 8) * 300,
            y: Math.floor(index / 8) * 200
          },
          data: {
            name: node.data.name,
            content: node.data.content,
            type: node.data.type,
          },
        };
      });

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
    }
  }, [graphData, setNodes, setEdges]);

  const renderStats = () => {
    if (!graphData?.nodes) return null;
    
    const fileNodes = graphData.nodes.filter(n => n.type === 'file').length;
    const functionNodes = graphData.nodes.filter(n => n.type === 'function').length;
    const classNodes = graphData.nodes.filter(n => n.type === 'class').length;
    
    return (
      <div className="absolute top-4 right-4 bg-white/90 p-4 rounded-lg shadow-lg z-10">
        <h3 className="font-bold mb-2">Analysis Progress</h3>
        <div className="space-y-1 text-sm">
          <div>Files: {fileNodes}</div>
          <div>Functions: {functionNodes}</div>
          <div>Classes: {classNodes}</div>
          <div>Total Relationships: {graphData.edges.length}</div>
          {graphData.isAnalyzing && (
            <div className="mt-2 flex items-center text-blue-600">
              <div className="animate-spin rounded-full h-3 w-3 border border-current mr-2" />
              Analysis in progress...
            </div>
          )}
        </div>
      </div>
    );
  };

  if (isLoading && (!nodes.length && !edges.length)) {
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
    <div className="h-full w-full relative">
      {renderStats()}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
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