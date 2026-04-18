import React from 'react';
import ReactFlow, {
  Controls,
  Background,
  BackgroundVariant,
  OnConnect,
  OnNodesChange,
  OnEdgesChange,
  NodeMouseHandler,
  NodeDragHandler,
  NodeTypes,
  ReactFlowInstance,
  Viewport,
  OnMove,
} from 'reactflow';
import CustomNode from './CustomNode';
import { StoryNode, StoryEdge } from '@/app/storyboard/types';

interface StoryGraphProps {
  nodes: StoryNode[];
  edges: StoryEdge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodeClick: NodeMouseHandler;
  onPaneClick: () => void;
  onNodeDragStop?: NodeDragHandler;
  onInit?: (instance: ReactFlowInstance) => void;
  defaultViewport?: Viewport;
  onMoveEnd?: OnMove;
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
  onNodeDragStop,
  onInit,
  defaultViewport,
  onMoveEnd,
}) => {
  return (
    <div className="w-full h-full bg-[radial-gradient(circle_at_18%_12%,rgba(148,163,184,0.16),transparent_36%),radial-gradient(circle_at_88%_85%,rgba(30,64,175,0.14),transparent_40%),linear-gradient(180deg,#1a2330_0%,#141d2a_55%,#101827_100%)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDragStop={onNodeDragStop}
        onInit={onInit}
        onMoveEnd={onMoveEnd}
        defaultViewport={defaultViewport}
        fitView={!defaultViewport}
        minZoom={0.1}
        maxZoom={2}
        className="bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(148,163,184,0.24)" />
        <Controls showInteractive={false} className="!bg-white !border-gray-200 !shadow-lg !rounded-lg !m-4 !hidden" />
        {/* Hiding default controls since we have custom toolbar */}
      </ReactFlow>
    </div>
  );
};

export default StoryGraph;
