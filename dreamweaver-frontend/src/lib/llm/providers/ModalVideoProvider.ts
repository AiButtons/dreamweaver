import { VideoGenerationConfig } from "../types";

// ... imports
export interface ModalVideoConfig extends VideoGenerationConfig {
    startImage?: string;
    endImage?: string;
    negativePrompt?: string;
    audioEnabled?: boolean;
    slowMotion?: boolean;
    seed?: number;
    // duration is inherited as number from VideoGenerationConfig
}

export class ModalVideoProvider {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }

  async generateVideo(prompt: string, config?: ModalVideoConfig): Promise<string> {
    const endpoint = `${this.baseUrl}/api/video/generate`;
    
    // Construct payload matching backend VideoGenerationRequest
    const payload = {
      prompt,
      model_id: "ltx-2",
      negative_prompt: config?.negativePrompt,
      start_image: config?.startImage,
      end_image: config?.endImage,
      aspect_ratio: config?.aspectRatio || "16:9",
      duration: config?.duration?.toString() || "5",

      camera_movement: "static", // Can be dynamic if we add UI later
      seed: config?.seed || 42,
      audio_enabled: config?.audioEnabled,
      slow_motion: config?.slowMotion,
      batch_size: 1
    };

    console.log("Sending Video Request:", payload);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to generate video");
      }

      const data = await response.json();
      // Expecting { id, url, thumbnail, status } or just { url: ... }
      return data.url;
    } catch (error) {
      console.error("ModalVideoProvider error:", error);
      throw error;
    }
  }
}
