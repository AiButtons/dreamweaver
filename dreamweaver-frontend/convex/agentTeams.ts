import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ensureStoryboardEditable, requireUser } from "./storyboardAccess";

const riskLevel = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

const teamVisibility = v.union(
  v.literal("private"),
  v.literal("workspace"),
  v.literal("public_read"),
);

const teamStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

const teamMemberInput = v.object({
  memberId: v.optional(v.string()),
  agentName: v.string(),
  role: v.string(),
  persona: v.string(),
  nicheDescription: v.string(),
  toolScope: v.array(v.string()),
  resourceScope: v.array(v.string()),
  weight: v.number(),
  enabled: v.boolean(),
});

const teamPolicyInput = v.object({
  requiresHitl: v.boolean(),
  riskThresholds: v.object({
    warnAt: riskLevel,
    blockAt: riskLevel,
  }),
  maxBatchSize: v.number(),
  quotaProfileId: v.string(),
  maxRunOps: v.number(),
  maxConcurrentRuns: v.number(),
  quotaEnforced: v.boolean(),
});

type TeamPolicy = {
  requiresHitl: boolean;
  riskThresholds: {
    warnAt: "low" | "medium" | "high" | "critical";
    blockAt: "low" | "medium" | "high" | "critical";
  };
  maxBatchSize: number;
  quotaProfileId: string;
  maxRunOps: number;
  maxConcurrentRuns: number;
  quotaEnforced: boolean;
};

type TeamMember = {
  memberId: string;
  agentName: string;
  role: string;
  persona: string;
  nicheDescription: string;
  toolScope: string[];
  resourceScope: string[];
  weight: number;
  enabled: boolean;
};

type TeamDraftSpec = {
  teamGoal: string;
  policy: TeamPolicy;
  members: TeamMember[];
  toolAllowlist: string[];
  resourceScopes: string[];
};

const toStableId = (prefix: string, seed: string) => {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  const suffix = (hash >>> 0).toString(16);
  return `${prefix}_${suffix}`;
};

const parseJsonObject = <T>(raw: string, fallback: T): T => {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed;
  } catch {
    return fallback;
  }
};

const normalizeMember = (member: {
  memberId?: string;
  agentName: string;
  role: string;
  persona: string;
  nicheDescription: string;
  toolScope: string[];
  resourceScope: string[];
  weight: number;
  enabled: boolean;
}, index: number): TeamMember => ({
  memberId: member.memberId && member.memberId.length > 0
    ? member.memberId
    : `member_${index + 1}`,
  agentName: member.agentName.trim(),
  role: member.role.trim(),
  persona: member.persona.trim(),
  nicheDescription: member.nicheDescription.trim(),
  toolScope: [...new Set(member.toolScope.map((item) => item.trim()).filter((item) => item.length > 0))],
  resourceScope: [...new Set(member.resourceScope.map((item) => item.trim()).filter((item) => item.length > 0))],
  weight: Number.isFinite(member.weight) ? member.weight : 1,
  enabled: member.enabled,
});

const defaultPolicy = (quotaProfileId = "default_standard"): TeamPolicy => ({
  requiresHitl: true,
  riskThresholds: {
    warnAt: "medium",
    blockAt: "high",
  },
  maxBatchSize: 5,
  quotaProfileId,
  maxRunOps: 24,
  maxConcurrentRuns: 2,
  quotaEnforced: true,
});

const defaultMembers = (): TeamMember[] => [
  {
    memberId: "planner",
    agentName: "planner",
    role: "Planner",
    persona: "Strategic planner with production awareness.",
    nicheDescription: "Builds deterministic graph/media operation plans.",
    toolScope: ["graph.patch", "media.prompt", "execution.plan"],
    resourceScope: ["storyboard.graph", "storyboard.context", "media.apis"],
    weight: 1,
    enabled: true,
  },
  {
    memberId: "continuity_critic",
    agentName: "continuity_critic",
    role: "Continuity Critic",
    persona: "Strict continuity guardian.",
    nicheDescription: "Detects contradiction, identity drift, and merge conflicts.",
    toolScope: ["continuity.check", "simulation.critic"],
    resourceScope: ["storyboard.context", "storyboard.events"],
    weight: 1,
    enabled: true,
  },
  {
    memberId: "visual_director",
    agentName: "visual_director",
    role: "Visual Director",
    persona: "Cinematic visual specialist.",
    nicheDescription: "Optimizes prompts while preserving character identity lock.",
    toolScope: ["media.prompt", "media.compose", "media.video"],
    resourceScope: ["media.apis", "storyboard.context"],
    weight: 1,
    enabled: true,
  },
];

const prebuiltTemplates: Array<{
  slug: string;
  name: string;
  description: string;
  teamGoal: string;
  policy: TeamPolicy;
  members: TeamMember[];
  toolAllowlist: string[];
  resourceScopes: string[];
}> = [
  {
    slug: "producer_guarded_default",
    name: "Producer Guarded Default",
    description: "Balanced planning + continuity + guardrails with strict HITL.",
    teamGoal: "Deliver safe, high-quality storyboarding proposals with deterministic approvals.",
    policy: defaultPolicy("default_standard"),
    members: defaultMembers(),
    toolAllowlist: ["graph.patch", "media.prompt", "execution.plan", "simulation.critic", "dailies.batch"],
    resourceScopes: ["storyboard.graph", "storyboard.context", "storyboard.events", "media.apis"],
  },
  {
    slug: "continuity_first",
    name: "Continuity First",
    description: "Prioritizes contradiction detection and identity lock enforcement.",
    teamGoal: "Protect character and narrative continuity in every branch and merge.",
    policy: {
      ...defaultPolicy("default_standard"),
      maxBatchSize: 3,
      riskThresholds: { warnAt: "low", blockAt: "medium" },
    },
    members: defaultMembers().map((member) =>
      member.agentName === "continuity_critic" ? { ...member, weight: 1.4 } : member
    ),
    toolAllowlist: ["graph.patch", "execution.plan", "simulation.critic"],
    resourceScopes: ["storyboard.graph", "storyboard.context", "storyboard.events"],
  },
  {
    slug: "visual_director",
    name: "Visual Director",
    description: "Optimizes cinematic prompt craft under identity lock.",
    teamGoal: "Generate premium visuals and motion while preserving identity consistency.",
    policy: {
      ...defaultPolicy("default_standard"),
      maxBatchSize: 4,
    },
    members: defaultMembers().map((member) =>
      member.agentName === "visual_director" ? { ...member, weight: 1.5 } : member
    ),
    toolAllowlist: ["media.prompt", "media.compose", "media.video", "execution.plan"],
    resourceScopes: ["storyboard.context", "media.apis"],
  },
  {
    slug: "branch_architect",
    name: "Branch Architect",
    description: "Focused on branch-heavy structures and semantic merge strategy.",
    teamGoal: "Expand complex branching narratives with conflict-aware merge plans.",
    policy: {
      ...defaultPolicy("default_standard"),
      maxBatchSize: 6,
    },
    members: defaultMembers(),
    toolAllowlist: ["graph.patch", "execution.plan", "simulation.critic"],
    resourceScopes: ["storyboard.graph", "storyboard.events"],
  },
  {
    slug: "dailies_autopilot",
    name: "Dailies Autopilot",
    description: "Builds daily candidate reels with strict producer approval gates.",
    teamGoal: "Produce autonomous dailies and safe batched recommendations.",
    policy: {
      ...defaultPolicy("default_standard"),
      maxBatchSize: 8,
    },
    members: defaultMembers(),
    toolAllowlist: ["dailies.batch", "media.prompt", "execution.plan", "simulation.critic"],
    resourceScopes: ["storyboard.graph", "storyboard.context", "media.apis"],
  },
  {
    slug: "repair_specialist",
    name: "Repair Specialist",
    description: "Minimal-change repair plans driven by simulation and continuity.",
    teamGoal: "Repair continuity and causality issues with minimal collateral edits.",
    policy: {
      ...defaultPolicy("default_standard"),
      maxBatchSize: 4,
    },
    members: defaultMembers(),
    toolAllowlist: ["simulation.critic", "execution.plan", "graph.patch"],
    resourceScopes: ["storyboard.graph", "storyboard.events", "storyboard.context"],
  },
];

const ensureQuotaProfileExists = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (...args: unknown[]) => {
          unique: () => Promise<Record<string, unknown> | null>;
        };
      };
      insert: (table: string, value: Record<string, unknown>) => Promise<string>;
      get: (id: string) => Promise<Record<string, unknown> | null>;
    };
  },
  ownerUserId: string,
  quotaProfileId: string,
) => {
  const existing = await ctx.db
    .query("quotaProfiles")
    .withIndex("by_owner_profile", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", quotaProfileId),
    )
    .unique();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const insertedId = await ctx.db.insert("quotaProfiles", {
    ownerUserId,
    quotaProfileId,
    name: "Standard Team Profile",
    dailyMediaBudget: 20,
    dailyMutationOps: 120,
    maxRunOps: 24,
    maxConcurrentRuns: 2,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(insertedId);
};

const createRevisionInternal = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (...args: unknown[]) => {
          collect: () => Promise<Array<Record<string, unknown>>>;
          unique: () => Promise<Record<string, unknown> | null>;
        };
      };
      insert: (table: string, value: Record<string, unknown>) => Promise<string>;
      patch: (id: string, value: Record<string, unknown>) => Promise<void>;
    };
  },
  args: {
    teamDocId: string;
    teamId: string;
    ownerUserId: string;
    teamGoal: string;
    policy: TeamPolicy;
    members: TeamMember[];
    toolAllowlist: string[];
    resourceScopes: string[];
    publish: boolean;
  },
) => {
  if (args.members.length === 0) {
    throw new ConvexError("Team revision must include at least one member.");
  }
  await ensureQuotaProfileExists(ctx, args.ownerUserId, args.policy.quotaProfileId);

  const existingRevisions = await ctx.db
    .query("agentTeamRevisions")
    .withIndex("by_team_version", (q) => q.eq("teamId", args.teamDocId))
    .collect();
  const maxVersion = existingRevisions.reduce(
    (currentMax, row) => Math.max(currentMax, Number(row.version ?? 0)),
    0,
  );
  const version = maxVersion + 1;
  const revisionId = `${args.teamId}:v${version}`;
  const now = Date.now();

  const revisionDocId = await ctx.db.insert("agentTeamRevisions", {
    teamId: args.teamDocId,
    revisionId,
    version,
    teamGoal: args.teamGoal,
    policyJson: JSON.stringify(args.policy),
    membersJson: JSON.stringify(args.members),
    toolAllowlistJson: JSON.stringify(args.toolAllowlist),
    resourceScopesJson: JSON.stringify(args.resourceScopes),
    published: args.publish,
    createdAt: now,
  });

  for (const member of args.members) {
    await ctx.db.insert("agentTeamMembers", {
      teamId: args.teamDocId,
      revisionId,
      memberId: member.memberId,
      agentName: member.agentName,
      role: member.role,
      persona: member.persona,
      nicheDescription: member.nicheDescription,
      toolScope: member.toolScope,
      resourceScope: member.resourceScope,
      weight: member.weight,
      enabled: member.enabled,
      createdAt: now,
    });
  }

  const existingPolicy = await ctx.db
    .query("agentTeamRunPolicies")
    .withIndex("by_team_revision", (q) =>
      q.eq("teamId", args.teamDocId).eq("revisionId", revisionId),
    )
    .unique();
  if (!existingPolicy) {
    await ctx.db.insert("agentTeamRunPolicies", {
      teamId: args.teamDocId,
      revisionId,
      requiresHitl: args.policy.requiresHitl,
      riskThresholdsJson: JSON.stringify(args.policy.riskThresholds),
      maxBatchSize: args.policy.maxBatchSize,
      quotaProfileId: args.policy.quotaProfileId,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (args.publish) {
    await Promise.all(
      existingRevisions.map((revision) => ctx.db.patch(String(revision._id), { published: false })),
    );
    await ctx.db.patch(args.teamDocId, {
      currentPublishedRevisionId: revisionId,
      updatedAt: now,
    });
  } else {
    await ctx.db.patch(args.teamDocId, {
      updatedAt: now,
    });
  }

  return {
    revisionDocId,
    revisionId,
    version,
  };
};

const resolveTeamByExternalId = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (...args: unknown[]) => {
          unique: () => Promise<Record<string, unknown> | null>;
        };
      };
    };
  },
  ownerUserId: string,
  teamId: string,
) => {
  const team = await ctx.db
    .query("agentTeams")
    .withIndex("by_owner_team", (q) =>
      q.eq("ownerUserId", ownerUserId).eq("teamId", teamId),
    )
    .unique();
  if (!team) {
    throw new ConvexError("Team not found");
  }
  return team;
};

const resolveRevision = async (
  ctx: {
    db: {
      query: (table: string) => {
        withIndex: (...args: unknown[]) => {
          unique: () => Promise<Record<string, unknown> | null>;
          collect: () => Promise<Array<Record<string, unknown>>>;
        };
      };
    };
  },
  teamDocId: string,
  revisionId?: string,
) => {
  if (revisionId && revisionId.length > 0) {
    const explicit = await ctx.db
      .query("agentTeamRevisions")
      .withIndex("by_team_revision", (q) =>
        q.eq("teamId", teamDocId).eq("revisionId", revisionId),
      )
      .unique();
    if (!explicit) {
      throw new ConvexError("Team revision not found");
    }
    return explicit;
  }

  const publishedRows = await ctx.db
    .query("agentTeamRevisions")
    .withIndex("by_team_published_createdAt", (q) =>
      q.eq("teamId", teamDocId).eq("published", true),
    )
    .collect();
  if (publishedRows.length > 0) {
    return publishedRows[publishedRows.length - 1];
  }
  const allRows = await ctx.db
    .query("agentTeamRevisions")
    .withIndex("by_team_version", (q) => q.eq("teamId", teamDocId))
    .collect();
  if (allRows.length === 0) {
    throw new ConvexError("No revisions found for team");
  }
  return allRows.reduce((latest, row) =>
    Number(row.version ?? 0) > Number(latest.version ?? 0) ? row : latest
  );
};

const promptDraftToSpec = (inputPrompt: string): TeamDraftSpec => {
  const lowered = inputPrompt.toLowerCase();
  const wantsContinuity = lowered.includes("continuity") || lowered.includes("consisten");
  const wantsVisual = lowered.includes("visual") || lowered.includes("cinematic") || lowered.includes("image");
  const wantsBranches = lowered.includes("branch") || lowered.includes("parallel");
  const wantsDailies = lowered.includes("dailies") || lowered.includes("daily");
  const wantsRepair = lowered.includes("repair") || lowered.includes("critic");

  const members = defaultMembers().map((member) => {
    if (wantsContinuity && member.agentName === "continuity_critic") {
      return { ...member, weight: 1.5 };
    }
    if (wantsVisual && member.agentName === "visual_director") {
      return { ...member, weight: 1.5 };
    }
    return member;
  });

  const teamGoal = wantsContinuity
    ? "Keep strict character and narration continuity while drafting branches."
    : wantsVisual
      ? "Create premium cinematic outputs with stable character identity."
      : "Plan and execute safe storyboard mutations with high producer control.";

  const toolAllowlist = [
    "graph.patch",
    "execution.plan",
    ...(wantsVisual ? ["media.prompt", "media.compose", "media.video"] : ["media.prompt"]),
    ...(wantsDailies ? ["dailies.batch"] : []),
    ...(wantsRepair || wantsContinuity ? ["simulation.critic"] : []),
    ...(wantsBranches ? ["branch.merge"] : []),
  ];
  const resourceScopes = [
    "storyboard.graph",
    "storyboard.context",
    ...(wantsContinuity ? ["storyboard.events"] : []),
    ...(wantsVisual ? ["media.apis"] : []),
  ];

  const policy: TeamPolicy = {
    ...defaultPolicy("default_standard"),
    maxBatchSize: wantsDailies ? 8 : wantsContinuity ? 4 : 5,
    riskThresholds: wantsContinuity
      ? { warnAt: "low", blockAt: "medium" }
      : { warnAt: "medium", blockAt: "high" },
  };

  return {
    teamGoal,
    policy,
    members,
    toolAllowlist: [...new Set(toolAllowlist)],
    resourceScopes: [...new Set(resourceScopes)],
  };
};

const validateRevisionForPublish = (revision: Record<string, unknown>) => {
  const members = parseJsonObject<TeamMember[]>(String(revision.membersJson ?? "[]"), []);
  const policy = parseJsonObject<TeamPolicy>(
    String(revision.policyJson ?? "{}"),
    defaultPolicy("default_standard"),
  );
  const allowlist = parseJsonObject<string[]>(String(revision.toolAllowlistJson ?? "[]"), []);
  if (members.length === 0 || !members.some((member) => member.enabled)) {
    throw new ConvexError("Cannot publish revision without at least one enabled member.");
  }
  if (allowlist.length === 0) {
    throw new ConvexError("Cannot publish revision without tool allowlist entries.");
  }
  if (!policy.quotaProfileId || policy.maxBatchSize < 1 || policy.maxRunOps < 1) {
    throw new ConvexError("Cannot publish revision with invalid policy constraints.");
  }
  if (
    policy.maxConcurrentRuns < 1
    || policy.maxBatchSize > policy.maxRunOps
  ) {
    throw new ConvexError("Cannot publish revision with inconsistent runtime limits.");
  }
  const riskOrder: Record<TeamPolicy["riskThresholds"]["warnAt"], number> = {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  };
  if (riskOrder[policy.riskThresholds.warnAt] > riskOrder[policy.riskThresholds.blockAt]) {
    throw new ConvexError("Cannot publish revision when warnAt is above blockAt.");
  }

  const memberIds = new Set<string>();
  const agentNames = new Set<string>();
  const normalizedAllowlist = new Set(allowlist.map((token) => token.trim()).filter((token) => token.length > 0));
  const resourceScopes = parseJsonObject<string[]>(
    String(revision.resourceScopesJson ?? "[]"),
    [],
  );
  const normalizedResourceScopes = new Set(
    resourceScopes.map((scope) => scope.trim()).filter((scope) => scope.length > 0),
  );

  for (const member of members) {
    if (memberIds.has(member.memberId)) {
      throw new ConvexError(`Duplicate memberId in revision: ${member.memberId}`);
    }
    if (agentNames.has(member.agentName)) {
      throw new ConvexError(`Duplicate agentName in revision: ${member.agentName}`);
    }
    memberIds.add(member.memberId);
    agentNames.add(member.agentName);

    if (!member.enabled) {
      continue;
    }
    if (member.toolScope.length === 0) {
      throw new ConvexError(`Enabled member ${member.agentName} must have toolScope.`);
    }
    if (member.resourceScope.length === 0) {
      throw new ConvexError(`Enabled member ${member.agentName} must have resourceScope.`);
    }
    for (const token of member.toolScope) {
      const normalizedToken = token.trim();
      if (normalizedToken.length === 0) {
        continue;
      }
      if (normalizedAllowlist.has("*")) {
        continue;
      }
      if (!normalizedAllowlist.has(normalizedToken)) {
        throw new ConvexError(
          `Member ${member.agentName} toolScope token not allowlisted: ${normalizedToken}`,
        );
      }
    }
    for (const scope of member.resourceScope) {
      const normalizedScope = scope.trim();
      if (normalizedScope.length === 0) {
        continue;
      }
      if (!normalizedResourceScopes.has(normalizedScope)) {
        throw new ConvexError(
          `Member ${member.agentName} resource scope is not in revision resourceScopes: ${normalizedScope}`,
        );
      }
    }
  }
};

export const bootstrapPrebuiltTeams = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerUserId = await requireUser(ctx);
    const existingPrebuilt = await ctx.db
      .query("agentTeams")
      .withIndex("by_owner_prebuilt_updatedAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("isPrebuilt", true),
      )
      .collect();
    if (existingPrebuilt.length > 0) {
      return { created: 0, total: existingPrebuilt.length };
    }

    let created = 0;
    for (const template of prebuiltTemplates) {
      const now = Date.now();
      const teamDocId = await ctx.db.insert("agentTeams", {
        teamId: template.slug,
        name: template.name,
        description: template.description,
        ownerUserId,
        visibility: "private",
        status: "active",
        isPrebuilt: true,
        currentPublishedRevisionId: undefined,
        createdAt: now,
        updatedAt: now,
      });
      await createRevisionInternal(ctx, {
        teamDocId,
        teamId: template.slug,
        ownerUserId,
        teamGoal: template.teamGoal,
        policy: template.policy,
        members: template.members,
        toolAllowlist: template.toolAllowlist,
        resourceScopes: template.resourceScopes,
        publish: true,
      });
      created += 1;
    }
    return { created, total: created };
  },
});

export const createTeam = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    visibility: v.optional(teamVisibility),
    teamGoal: v.optional(v.string()),
    policy: v.optional(teamPolicyInput),
    members: v.optional(v.array(teamMemberInput)),
    toolAllowlist: v.optional(v.array(v.string())),
    resourceScopes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const now = Date.now();
    const teamId = toStableId("team", `${ownerUserId}:${args.name}:${now}`);
    const teamDocId = await ctx.db.insert("agentTeams", {
      teamId,
      name: args.name.trim(),
      description: args.description.trim(),
      ownerUserId,
      visibility: args.visibility ?? "private",
      status: "active",
      isPrebuilt: false,
      currentPublishedRevisionId: undefined,
      createdAt: now,
      updatedAt: now,
    });

    const teamGoal = args.teamGoal?.trim() || "Deliver approved storyboard mutations with strict HITL.";
    const policy = args.policy ?? defaultPolicy("default_standard");
    const members = (args.members ?? defaultMembers()).map((member, index) => normalizeMember(member, index));
    const toolAllowlist = [...new Set((args.toolAllowlist ?? ["graph.patch", "media.prompt", "execution.plan"]).map((item) => item.trim()).filter((item) => item.length > 0))];
    const resourceScopes = [...new Set((args.resourceScopes ?? ["storyboard.graph", "storyboard.context", "media.apis"]).map((item) => item.trim()).filter((item) => item.length > 0))];

    const revision = await createRevisionInternal(ctx, {
      teamDocId,
      teamId,
      ownerUserId,
      teamGoal,
      policy,
      members,
      toolAllowlist,
      resourceScopes,
      publish: true,
    });

    return {
      teamId,
      revisionId: revision.revisionId,
      version: revision.version,
    };
  },
});

export const updateTeam = mutation({
  args: {
    teamId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    visibility: v.optional(teamVisibility),
    status: v.optional(teamStatus),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    await ctx.db.patch(String(team._id), {
      name: args.name?.trim() || team.name,
      description: args.description?.trim() || team.description,
      visibility: args.visibility ?? team.visibility,
      status: args.status ?? team.status,
      updatedAt: Date.now(),
    });
    return team._id;
  },
});

export const archiveTeam = mutation({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    await ctx.db.patch(String(team._id), {
      status: "archived",
      updatedAt: Date.now(),
    });
    return team._id;
  },
});

export const listTeams = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    includePrebuilt: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 300);
    const teams = await ctx.db
      .query("agentTeams")
      .withIndex("by_owner_updatedAt", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .take(limit * 2);

    const filtered = teams.filter((team) => {
      if (!args.includeArchived && team.status === "archived") {
        return false;
      }
      if (args.includePrebuilt === false && team.isPrebuilt) {
        return false;
      }
      return true;
    }).slice(0, limit);

    const enriched = await Promise.all(
      filtered.map(async (team) => {
        const revisions = await ctx.db
          .query("agentTeamRevisions")
          .withIndex("by_team_version", (q) => q.eq("teamId", team._id))
          .collect();
        const published = revisions
          .filter((revision) => Boolean(revision.published))
          .reduce((latest, row) =>
            !latest || Number(row.version ?? 0) > Number(latest.version ?? 0) ? row : latest
          , null as Record<string, unknown> | null);
        return {
          ...team,
          revisionCount: revisions.length,
          publishedRevisionId: published?.revisionId,
          publishedVersion: published ? Number(published.version ?? 0) : undefined,
        };
      }),
    );

    return enriched;
  },
});

export const createRevision = mutation({
  args: {
    teamId: v.string(),
    teamGoal: v.string(),
    policy: teamPolicyInput,
    members: v.array(teamMemberInput),
    toolAllowlist: v.array(v.string()),
    resourceScopes: v.array(v.string()),
    publish: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const members = args.members.map((member, index) => normalizeMember(member, index));
    const result = await createRevisionInternal(ctx, {
      teamDocId: String(team._id),
      teamId: args.teamId,
      ownerUserId,
      teamGoal: args.teamGoal.trim(),
      policy: args.policy,
      members,
      toolAllowlist: [...new Set(args.toolAllowlist.map((item) => item.trim()).filter((item) => item.length > 0))],
      resourceScopes: [...new Set(args.resourceScopes.map((item) => item.trim()).filter((item) => item.length > 0))],
      publish: args.publish ?? false,
    });
    return result;
  },
});

export const updateRevisionMember = mutation({
  args: {
    teamId: v.string(),
    revisionId: v.string(),
    member: teamMemberInput,
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const revision = await ctx.db
      .query("agentTeamRevisions")
      .withIndex("by_team_revision", (q) =>
        q.eq("teamId", team._id).eq("revisionId", args.revisionId),
      )
      .unique();
    if (!revision) {
      throw new ConvexError("Revision not found");
    }
    const existingMembers = parseJsonObject<TeamMember[]>(String(revision.membersJson), []);
    const nextMember = normalizeMember(args.member, existingMembers.length);
    const nextMembers = existingMembers.some((member) => member.memberId === nextMember.memberId)
      ? existingMembers.map((member) => member.memberId === nextMember.memberId ? nextMember : member)
      : [...existingMembers, nextMember];
    await ctx.db.patch(String(revision._id), {
      membersJson: JSON.stringify(nextMembers),
    });
    const memberRow = await ctx.db
      .query("agentTeamMembers")
      .withIndex("by_team_revision_agent", (q) =>
        q.eq("teamId", team._id).eq("revisionId", args.revisionId).eq("agentName", nextMember.agentName),
      )
      .unique();
    if (memberRow) {
      await ctx.db.patch(String(memberRow._id), {
        memberId: nextMember.memberId,
        role: nextMember.role,
        persona: nextMember.persona,
        nicheDescription: nextMember.nicheDescription,
        toolScope: nextMember.toolScope,
        resourceScope: nextMember.resourceScope,
        weight: nextMember.weight,
        enabled: nextMember.enabled,
      });
    } else {
      await ctx.db.insert("agentTeamMembers", {
        teamId: team._id,
        revisionId: args.revisionId,
        ...nextMember,
        createdAt: Date.now(),
      });
    }
    return { revisionId: args.revisionId, memberId: nextMember.memberId };
  },
});

export const publishRevision = mutation({
  args: {
    teamId: v.string(),
    revisionId: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const revisions = await ctx.db
      .query("agentTeamRevisions")
      .withIndex("by_team_version", (q) => q.eq("teamId", team._id))
      .collect();
    const target = revisions.find((revision) => revision.revisionId === args.revisionId);
    if (!target) {
      throw new ConvexError("Revision not found");
    }
    validateRevisionForPublish(target);
    const now = Date.now();
    await Promise.all(
      revisions.map((revision) => ctx.db.patch(String(revision._id), {
        published: revision.revisionId === args.revisionId,
      })),
    );
    await ctx.db.patch(String(team._id), {
      currentPublishedRevisionId: args.revisionId,
      updatedAt: now,
    });
    return { teamId: args.teamId, revisionId: args.revisionId };
  },
});

export const rollbackRevision = mutation({
  args: {
    teamId: v.string(),
    revisionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await publishRevision.handler(ctx, args);
  },
});

export const getRevision = query({
  args: {
    teamId: v.string(),
    revisionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const revision = await resolveRevision(
      ctx,
      String(team._id),
      args.revisionId,
    );
    const members = parseJsonObject<TeamMember[]>(String(revision.membersJson), []);
    const policy = parseJsonObject<TeamPolicy>(String(revision.policyJson), defaultPolicy("default_standard"));
    const toolAllowlist = parseJsonObject<string[]>(String(revision.toolAllowlistJson), []);
    const resourceScopes = parseJsonObject<string[]>(String(revision.resourceScopesJson), []);
    return {
      team,
      revision: {
        revisionId: revision.revisionId,
        version: revision.version,
        teamGoal: revision.teamGoal,
        published: revision.published,
        createdAt: revision.createdAt,
        policy,
        members,
        toolAllowlist,
        resourceScopes,
      },
    };
  },
});

export const listRevisions = query({
  args: {
    teamId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const limit = Math.min(Math.max(args.limit ?? 30, 1), 200);
    const revisions = await ctx.db
      .query("agentTeamRevisions")
      .withIndex("by_team_version", (q) => q.eq("teamId", team._id))
      .order("desc")
      .take(limit);
    return revisions.map((revision) => ({
      revisionId: String(revision.revisionId),
      version: Number(revision.version),
      teamGoal: String(revision.teamGoal),
      published: Boolean(revision.published),
      createdAt: Number(revision.createdAt),
    }));
  },
});

export const generateTeamFromPrompt = mutation({
  args: {
    inputPrompt: v.string(),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const spec = promptDraftToSpec(args.inputPrompt);
    const now = Date.now();
    const draftId = toStableId("draft", `${ownerUserId}:${args.inputPrompt}:${now}`);
    await ctx.db.insert("teamPromptDrafts", {
      draftId,
      ownerUserId,
      inputPrompt: args.inputPrompt,
      generatedSpecJson: JSON.stringify(spec),
      accepted: false,
      createdAt: now,
      updatedAt: now,
    });
    return {
      draftId,
      generatedSpec: spec,
    };
  },
});

export const applyPromptDraftToRevision = mutation({
  args: {
    draftId: v.string(),
    teamId: v.string(),
    publish: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    const draft = await ctx.db
      .query("teamPromptDrafts")
      .withIndex("by_owner_draft", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("draftId", args.draftId),
      )
      .unique();
    if (!draft) {
      throw new ConvexError("Draft not found");
    }
    const team = await resolveTeamByExternalId(ctx, ownerUserId, args.teamId);
    const spec = parseJsonObject<TeamDraftSpec>(draft.generatedSpecJson, promptDraftToSpec(draft.inputPrompt));
    const normalizedMembers = spec.members.map((member, index) => normalizeMember(member, index));
    const revision = await createRevisionInternal(ctx, {
      teamDocId: String(team._id),
      teamId: args.teamId,
      ownerUserId,
      teamGoal: spec.teamGoal,
      policy: spec.policy,
      members: normalizedMembers,
      toolAllowlist: spec.toolAllowlist,
      resourceScopes: spec.resourceScopes,
      publish: args.publish ?? false,
    });
    await ctx.db.patch(String(draft._id), {
      accepted: true,
      updatedAt: Date.now(),
    });
    return {
      draftId: args.draftId,
      revisionId: revision.revisionId,
      version: revision.version,
    };
  },
});

export const assignTeamToStoryboard = mutation({
  args: {
    storyboardId: v.id("storyboards"),
    activeTeamId: v.string(),
    activeRevisionId: v.optional(v.string()),
    fallbackTeamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, ownerUserId);
    const activeTeam = await resolveTeamByExternalId(ctx, ownerUserId, args.activeTeamId);
    const activeRevision = await resolveRevision(ctx, String(activeTeam._id), args.activeRevisionId);
    const fallbackTeam = args.fallbackTeamId
      ? await resolveTeamByExternalId(ctx, ownerUserId, args.fallbackTeamId)
      : null;

    const existing = await ctx.db
      .query("agentTeamAssignments")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", args.storyboardId))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(String(existing._id), {
        activeTeamId: activeTeam._id,
        activeRevisionId: String(activeRevision.revisionId),
        fallbackTeamId: fallbackTeam?._id,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("agentTeamAssignments", {
      storyboardId: args.storyboardId,
      userId: ownerUserId,
      activeTeamId: activeTeam._id,
      activeRevisionId: String(activeRevision.revisionId),
      fallbackTeamId: fallbackTeam?._id,
      updatedAt: now,
    });
  },
});

export const getStoryboardTeam = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, ownerUserId);
    const assignment = await ctx.db
      .query("agentTeamAssignments")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", args.storyboardId))
      .unique();
    if (!assignment) {
      return null;
    }
    const [activeTeam, fallbackTeam] = await Promise.all([
      ctx.db.get(assignment.activeTeamId),
      assignment.fallbackTeamId ? ctx.db.get(assignment.fallbackTeamId) : Promise.resolve(null),
    ]);
    return {
      assignment,
      activeTeam,
      fallbackTeam,
    };
  },
});

export const resolveEffectiveRuntimeConfig = query({
  args: {
    storyboardId: v.id("storyboards"),
  },
  handler: async (ctx, args) => {
    const ownerUserId = await requireUser(ctx);
    await ensureStoryboardEditable(ctx, args.storyboardId, ownerUserId);

    const assignment = await ctx.db
      .query("agentTeamAssignments")
      .withIndex("by_storyboard", (q) => q.eq("storyboardId", args.storyboardId))
      .unique();
    if (!assignment) {
      return null;
    }

    const tryResolveAssignment = async (teamDocId: string, revisionId?: string) => {
      const team = await ctx.db.get(teamDocId);
      if (!team || team.ownerUserId !== ownerUserId) {
        return null;
      }
      let revision: Record<string, unknown>;
      try {
        revision = await resolveRevision(
          ctx,
          String(team._id),
          revisionId,
        );
      } catch {
        return null;
      }
      return { team, revision };
    };

    let resolved = await tryResolveAssignment(
      String(assignment.activeTeamId),
      String(assignment.activeRevisionId),
    );
    if (!resolved && assignment.fallbackTeamId) {
      resolved = await tryResolveAssignment(String(assignment.fallbackTeamId), undefined);
    }
    if (!resolved) {
      throw new ConvexError("Assigned team and fallback team are not accessible");
    }
    const { team, revision } = resolved;
    const policy = parseJsonObject<TeamPolicy>(String(revision.policyJson), defaultPolicy("default_standard"));
    const members = parseJsonObject<TeamMember[]>(String(revision.membersJson), []);
    const toolAllowlist = parseJsonObject<string[]>(String(revision.toolAllowlistJson), []);
    const resourceScopes = parseJsonObject<string[]>(String(revision.resourceScopesJson), []);
    const runPolicy = await ctx.db
      .query("agentTeamRunPolicies")
      .withIndex("by_team_revision", (q) =>
        q.eq("teamId", team._id).eq("revisionId", String(revision.revisionId)),
      )
      .unique();
    const quotaProfile = await ctx.db
      .query("quotaProfiles")
      .withIndex("by_owner_profile", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("quotaProfileId", policy.quotaProfileId),
      )
      .unique();

    const riskThresholds = runPolicy
      ? parseJsonObject<{ warnAt: TeamPolicy["riskThresholds"]["warnAt"]; blockAt: TeamPolicy["riskThresholds"]["blockAt"] }>(
        String(runPolicy.riskThresholdsJson),
        policy.riskThresholds,
      )
      : policy.riskThresholds;

    return {
      teamId: team.teamId,
      teamName: team.name,
      revisionId: String(revision.revisionId),
      version: Number(revision.version),
      teamGoal: String(revision.teamGoal),
      members,
      toolAllowlist,
      resourceScopes,
      runtimePolicy: {
        requiresHitl: runPolicy ? Boolean(runPolicy.requiresHitl) : policy.requiresHitl,
        riskThresholds,
        maxBatchSize: runPolicy ? Number(runPolicy.maxBatchSize) : policy.maxBatchSize,
        quotaProfileId: runPolicy ? String(runPolicy.quotaProfileId) : policy.quotaProfileId,
        maxRunOps: policy.maxRunOps,
        maxConcurrentRuns: policy.maxConcurrentRuns,
        quotaEnforced: policy.quotaEnforced,
        dailyMediaBudget: quotaProfile ? Number(quotaProfile.dailyMediaBudget) : 0,
        dailyMutationOps: quotaProfile ? Number(quotaProfile.dailyMutationOps) : 0,
      },
    };
  },
});
