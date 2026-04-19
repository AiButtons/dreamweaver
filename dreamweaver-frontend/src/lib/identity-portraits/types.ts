/**
 * Portrait-reference types shared by the Convex surface, Next.js client, and
 * pure library. Keep this file dependency-free so it can be imported from
 * anywhere without pulling React / Convex.
 */

export type PortraitView = "front" | "side" | "back" | "three_quarter" | "custom";
export type PortraitRole = "portrait" | "wardrobe" | "cameo_reference";

export interface IdentityPortrait {
  _id: string;
  ownerPackId: string;
  role: PortraitRole;
  portraitView?: PortraitView;
  sourceUrl: string;
  modelId?: string;
  prompt?: string;
  notes?: string;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export const PORTRAIT_VIEW_OPTIONS: Array<{
  value: PortraitView;
  label: string;
  description: string;
}> = [
  { value: "front",         label: "Front",          description: "Straight-on, canonical anchor" },
  { value: "three_quarter", label: "Three-quarter",  description: "~45° rotation" },
  { value: "side",          label: "Side",           description: "Profile" },
  { value: "back",          label: "Back",           description: "Back view" },
  { value: "custom",        label: "Custom",         description: "Other angle / context shot" },
];

export const PORTRAIT_ROLE_OPTIONS: Array<{ value: PortraitRole; label: string }> = [
  { value: "portrait",         label: "Character portrait" },
  { value: "wardrobe",         label: "Wardrobe reference" },
  { value: "cameo_reference",  label: "Cameo reference" },
];

/** The three views ViMax treats as the canonical set for identity conditioning. */
export const CANONICAL_PORTRAIT_VIEWS: PortraitView[] = ["front", "side", "back"];
