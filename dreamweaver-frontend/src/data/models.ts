// Model configuration types and data

export type ModelCapability = 
  | "image_gen"
  | "image_edit"
  | "video_gen"
  | "video_edit"
  | "camera_control"
  | "audio"
  | "4k"
  | "hd"
  | "fast";

export type ModelProvider = "openai" | "fal" | "replicate" | "kling" | "modal" | "local";

export interface Model {
  id: string;
  name: string;
  provider: ModelProvider;
  capabilities: ModelCapability[];
  description: string;
  maxResolution?: string;
  maxDuration?: string;
}

export const IMAGE_MODELS: Model[] = [
  {
    id: "dall-e-3",
    name: "DALL·E 3",
    provider: "openai",
    capabilities: ["image_gen", "hd"],
    description: "OpenAI's most advanced image generation model",
    maxResolution: "1792x1024",
  },
  {
    id: "gpt-image-1",
    name: "GPT Image",
    provider: "openai",
    capabilities: ["image_gen", "image_edit", "hd"],
    description: "Native image generation with GPT-4o",
    maxResolution: "2048x2048",
  },
];

export const VIDEO_MODELS: Model[] = [
  {
    id: "sora-2",
    name: "Sora 2",
    provider: "openai",
    capabilities: ["video_gen", "audio", "hd"],
    description: "OpenAI's most advanced video model",
    maxResolution: "1080p",
    maxDuration: "12s",
  },
];

export const EDIT_MODELS: Model[] = [
  {
    id: "gpt-image-1",
    name: "GPT Image Edit",
    provider: "openai",
    capabilities: ["image_edit", "hd"],
    description: "Edit images with natural language",
    maxResolution: "2048x2048",
  },
];

// Camera presets based on Higgsfield reference
export interface Camera {
  id: string;
  name: string;
  type: "film" | "digital" | "vintage";
  description: string;
}

export const CAMERAS: Camera[] = [
  { id: "arriflex-16sr", name: "Arriflex 16SR", type: "film", description: "Classic 16mm film camera" },
  { id: "arri-alexa", name: "ARRI ALEXA", type: "digital", description: "Industry standard digital cinema" },
  { id: "red-v-raptor", name: "RED V-RAPTOR", type: "digital", description: "8K cinema camera" },
  { id: "sony-venice", name: "Sony VENICE", type: "digital", description: "Full-frame cinema camera" },
  { id: "panavision-millennium", name: "Panavision Millennium", type: "film", description: "Hollywood favorite" },
];

export interface Lens {
  id: string;
  name: string;
  type: "spherical" | "anamorphic";
  description: string;
}

export const LENSES: Lens[] = [
  { id: "panavision-c-series", name: "Panavision C-Series", type: "anamorphic", description: "Classic anamorphic look" },
  { id: "cooke-s4", name: "Cooke S4/i", type: "spherical", description: "Natural, flattering look" },
  { id: "zeiss-master-prime", name: "Zeiss Master Prime", type: "spherical", description: "Ultra sharp and clean" },
  { id: "arri-master-anamorphic", name: "ARRI Master Anamorphic", type: "anamorphic", description: "Modern anamorphic" },
];

export const FOCAL_LENGTHS = [14, 24, 35, 50, 85, 100, 135, 200] as const;
export type FocalLength = typeof FOCAL_LENGTHS[number];

export const APERTURES = ["f/1.4", "f/2", "f/2.8", "f/4", "f/5.6", "f/8", "f/11", "f/16"] as const;
export type Aperture = typeof APERTURES[number];

export const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "4:3", label: "4:3", width: 4, height: 3 },
  { id: "1:1", label: "1:1", width: 1, height: 1 },
  { id: "9:16", label: "9:16", width: 9, height: 16 },
  { id: "21:9", label: "21:9", width: 21, height: 9 },
] as const;

export const RESOLUTIONS = [
  { id: "hd", label: "HD", value: "1280x720" },
  { id: "fhd", label: "Full HD", value: "1920x1080" },
  { id: "2k", label: "2K", value: "2048x1080" },
  { id: "4k", label: "4K", value: "3840x2160" },
] as const;
