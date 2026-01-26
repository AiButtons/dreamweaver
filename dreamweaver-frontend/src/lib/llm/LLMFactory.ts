import { GeminiProvider } from "./GeminiProvider";
import { ElevenLabsProvider } from "./providers/ElevenLabsProvider";
import { SunoProvider } from "./providers/SunoProvider";
import { LLMProvider, ContentGenerationConfig, ImageGenerationConfig, AudioGenerationConfig, VideoGenerationConfig } from "./types";

class UnifiedProvider implements LLMProvider {
  private gemini: GeminiProvider;
  private elevenLabs?: ElevenLabsProvider;
  private suno?: SunoProvider;

  constructor() {
    const geminiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY!;
    if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");
    this.gemini = new GeminiProvider(geminiKey);

    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (elevenKey) this.elevenLabs = new ElevenLabsProvider(elevenKey);

    const sunoKey = process.env.SUNO_API_KEY;
    if (sunoKey) this.suno = new SunoProvider(sunoKey);
  }

  async generateText(prompt: string, config?: ContentGenerationConfig, onUpdate?: (chunk: string) => void): Promise<string> {
    return this.gemini.generateText(prompt, config, onUpdate);
  }

  async generateStructure<T>(prompt: string, schema: any, config?: ContentGenerationConfig): Promise<T> {
    return this.gemini.generateStructure<T>(prompt, schema, config);
  }

  async generateImage(prompt: string, config?: ImageGenerationConfig): Promise<string> {
    return this.gemini.generateImage(prompt, config);
  }

  async generateVideo(prompt: string, config?: VideoGenerationConfig): Promise<string> {
    return this.gemini.generateVideo(prompt, config);
  }

  async generateAudio(text: string, config?: AudioGenerationConfig): Promise<string> {
    // Determine provider based on config or default
    // We can add a 'provider' field to AudioGenerationConfig in types.ts later, 
    // or just infer. For now, let's say if voice is "Suno" (mock) use Suno, etc.
    // Or just default to ElevenLabs if available, else Gemini.
    
    // Simplistic routing:
    // If config.voice starts with "suno", use Suno.
    // If we implement specific provider selection in UI, we can pass it in config.
    
    if (this.elevenLabs) {
        return this.elevenLabs.generateAudio(text, config);
    }
    
    // Fallback to Gemini
    return this.gemini.generateAudio(text, config);
  }
}

export class LLMFactory {
  private static instance: LLMProvider;

  static getProvider(): LLMProvider {
    if (!this.instance) {
      this.instance = new UnifiedProvider();
    }
    return this.instance;
  }
}
