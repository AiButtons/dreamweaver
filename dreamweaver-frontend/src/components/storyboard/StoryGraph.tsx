import React from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  OnConnect,
  NodeTypes,
  ReactFlowInstance
} from 'reactflow';
import CustomNode from './CustomNode';
import { StoryNode, StoryEdge } from '@/app/storyboard/types';

interface StoryGraphProps {
  nodes: StoryNode[];
  edges: StoryEdge[];
  onNodesChange: any;
  onEdgesChange: any;
  onConnect: OnConnect;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  onInit?: (instance: ReactFlowInstance) => void;
}

const nodeTypes: NodeTypes = {
  custom: CustomNode,
};

const StoryGraph: React.FC<StoryGraphProps> = ({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onNodeClick,
  onPaneClick,
  onInit
}) => {
  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={onInit}
        fitView
        minZoom={0.1}
        maxZoom={2}
        className="bg-slate-50"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#cbd5e1" />
        <Controls showInteractive={false} className="!bg-white !border-gray-200 !shadow-lg !rounded-lg !m-4 !hidden" />
        {/* Hiding default controls since we have custom toolbar */}
      </ReactFlow>
    </div>
  );
};

export default StoryGraph;