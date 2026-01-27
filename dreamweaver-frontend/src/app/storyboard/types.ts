import { Node, Edge } from 'reactflow';

export interface StoryData {
  label: string;
  segment: string;
  image?: string;
  imageHistory?: string[];
  inputImage?: string;
  audio?: string;
  video?: string;
  isProcessing?: boolean;
  processingTask?: string; // 'text' | 'image' | 'audio' | 'video'
}

export type StoryNode = Node<StoryData>;
export type StoryEdge = Edge;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export enum MediaType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO'
}

export interface GraphResponse {
  nodes: {
    id: string;
    data: {
      label: string;
      segment: string;
    };
    position: { x: number; y: number };
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
  }[];
}

export type VoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface AudioConfig {
  voice: VoiceName;
  tone?: string;
}

export interface ImageConfig {
  style?: string;
  aspectRatio?: string;
}

export interface VideoConfig {
  aspectRatio: '16:9' | '9:16';
  style?: string;
}
