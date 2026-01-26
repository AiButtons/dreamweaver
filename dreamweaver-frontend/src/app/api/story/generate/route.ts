import { NextRequest, NextResponse } from 'next/server';
import { LLMFactory } from '@/lib/llm/LLMFactory';
import { Type } from '@google/genai';
import { DEFAULT_SYSTEM_INSTRUCTION } from '@/lib/storyboardConstants';

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const provider = LLMFactory.getProvider();
    
    const schema = {
        type: Type.OBJECT,
        properties: {
          nodes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                data: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    segment: { type: Type.STRING },
                  },
                  required: ["label", "segment"]
                },
              },
              required: ["id", "data"]
            }
          },
          edges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                source: { type: Type.STRING },
                target: { type: Type.STRING },
              },
              required: ["id", "source", "target"]
            }
          }
        },
        required: ["nodes", "edges"]
    };

    const structure = await provider.generateStructure(
        `Generate a node-based story graph for the following prompt: "${prompt}". 
         Create between 5 and 12 nodes. Ensure a logical flow. 
         If the prompt implies branching, create branches.`,
        schema,
        {
            systemInstruction: DEFAULT_SYSTEM_INSTRUCTION
        }
    );

    return NextResponse.json(structure);

  } catch (error: any) {
    console.error('Error generating story:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
