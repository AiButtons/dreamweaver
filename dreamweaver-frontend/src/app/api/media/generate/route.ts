import { NextRequest, NextResponse } from 'next/server';
import { LLMFactory } from '@/lib/llm/LLMFactory';
import { Modality } from '@/lib/llm/types';

export async function POST(req: NextRequest) {
  try {
    const { prompt, type, config } = await req.json();

    if (!prompt || !type) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const provider = LLMFactory.getProvider();
    let result = '';

    switch (type) {
        case Modality.IMAGE:
            result = await provider.generateImage(prompt, config);
            break;
        case Modality.AUDIO:
            // For audio, prompt is the text
            result = await provider.generateAudio(prompt, config);
            break;
        case Modality.VIDEO:
            result = await provider.generateVideo(prompt, config);
            break;
        default:
            return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    return NextResponse.json({ url: result });

  } catch (error: any) {
    console.error('Error generating media:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
