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
  modelId?: string;
  /** Legacy single reference — routes the provider to `/api/image/edit`. */
  inputImage?: string;
  /**
   * M2: zero or more URL references used as image-to-image conditioning
   * (e.g. character portraits for shot consistency, or a front-view portrait
   * when generating side/back in the 3-view trick). When populated, the
   * provider forwards them to the edit / compose endpoints. The first entry
   * is used as `inputImage` when that legacy field is unset.
   */
  referenceImages?: string[];
}

export interface AudioGenerationConfig {
  voice?: string;
  tone?: string;
}

export interface VideoGenerationConfig {
  aspectRatio?: string;
  duration?: number;
  style?: string;
  modelId?: string;
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
