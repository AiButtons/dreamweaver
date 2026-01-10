// Shared types for the application

export interface CameraState {
  azimuth: number;      // 0-315 degrees (8 positions)
  elevation: number;    // -30 to 60 degrees (4 positions)
  distance: number;     // 0.6 to 1.4 (3 positions: close-up, medium, wide)
}

export interface CameraSettings {
  cameraId: string;
  lensId: string;
  focalLength: number;
  aperture: string;
}

export interface ImageGenerationParams {
  prompt?: string;
  negativePrompt?: string;
  camera: CameraState;
  settings: CameraSettings;
  aspectRatio: string;
  resolution: string;
  batchSize: number;
  seed?: number;
  modelId: string;
}

export interface VideoGenerationParams {
  prompt?: string;
  startFrame?: string;  // base64 image
  endFrame?: string;    // base64 image
  duration: number;     // seconds
  resolution: string;
  includeAudio: boolean;
  cameraMovement?: string;
  modelId: string;
}

export interface GenerationResult {
  id: string;
  type: "image" | "video";
  url: string;
  prompt: string;
  createdAt: string;
}

// Camera prompt building constants
export const AZIMUTH_MAP: Record<number, string> = {
  0: "front view",
  45: "front-right quarter view",
  90: "right side view",
  135: "back-right quarter view",
  180: "back view",
  225: "back-left quarter view",
  270: "left side view",
  315: "front-left quarter view",
};

export const ELEVATION_MAP: Record<number, string> = {
  "-30": "low-angle shot",
  "0": "eye-level shot",
  "30": "elevated shot",
  "60": "high-angle shot",
};

export const DISTANCE_MAP: Record<number, string> = {
  0.6: "close-up",
  1: "medium shot",
  1.4: "wide shot",
};
