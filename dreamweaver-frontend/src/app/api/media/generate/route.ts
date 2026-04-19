import { NextRequest, NextResponse } from 'next/server';
import { LLMFactory } from '@/lib/llm/LLMFactory';
import { Modality } from '@/lib/llm/types';

// LTX-2.3 video via Modal budgets up to 1800s (see
// dreamweaver-backend/providers/modal/video.py). The Next.js default is 300s
// which truncates long video renders mid-flight, producing zombie Convex
// mediaAssets rows. `maxDuration` is respected by the local dev server and by
// self-hosted deployments; Vercel hobby caps this at 60s, Pro at 900s, so
// production-grade video would require the Option B async-callback flow.
export const maxDuration = 1800;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, type, config } = body;
    // M2: accept `reference_image_urls` as a top-level field too so callers
    // (the ingestion route, the shot-generation batch) don't need to nest
    // it inside `config`. Merge into the provider config below.
    const referenceImageUrls: string[] | undefined =
      Array.isArray(body.reference_image_urls)
        ? body.reference_image_urls.filter(
            (u: unknown): u is string => typeof u === "string" && u.length > 0,
          )
        : undefined;

    if (!prompt || !type) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Be tolerant of casing — the `Modality` enum values are uppercase, but
    // historical callers (and the ViMax post-processor) pass lowercase
    // strings like "image"/"video"/"audio". Normalize so the switch matches.
    const normalizedType = typeof type === 'string' ? type.toUpperCase() : type;

    const provider = LLMFactory.getProvider();
    let result = '';

    // StoryboardMediaConfig uses imageModelId / videoModelId; providers consume modelId.
    // Bridge the two here so selectors in PropertiesPanel reach ModalImage/Video providers.
    const cfg = { ...(config ?? {}) } as Record<string, unknown>;
    if (referenceImageUrls && referenceImageUrls.length > 0) {
      // Prefer the caller's explicit config.referenceImages if set; otherwise
      // promote the top-level field. Ditto for the legacy inputImage surface.
      if (!cfg.referenceImages) cfg.referenceImages = referenceImageUrls;
      if (!cfg.inputImage) cfg.inputImage = referenceImageUrls[0];
    }

    switch (normalizedType) {
        case Modality.IMAGE:
            if (cfg.imageModelId && !cfg.modelId) cfg.modelId = cfg.imageModelId;
            result = await provider.generateImage(prompt, cfg);
            break;
        case Modality.AUDIO:
            // For audio, prompt is the text
            result = await provider.generateAudio(prompt, cfg);
            break;
        case Modality.VIDEO:
            if (cfg.videoModelId && !cfg.modelId) cfg.modelId = cfg.videoModelId;
            result = await provider.generateVideo(prompt, cfg);
            break;
        default:
            return NextResponse.json(
              { error: `Invalid type "${type}" — expected one of IMAGE, VIDEO, AUDIO` },
              { status: 400 },
            );
    }

    return NextResponse.json({ url: result });

  } catch (error: any) {
    console.error('Error generating media:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
