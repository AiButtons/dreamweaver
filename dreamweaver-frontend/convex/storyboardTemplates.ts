import { ConvexError } from "convex/values";

export type StoryboardTemplateId =
  | "blank_canvas"
  | "three_act_feature"
  | "branching_thriller"
  | "dialogue_scene"
  | "music_video"
  | "ad_spot_30s";

export type TemplateNodeType =
  | "scene"
  | "shot"
  | "branch"
  | "merge"
  | "character_ref"
  | "background_ref";

type TemplateNodeSeed = {
  nodeId: string;
  nodeType: TemplateNodeType;
  label: string;
  segment: string;
  position: { x: number; y: number };
};

type TemplateEdgeSeed = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeType: "serial" | "parallel" | "branch" | "merge";
  isPrimary?: boolean;
  order?: number;
  branchId?: string;
};

export type StoryboardTemplateSeed = {
  templateId: StoryboardTemplateId;
  name: string;
  description: string;
  visualTheme: string;
  mode: "graph_studio" | "agent_draft";
  nodes: TemplateNodeSeed[];
  edges: TemplateEdgeSeed[];
};

export const BUILT_IN_STORYBOARD_TEMPLATES: StoryboardTemplateSeed[] = [
  {
    templateId: "blank_canvas",
    name: "Blank Canvas",
    description: "Start from scratch with an empty storyboard.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [],
    edges: [],
  },
  {
    templateId: "three_act_feature",
    name: "Three-Act Feature",
    description: "Classic setup, confrontation, and resolution scaffold.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [
      {
        nodeId: "tmpl_setup",
        nodeType: "scene",
        label: "Act I: Setup",
        segment: "Introduce protagonist, world rules, and inciting incident.",
        position: { x: 100, y: 140 },
      },
      {
        nodeId: "tmpl_confrontation",
        nodeType: "scene",
        label: "Act II: Confrontation",
        segment: "Escalate stakes and force difficult decisions.",
        position: { x: 560, y: 140 },
      },
      {
        nodeId: "tmpl_resolution",
        nodeType: "scene",
        label: "Act III: Resolution",
        segment: "Resolve central conflict and emotional arc.",
        position: { x: 1020, y: 140 },
      },
    ],
    edges: [
      {
        edgeId: "tmpl_e_setup_confrontation",
        sourceNodeId: "tmpl_setup",
        targetNodeId: "tmpl_confrontation",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_confrontation_resolution",
        sourceNodeId: "tmpl_confrontation",
        targetNodeId: "tmpl_resolution",
        edgeType: "serial",
        isPrimary: true,
      },
    ],
  },
  {
    templateId: "branching_thriller",
    name: "Branching Thriller",
    description: "Primary line with a branch and merge for alternate outcomes.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [
      {
        nodeId: "tmpl_hook",
        nodeType: "scene",
        label: "Hook",
        segment: "Open with a high-tension reveal.",
        position: { x: 80, y: 180 },
      },
      {
        nodeId: "tmpl_branch_a",
        nodeType: "scene",
        label: "Path A",
        segment: "Hero pursues the obvious lead.",
        position: { x: 480, y: 80 },
      },
      {
        nodeId: "tmpl_branch_b",
        nodeType: "scene",
        label: "Path B",
        segment: "Hero takes a risky alternate route.",
        position: { x: 480, y: 300 },
      },
      {
        nodeId: "tmpl_merge",
        nodeType: "merge",
        label: "Converge",
        segment: "Both paths reveal different halves of the truth.",
        position: { x: 900, y: 190 },
      },
    ],
    edges: [
      {
        edgeId: "tmpl_e_hook_a",
        sourceNodeId: "tmpl_hook",
        targetNodeId: "tmpl_branch_a",
        edgeType: "branch",
        isPrimary: true,
        branchId: "a",
      },
      {
        edgeId: "tmpl_e_hook_b",
        sourceNodeId: "tmpl_hook",
        targetNodeId: "tmpl_branch_b",
        edgeType: "parallel",
        isPrimary: false,
        branchId: "b",
      },
      {
        edgeId: "tmpl_e_a_merge",
        sourceNodeId: "tmpl_branch_a",
        targetNodeId: "tmpl_merge",
        edgeType: "merge",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_b_merge",
        sourceNodeId: "tmpl_branch_b",
        targetNodeId: "tmpl_merge",
        edgeType: "merge",
        isPrimary: false,
      },
    ],
  },
  {
    templateId: "dialogue_scene",
    name: "Dialogue Scene",
    description: "Coverage plan for two-character conversation beats.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [
      {
        nodeId: "tmpl_wide",
        nodeType: "shot",
        label: "Wide Master",
        segment: "Establish geography and emotional distance.",
        position: { x: 100, y: 150 },
      },
      {
        nodeId: "tmpl_over_shoulder_a",
        nodeType: "shot",
        label: "OTS A",
        segment: "Character A speaks key line; subtle reaction from B.",
        position: { x: 520, y: 70 },
      },
      {
        nodeId: "tmpl_over_shoulder_b",
        nodeType: "shot",
        label: "OTS B",
        segment: "Character B counters with rising tension.",
        position: { x: 520, y: 250 },
      },
      {
        nodeId: "tmpl_closeup",
        nodeType: "shot",
        label: "Close-up Turn",
        segment: "Capture the emotional pivot in close detail.",
        position: { x: 940, y: 150 },
      },
    ],
    edges: [
      {
        edgeId: "tmpl_e_wide_a",
        sourceNodeId: "tmpl_wide",
        targetNodeId: "tmpl_over_shoulder_a",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_a_b",
        sourceNodeId: "tmpl_over_shoulder_a",
        targetNodeId: "tmpl_over_shoulder_b",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_b_close",
        sourceNodeId: "tmpl_over_shoulder_b",
        targetNodeId: "tmpl_closeup",
        edgeType: "serial",
        isPrimary: true,
      },
    ],
  },
  {
    templateId: "music_video",
    name: "Music Video",
    description: "Performance + narrative intercut scaffold.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [
      {
        nodeId: "tmpl_intro_perf",
        nodeType: "shot",
        label: "Intro Performance",
        segment: "Open with iconic performance frame.",
        position: { x: 120, y: 120 },
      },
      {
        nodeId: "tmpl_narrative_cut",
        nodeType: "scene",
        label: "Narrative Cutaway",
        segment: "Insert narrative beat that reframes lyrics.",
        position: { x: 520, y: 120 },
      },
      {
        nodeId: "tmpl_drop_montage",
        nodeType: "shot",
        label: "Drop Montage",
        segment: "Fast cuts synced to chorus and percussion hits.",
        position: { x: 920, y: 120 },
      },
    ],
    edges: [
      {
        edgeId: "tmpl_e_intro_cut",
        sourceNodeId: "tmpl_intro_perf",
        targetNodeId: "tmpl_narrative_cut",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_cut_drop",
        sourceNodeId: "tmpl_narrative_cut",
        targetNodeId: "tmpl_drop_montage",
        edgeType: "serial",
        isPrimary: true,
      },
    ],
  },
  {
    templateId: "ad_spot_30s",
    name: "30s Ad Spot",
    description: "Hook, value, proof, and CTA structure for short-form ads.",
    visualTheme: "cinematic_studio",
    mode: "graph_studio",
    nodes: [
      {
        nodeId: "tmpl_hook_3s",
        nodeType: "shot",
        label: "0-3s Hook",
        segment: "Visual interruption and core promise.",
        position: { x: 80, y: 150 },
      },
      {
        nodeId: "tmpl_value_12s",
        nodeType: "shot",
        label: "3-15s Value",
        segment: "Demonstrate the product's primary outcome.",
        position: { x: 460, y: 150 },
      },
      {
        nodeId: "tmpl_proof_9s",
        nodeType: "shot",
        label: "15-24s Proof",
        segment: "Social proof, before-after, or trust signal.",
        position: { x: 840, y: 150 },
      },
      {
        nodeId: "tmpl_cta_6s",
        nodeType: "shot",
        label: "24-30s CTA",
        segment: "Clear action with urgency and brand lockup.",
        position: { x: 1220, y: 150 },
      },
    ],
    edges: [
      {
        edgeId: "tmpl_e_hook_value",
        sourceNodeId: "tmpl_hook_3s",
        targetNodeId: "tmpl_value_12s",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_value_proof",
        sourceNodeId: "tmpl_value_12s",
        targetNodeId: "tmpl_proof_9s",
        edgeType: "serial",
        isPrimary: true,
      },
      {
        edgeId: "tmpl_e_proof_cta",
        sourceNodeId: "tmpl_proof_9s",
        targetNodeId: "tmpl_cta_6s",
        edgeType: "serial",
        isPrimary: true,
      },
    ],
  },
];

export const getStoryboardTemplateById = (templateId: string): StoryboardTemplateSeed => {
  const template = BUILT_IN_STORYBOARD_TEMPLATES.find((row) => row.templateId === templateId);
  if (!template) {
    throw new ConvexError(`Template not found: ${templateId}`);
  }
  return template;
};

