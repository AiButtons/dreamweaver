"use client";

import React, { useState, useCallback } from 'react';
import {
    useNodesState,
    useEdgesState,
    addEdge,
    OnConnect,
    Node,
    Connection,
    ReactFlowInstance,
    ReactFlowProvider
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import 'reactflow/dist/style.css';

import StoryGraph from '@/components/storyboard/StoryGraph';
import ChatPanel from '@/components/storyboard/ChatPanel';
import PropertiesPanel from '@/components/storyboard/PropertiesPanel';
import CanvasToolbar from '@/components/storyboard/CanvasToolbar';

import { StoryNode, StoryEdge, ChatMessage, MediaType, AudioConfig, ImageConfig, VideoConfig } from './types';
import { generateStoryGraph, editNodeText, generateMedia } from './services/apiService';

const generateId = () => uuidv4();

const INITIAL_NODES: StoryNode[] = [];
const INITIAL_EDGES: StoryEdge[] = [];

export default function StoryboardPage() {
    return (
        <ReactFlowProvider>
            <AppContent />
        </ReactFlowProvider>
    );
}

function AppContent() {
    const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES);
    const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES);
    const [selectedNode, setSelectedNode] = useState<StoryNode | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: '1', role: 'assistant', content: 'Welcome to StoryNodes. Start by describing your story idea, or add nodes manually.', timestamp: Date.now() }
    ]);
    const [isProcessing, setIsProcessing] = useState(false);

    const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

    const onConnect: OnConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
        setSelectedNode(node as StoryNode);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    const handleAddNode = () => {
        const id = generateId();
        let position = { x: 100, y: 100 };
        if (selectedNode && rfInstance) {
            position = { x: selectedNode.position.x + 400, y: selectedNode.position.y };
        } else if (rfInstance) {
            const center = rfInstance.project({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 });
            if (center) position = center;
        }
        const newNode: StoryNode = {
            id,
            type: 'custom',
            position,
            data: {
                label: 'New Scene',
                segment: 'Click to edit this scene description...'
            }
        };
        setNodes((nds) => [...nds, newNode]);
        if (selectedNode) {
            setEdges((eds) => [...eds, { id: `e${selectedNode.id}-${id}`, source: selectedNode.id, target: id, type: 'smoothstep', animated: true, style: { stroke: '#94a3b8', strokeWidth: 2 } }]);
        }
        setSelectedNode(newNode);
    };

    const handleDeleteNode = () => {
        if (!selectedNode) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
        setSelectedNode(null);
    };

    const handleFitView = () => { if (rfInstance) rfInstance.fitView({ padding: 0.2, duration: 800 }); };
    const handleZoomIn = () => { if (rfInstance) rfInstance.zoomIn({ duration: 500 }); };
    const handleZoomOut = () => { if (rfInstance) rfInstance.zoomOut({ duration: 500 }); };

    const handleSendMessage = async (text: string) => {
        const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setIsProcessing(true);

        try {
            const isEdit = nodes.length > 0 && selectedNode && (text.toLowerCase().includes('change') || text.toLowerCase().includes('make') || text.toLowerCase().includes('rewrite'));
            if (isEdit && selectedNode) {
                await handleEditNode(selectedNode.id, text);
                setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: `Updated node "${selectedNode.data.label}".`, timestamp: Date.now() }]);
            } else {
                setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: 'Generating story structure...', timestamp: Date.now() }]);

                const graphData = await generateStoryGraph(text);

                const newNodes: StoryNode[] = graphData.nodes.map(n => ({
                    id: n.id,
                    type: 'custom',
                    data: { label: n.data.label, segment: n.data.segment },
                    position: n.position
                }));
                const newEdges: StoryEdge[] = graphData.edges.map(e => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    type: 'smoothstep',
                    animated: true,
                    style: { stroke: '#94a3b8', strokeWidth: 2 }
                }));
                setNodes(newNodes);
                setEdges(newEdges);
                setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: `Created story with ${newNodes.length} nodes.`, timestamp: Date.now() }]);

                // Wait for render to stabilize before fitting view
                setTimeout(() => handleFitView(), 300);
            }
        } catch (error: any) {
            console.error(error);
            setMessages(prev => [...prev, { id: generateId(), role: 'assistant', content: `Error: ${error.message || 'Something went wrong.'}`, timestamp: Date.now() }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const updateNodeData = (id: string, partialData: Partial<StoryNode['data']>) => {
        setNodes((nds) => nds.map((node) => {
            if (node.id === id) {
                const newData = { ...node.data, ...partialData };
                if (selectedNode?.id === id) {
                    setSelectedNode({ ...node, data: newData });
                }
                return { ...node, data: newData };
            }
            return node;
        }));
    };

    const handleEditNode = async (nodeId: string, instruction: string) => {
        setIsProcessing(true);
        updateNodeData(nodeId, { isProcessing: true, processingTask: 'text' });
        try {
            const node = nodes.find(n => n.id === nodeId);
            if (!node) return;
            const result = await editNodeText(node.data.segment, instruction);
            updateNodeData(nodeId, {
                label: result.label,
                segment: result.segment,
                isProcessing: false,
                processingTask: undefined
            });
        } catch (e) {
            console.error(e);
            updateNodeData(nodeId, { isProcessing: false, processingTask: undefined });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleGenerateMedia = async (nodeId: string, type: MediaType, prompt: string, config: any) => {
        setIsProcessing(true);
        updateNodeData(nodeId, { isProcessing: true, processingTask: type.toLowerCase() });
        try {
            // Map frontend config to backend config
            if (type === MediaType.IMAGE && config.inputImage) {
                updateNodeData(nodeId, { inputImage: config.inputImage });
            }
            const resultUrl = await generateMedia(type, prompt, config);
            if (type === MediaType.IMAGE) {
                // Update history with new image
                setNodes((nds) => nds.map((node) => {
                    if (node.id === nodeId) {
                        const oldHistory = node.data.imageHistory || [];
                        // Ensure existing image is in history if this is the first time adding history
                        const historyWithLegacy = (oldHistory.length === 0 && node.data.image)
                            ? [node.data.image]
                            : oldHistory;

                        const newHistory = [...historyWithLegacy, resultUrl];
                        const newData = { ...node.data, image: resultUrl, imageHistory: newHistory };

                        if (selectedNode?.id === nodeId) {
                            setSelectedNode({ ...node, data: newData });
                        }
                        return { ...node, data: newData };
                    }
                    return node;
                }));
            }
            if (type === MediaType.AUDIO) updateNodeData(nodeId, { audio: resultUrl });
            if (type === MediaType.VIDEO) updateNodeData(nodeId, { video: resultUrl });

        } catch (e: any) {
            console.error(e);
            alert(`Media generation failed: ${e.message}`);
        } finally {
            updateNodeData(nodeId, { isProcessing: false, processingTask: undefined });
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex h-full w-full overflow-hidden bg-white text-slate-900 font-sans storyboard-scroll">
            {/* Sidebar Chat */}
            <div className="w-80 h-full z-20 shadow-xl border-r border-gray-100 flex-shrink-0 bg-white">
                <ChatPanel
                    messages={messages}
                    onSendMessage={handleSendMessage}
                    isGenerating={isProcessing}
                    selectedNode={selectedNode}
                    onClearSelection={() => setSelectedNode(null)}
                />
            </div>

            {/* Main Canvas */}
            <div className="flex-1 relative h-full bg-slate-50">
                <StoryGraph
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={onNodeClick}
                    onPaneClick={onPaneClick}
                    // @ts-ignore
                    onInit={setRfInstance}
                />

                <CanvasToolbar
                    onAddNode={handleAddNode}
                    onDeleteNode={handleDeleteNode}
                    onFitView={handleFitView}
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    hasSelection={!!selectedNode}
                />

                {/* Floating Properties Card */}
                {selectedNode && (
                    <div className="absolute top-6 right-20 z-30">
                        <PropertiesPanel
                            selectedNode={selectedNode}
                            nodes={nodes}
                            edges={edges}
                            onGenerateMedia={handleGenerateMedia}
                            onEditNode={handleEditNode}
                            isProcessing={isProcessing}
                            onClose={() => setSelectedNode(null)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
