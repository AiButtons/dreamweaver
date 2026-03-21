import { GraphResponse, MediaType, StoryboardMediaConfig } from "../types";
import dagre from 'dagre';

// Layout Algorithm using Dagre (Client-side)
// We keep this here because the layouting is a display concern, though it could move to server.
// Keeping it here matches the original architecture's "post-processing" step.
type RawGraphNode = {
  id: string;
  data: {
    label: string;
    segment: string;
  };
};

type RawGraphEdge = {
  id: string;
  source: string;
  target: string;
};

const layoutGraph = (nodes: RawGraphNode[], edges: RawGraphEdge[]): GraphResponse => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', align: 'DL', nodesep: 100, ranksep: 200 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 350;
  const nodeHeight = 500;

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export const generateStoryGraph = async (prompt: string): Promise<GraphResponse> => {
  const response = await fetch('/api/story/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to generate story');
  }

  const rawData = await response.json();
  return layoutGraph(rawData.nodes, rawData.edges);
};

export const editNodeText = async (currentText: string, instruction: string): Promise<{ label: string; segment: string }> => {
  const response = await fetch('/api/story/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentText, instruction }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to edit node');
  }

  return await response.json();
};

export const generateMedia = async (
  type: MediaType,
  prompt: string,
  config: StoryboardMediaConfig,
): Promise<string> => {
    const response = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, prompt, config }),
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to generate media');
    }

    const data = await response.json();
    return data.url;
};
