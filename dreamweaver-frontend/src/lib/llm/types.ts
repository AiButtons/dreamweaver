import { Type } from "@google/genai";

export enum Modality {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO'
}

export interface ContentGenerationConfig {
  systemInstruction?: string;
  responseMimeType?: string;
  responseSchema?: any; 
  temperature?: number;
}

export interface ImageGenerationConfig {
  aspectRatio?: string;
  style?: string;
}

export interface AudioGenerationConfig {
  voice?: string;
  tone?: string;
}

export interface VideoGenerationConfig {
  aspectRatio?: string;
  duration?: number;
  style?: string;
}

export interface LLMProvider {
  /**
   * Generates text based on a prompt.
   * Supports streaming if onUpdate is provided.
   */
  generateText(
    prompt: string, 
    config?: ContentGenerationConfig,
    onUpdate?: (chunk: string) => void
  ): Promise<string>;

  /**
   * Generates structured data (JSON) based on a prompt and schema.
   */
  generateStructure<T>(
    prompt: string, 
    schema: any,
    config?: ContentGenerationConfig
  ): Promise<T>;

  generateImage(prompt: string, config?: ImageGenerationConfig): Promise<string>;
  
  generateAudio(text: string, config?: AudioGenerationConfig): Promise<string>;
  
  generateVideo(prompt: string, config?: VideoGenerationConfig): Promise<string>;
}
