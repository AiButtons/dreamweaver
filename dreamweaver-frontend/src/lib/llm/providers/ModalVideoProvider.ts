import { VideoGenerationConfig } from "../types";

// ... imports
export interface ModalVideoConfig extends VideoGenerationConfig {
    startImage?: string;
    endImage?: string;
    negativePrompt?: string;
    audioEnabled?: boolean;
    slowMotion?: boolean;
    seed?: number;
    modelId?: string;          // "ltx-2.3" (default) | "ltx-2" | "veo-3.1"
    cameraMovement?: string;
    enhancePrompt?: boolean;   // LTX-2.3 only
    numInferenceSteps?: number; // LTX-2.3 only (default 30 server-side)
    cfgGuidanceScale?: number;  // LTX-2.3 only (default 3.0 server-side)
    frameRate?: number;
    // duration is inherited as number from VideoGenerationConfig
}

export class ModalVideoProvider {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }

  async generateVideo(prompt: string, config?: ModalVideoConfig): Promise<string> {
    const endpoint = `${this.baseUrl}/api/video/generate`;
    
    // Construct payload matching backend VideoGenerationRequest.
    // Default to LTX-2.3, but honor a per-call override from config.
    const payload: Record<string, unknown> = {
      prompt,
      model_id: config?.modelId || "ltx-2.3",
      negative_prompt: config?.negativePrompt,
      start_image: config?.startImage,
      end_image: config?.endImage,
      aspect_ratio: config?.aspectRatio || "16:9",
      duration: config?.duration?.toString() || "5",
      camera_movement: config?.cameraMovement || "static",
      seed: config?.seed ?? 42,
      audio_enabled: config?.audioEnabled,
      slow_motion: config?.slowMotion,
      batch_size: 1,
    };

    // LTX-2.3 extras: only forward when set so backend defaults apply.
    if (config?.enhancePrompt !== undefined) payload.enhance_prompt = config.enhancePrompt;
    if (config?.numInferenceSteps !== undefined) payload.num_inference_steps = config.numInferenceSteps;
    if (config?.cfgGuidanceScale !== undefined) payload.cfg_guidance_scale = config.cfgGuidanceScale;
    if (config?.frameRate !== undefined) payload.frame_rate = config.frameRate;

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
