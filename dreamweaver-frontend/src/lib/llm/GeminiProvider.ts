import { GoogleGenAI, Type } from "@google/genai";
import { 
  LLMProvider, 
  ContentGenerationConfig, 
  ImageGenerationConfig, 
  AudioGenerationConfig, 
  VideoGenerationConfig 
} from "./types";
import { MODEL_TEXT_BASIC, MODEL_TEXT_REASONING, MODEL_IMAGE, MODEL_VIDEO, MODEL_AUDIO } from "@/lib/storyboardConstants";

export class GeminiProvider implements LLMProvider {
  private client: GoogleGenAI;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateText(
    prompt: string, 
    config?: ContentGenerationConfig,
    onUpdate?: (chunk: string) => void
  ): Promise<string> {
    const model = MODEL_TEXT_BASIC;
    
    if (onUpdate) {
      // Streaming implementation
      try {
        const result = await this.client.models.generateContentStream({
            model,
            contents: prompt,
            config: {
                // @ts-ignore
                systemInstruction: config?.systemInstruction,
                temperature: config?.temperature,
            }
          });
    
          let fullText = '';
          for await (const chunk of result) {
              const text = chunk.text;
              if (text) {
                  onUpdate(text);
                  fullText += text;
              }
          }
          return fullText;
      } catch (e) {
         console.warn("Streaming failed/unsupported, falling back to unary", e);
      }
    }

    const response = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: {
          // @ts-ignore
          systemInstruction: config?.systemInstruction,
          responseMimeType: "text/plain",
        }
    });

    return response.text as string;
  }

  // Specialized method for streaming that can be called by the API route
  async generateTextStream(
    prompt: string,
    config?: ContentGenerationConfig
  ): Promise<ReadableStream> {
      const model = MODEL_TEXT_BASIC;
      const result = await this.client.models.generateContentStream({
        model,
        contents: prompt,
        config: {
            // @ts-ignore
            systemInstruction: config?.systemInstruction,
        }
      });

      return new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of result) {
                    const text = chunk.text;
                    if (text) {
                        controller.enqueue(text);
                    }
                }
                controller.close();
            } catch (e) {
                controller.error(e);
            }
        }
      });
  }

  async generateStructure<T>(
    prompt: string, 
    schema: any, 
    config?: ContentGenerationConfig
  ): Promise<T> {
    const model = MODEL_TEXT_REASONING; // Use reasoning model for better structure
    
    const response = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: {
            // @ts-ignore
            systemInstruction: config?.systemInstruction,
            responseMimeType: "application/json",
            responseSchema: schema
        }
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    // Sometimes the model returns a markdown code block ```json ... ``` even with mimeType
    let jsonStr = text;
    if (text.startsWith("```json")) {
        jsonStr = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    }
    
    return JSON.parse(jsonStr) as T;
  }

  async generateImage(prompt: string, config?: ImageGenerationConfig): Promise<string> {
    const finalPrompt = config?.style 
        ? `${prompt}. Style: ${config.style}` 
        : prompt;

    const response = await this.client.models.generateContent({
        model: MODEL_IMAGE,
        contents: {
          parts: [{ text: finalPrompt }]
        },
        config: {
            // @ts-ignore
            aspectRatio: config?.aspectRatio || "16:9",
        }
    });

    // @ts-ignore
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    }
    throw new Error("No image generated");
  }

  async generateAudio(text: string, config?: AudioGenerationConfig): Promise<string> {
    const response = await this.client.models.generateContent({
        model: MODEL_AUDIO,
        contents: { parts: [{ text }] },
        config: {
        // @ts-ignore
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: config?.voice || 'Kore' },
            },
          },
        },
      });
    
      // @ts-ignore
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error("No audio generated");
      return base64Audio;
  }

  async generateVideo(prompt: string, config?: VideoGenerationConfig): Promise<string> {
      // Note: This logic was in the original file, requires polling
      
      const finalPrompt = config?.style 
      ? `${prompt}. Style: ${config.style}, cinematic, high quality.` 
      : prompt;

    let operation = await this.client.models.generateVideos({
      model: MODEL_VIDEO,
      prompt: finalPrompt,
      config: {
        numberOfVideos: 1,
        // @ts-ignore
        aspectRatio: config?.aspectRatio || '16:9'
      }
    });

    // Poll until done
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await this.client.operations.getVideosOperation({operation: operation});
    }

    // @ts-ignore
    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!downloadLink) throw new Error("No video generated");

    // Fetch using the apiKey stored in the class
    const videoUrl = `${downloadLink}&key=${this.apiKey}`;
    const vidResp = await fetch(videoUrl);
    const arrayBuffer = await vidResp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return `data:video/mp4;base64,${base64}`;
  }
}

