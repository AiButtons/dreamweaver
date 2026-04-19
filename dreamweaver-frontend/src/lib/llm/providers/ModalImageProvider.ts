import { ImageGenerationConfig } from "../types";

export class ModalImageProvider {
  private baseUrl: string;

  constructor() {
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }

  async generateImage(prompt: string, config?: ImageGenerationConfig): Promise<string> {
    const finalPrompt = config?.style 
      ? `${prompt}. Style: ${config.style}` 
      : prompt;

    // Aspect Ratio Resolution Mapping
    const aspectRatios: Record<string, [number, number]> = {
      "1:1": [1328, 1328],
      "16:9": [1664, 928],
      "9:16": [928, 1664],
      "4:3": [1472, 1140],
      "3:4": [1140, 1472],
      "3:2": [1584, 1056],
      "2:3": [1056, 1584],
    };

    const aspectRatio = config?.aspectRatio || "16:9";
    const [width, height] = aspectRatios[aspectRatio] || aspectRatios["16:9"];

    // Check for Input Image (Conditional Routing). Prefer the legacy
    // `inputImage` field for backward compat; fall back to the first entry
    // of M2's `referenceImages` array (populated by the ingestion route when
    // it has a character portrait URL to condition on, and by the bulk
    // shot-generation batch).
    const inputImage =
      config?.inputImage ?? config?.referenceImages?.[0];
    const extraReferences = (config?.referenceImages ?? []).slice(
      config?.inputImage ? 0 : 1, // skip the one promoted to inputImage
    );
    const modelOverride: string | undefined = config?.modelId;

    let endpoint = `${this.baseUrl}/api/image/generate`;
    let payload: any = {
      prompt: finalPrompt,
      width,
      height,
      // Default params
      n_steps: 35,
      guidance_scale: 8.0,
      model_id: modelOverride || "zennah-image-gen",
    };

    if (inputImage) {
      // Switch to Edit Mode (Qwen Edit or compatible).
      endpoint = `${this.baseUrl}/api/image/edit`;
      payload = {
        prompt: finalPrompt,
        image: inputImage,
        // Forward additional references so the backend can thread them if
        // the selected model supports multi-reference conditioning. Backends
        // that ignore the field are unaffected.
        reference_images: extraReferences.length > 0 ? extraReferences : undefined,
        model_id: modelOverride || "zennah-qwen-edit",
        n: 1,
        extra_params: {
             n_steps: 45, // Edit usually needs more steps
             guidance_scale: 6.0,
             // Explicitly skip lora_scale to use base Qwen Edit model as per requirements
        }
      };
    } else {
        // Image Generation Mode
        // Pass width/height in extra_params for the backend provider to pick up
        payload.extra_params = {
            width,
            height
        }
    }

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
        throw new Error(error.detail?.error || error.detail || "Failed to generate image");
      }

      const data = await response.json();
      // Backend returns { images: [{ url: "...", b64_json: "..." }] }
      // We prioritize b64_json if available for immediate display
      const image = data.images[0];
      if (image.b64_json) {
        return `data:image/jpeg;base64,${image.b64_json}`;
      }
      return image.url;
    } catch (error) {
      console.error("ModalImageProvider error:", error);
      throw error;
    }
  }
}
