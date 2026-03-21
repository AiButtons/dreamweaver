import { StoryNodeData, NodeType } from "./types";

export const createDefaultStoryNodeData = (
  label: string,
  segment: string,
  nodeType: NodeType = "scene",
): StoryNodeData => ({
  label,
  segment,
  nodeType,
  entityRefs: {
    characterIds: [],
  },
  continuity: {
    identityLockVersion: 1,
    wardrobeVariantIds: [],
    consistencyStatus: "ok",
  },
  historyContext: {
    eventIds: [],
    rollingSummary: "",
    tokenBudgetUsed: 0,
    lineageHash: "",
  },
  promptPack: {
    continuityDirectives: [],
  },
  media: {
    images: [],
    videos: [],
  },
  imageHistory: [],
});

