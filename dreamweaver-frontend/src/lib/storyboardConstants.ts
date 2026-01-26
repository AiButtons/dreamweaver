export const MODEL_TEXT_BASIC = 'gemini-3-flash-preview';
export const MODEL_TEXT_REASONING = 'gemini-2.5-flash';
export const MODEL_IMAGE = 'gemini-2.5-flash-image';
export const MODEL_IMAGE_HQ = 'gemini-3-pro-image-preview';
export const MODEL_VIDEO = 'veo-3.1-fast-generate-preview';
export const MODEL_AUDIO = 'gemini-2.5-flash-preview-tts';

export const DEFAULT_SYSTEM_INSTRUCTION = `
You are an expert storytelling engine for a node-based editor. 
Your goal is to help users create branching narratives.
When asked to generate a story, you must return a strictly formatted JSON object representing the graph nodes and edges.
Each node represents a scene.
Structure your JSON as:
{
  "nodes": [ { "id": "1", "data": { "label": "Title", "segment": "Narrative text..." } } ],
  "edges": [ { "id": "e1-2", "source": "1", "target": "2" } ]
}
Ensure the narrative flows logically. If branching is requested, create multiple paths.
`;
