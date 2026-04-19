/**
 * Shared post-processing pipeline for screenplay + idea ingestion.
 *
 * Handles the three-step tail that all three routes run identically:
 *   1. Generate 3-view portraits (fronts first, side/back with front as ref)
 *   2. Write identity packs (upsertIdentityPack → bundle lookup for _id)
 *   3. Write portrait references, then bulkCreateNodes + bulkCreateEdges
 *
 * Accepts an optional `emit` callback matching the SSE event vocabulary the
 * streaming route uses. Blocking callers pass `undefined` and the emitter
 * is a no-op — same code path, same result shape.
 */

import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../convex/_generated/dataModel";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import { generatePortraitImage } from "./generatePortrait";
import type {
  PortraitView,
  PostProcessEmit,
  PostProcessOutcome,
  PythonIngestionResult,
} from "./types";
import {
  cheapDnaFromCharacter,
  flattenCharacterFacings,
  portraitKey,
  stripNulls,
} from "./utils";

export interface ProcessIngestionOptions {
  client: ConvexHttpClient;
  storyboardId: string;
  origin: string;
  cookieHeader: string | null;
  pythonResult: PythonIngestionResult;
  /** Optional SSE-style event emitter. No-op when undefined. */
  emit?: PostProcessEmit;
}

const noop: PostProcessEmit = () => {
  /* no-op */
};

export async function processIngestionResult(
  opts: ProcessIngestionOptions,
): Promise<PostProcessOutcome> {
  const { client, storyboardId, origin, cookieHeader, pythonResult } = opts;
  const emit = opts.emit ?? noop;
  const startedAt = Date.now();

  // --- 1. Portraits ------------------------------------------------------
  const totalPortraits = pythonResult.portraits.length;
  const portraitUrlResults: (string | null)[] = new Array(totalPortraits).fill(null);
  const resolvedByCharView = new Map<string, string>();

  const pass1: number[] = [];
  const pass2: number[] = [];
  pythonResult.portraits.forEach((p, i) => {
    (p.conditionOnView ? pass2 : pass1).push(i);
  });

  if (totalPortraits > 0) {
    emit("stage", {
      stage: "generating_portraits",
      percentComplete: 52,
      statusMessage: `Generating ${totalPortraits} portrait${totalPortraits === 1 ? "" : "s"} (front-view first)`,
      totalPortraits,
    });
  }

  let portraitsDone = 0;
  await Promise.all(
    pass1.map(async (i) => {
      const p = pythonResult.portraits[i];
      const url = await generatePortraitImage({
        origin,
        prompt: p.prompt,
        cookieHeader,
      });
      portraitUrlResults[i] = url;
      if (url) resolvedByCharView.set(portraitKey(p.characterIdentifier, p.view), url);
      portraitsDone += 1;
      emit("portraits_progress", {
        done: portraitsDone,
        total: totalPortraits,
        phase: "front",
      });
    }),
  );

  if (pass2.length > 0) {
    emit("stage", {
      stage: "generating_portraits",
      percentComplete: 62,
      statusMessage: "Conditioning side + back views on front portraits",
    });
  }
  await Promise.all(
    pass2.map(async (i) => {
      const p = pythonResult.portraits[i];
      const refView = (p.conditionOnView ?? null) as PortraitView | null;
      const refUrl = refView
        ? resolvedByCharView.get(portraitKey(p.characterIdentifier, refView))
        : undefined;
      if (refView && !refUrl) {
        console.warn(
          `[postprocess] portrait "${p.characterIdentifier}/${p.view}" needed ${refView} reference — skipping`,
        );
        portraitUrlResults[i] = null;
        portraitsDone += 1;
        emit("portraits_progress", {
          done: portraitsDone,
          total: totalPortraits,
          phase: "side_back",
        });
        return;
      }
      const url = await generatePortraitImage({
        origin,
        prompt: p.prompt,
        cookieHeader,
        referenceImageUrls: refUrl ? [refUrl] : undefined,
      });
      portraitUrlResults[i] = url;
      if (url) resolvedByCharView.set(portraitKey(p.characterIdentifier, p.view), url);
      portraitsDone += 1;
      emit("portraits_progress", {
        done: portraitsDone,
        total: totalPortraits,
        phase: "side_back",
      });
    }),
  );

  // --- 2. Identity packs -------------------------------------------------
  const totalCharacters = pythonResult.characters.length;
  if (totalCharacters > 0) {
    emit("stage", {
      stage: "writing_to_convex",
      percentComplete: 74,
      statusMessage: `Writing ${totalCharacters} identity pack${totalCharacters === 1 ? "" : "s"}`,
    });
  }
  const packIdByCharacter = new Map<string, string>();
  const identityPackFailures: string[] = [];
  let identityWritten = 0;
  for (const c of pythonResult.characters) {
    try {
      const packAppId = `pack_${c.identifier.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}_${Date.now().toString(36)}`;
      await client.mutation(mutationRef("continuityOS:upsertIdentityPack"), {
        storyboardId,
        packId: packAppId,
        name: c.identityPackName || c.identifier,
        description: `${c.staticFeatures}\n\n${c.dynamicFeatures}`.trim(),
        dnaJson: cheapDnaFromCharacter(c),
        sourceCharacterId: c.identifier,
        visibility: "project",
      });
      const bundle = (await client.query(queryRef("continuityOS:listConstraintBundle"), {
        storyboardId,
      })) as { identityPacks?: Array<{ _id: string; packId: string }> } | null;
      const hit = bundle?.identityPacks?.find((row) => row.packId === packAppId);
      if (hit) packIdByCharacter.set(c.identifier, hit._id);
      else identityPackFailures.push(`${c.identifier}: pack row not found after upsert`);
      identityWritten += 1;
      emit("writing_identities", { done: identityWritten, total: totalCharacters });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      identityPackFailures.push(`${c.identifier}: ${msg}`);
      console.warn(`[postprocess] identityPack write failed for ${c.identifier}`, err);
    }
  }

  // --- 3. Portrait references -------------------------------------------
  const portraitsToWrite = portraitUrlResults.filter((u) => u != null).length;
  if (portraitsToWrite > 0) {
    emit("stage", {
      stage: "writing_to_convex",
      percentComplete: 84,
      statusMessage: `Attaching ${portraitsToWrite} portrait reference${portraitsToWrite === 1 ? "" : "s"}`,
    });
  }
  let portraitRowsWritten = 0;
  for (let i = 0; i < pythonResult.portraits.length; i += 1) {
    const p = pythonResult.portraits[i];
    const url = portraitUrlResults[i];
    if (!url) continue;
    const ownerPackId = packIdByCharacter.get(p.characterIdentifier);
    if (!ownerPackId) continue;
    try {
      await client.mutation(mutationRef("identityReferences:addIdentityPortrait"), {
        storyboardId,
        ownerPackId,
        portraitView: p.view,
        sourceUrl: url,
        prompt: p.prompt,
        modelId: "llm-factory",
      });
      portraitRowsWritten += 1;
      emit("writing_portraits", {
        done: portraitRowsWritten,
        total: portraitsToWrite,
      });
    } catch (err) {
      console.warn(`[postprocess] portrait write failed for ${p.characterIdentifier}`, err);
    }
  }

  // --- 4. Nodes + edges --------------------------------------------------
  emit("stage", {
    stage: "writing_to_convex",
    percentComplete: 92,
    statusMessage: `Writing ${pythonResult.nodes.length} shot${pythonResult.nodes.length === 1 ? "" : "s"} + ${pythonResult.edges.length} edge${pythonResult.edges.length === 1 ? "" : "s"}`,
  });
  let nodesWritten = 0;
  let edgesWritten = 0;
  if (pythonResult.nodes.length > 0) {
    const scrubbedNodes = pythonResult.nodes.map((n) => {
      // Python emits `characterFacings` as a Record<characterId, facing>.
      // Convex's validator is record-free so we flatten to a parallel
      // array. `flattenCharacterFacings` enforces the allowlist + "unknown"
      // drop rules; returns `undefined` when nothing survives so the field
      // is omitted from the payload entirely.
      const flattenedFacings = flattenCharacterFacings(
        n.characterFacings ?? undefined,
        n.characterIdentifiers,
      );
      return stripNulls({
        nodeId: n.nodeId,
        nodeType: n.nodeType,
        label: n.label,
        segment: n.segment,
        position: n.position,
        shotMeta: n.shotMeta ?? undefined,
        promptPack: n.promptPack ?? undefined,
        characterIds:
          n.characterIdentifiers && n.characterIdentifiers.length > 0
            ? n.characterIdentifiers
            : undefined,
        characterFacings: flattenedFacings,
      });
    });
    const res = (await client.mutation(mutationRef("storyboards:bulkCreateNodes"), {
      storyboardId: storyboardId as Id<"storyboards">,
      nodes: scrubbedNodes,
    })) as { total?: number } | undefined;
    nodesWritten = res?.total ?? pythonResult.nodes.length;
    emit("writing_graph", {
      phase: "nodes",
      done: nodesWritten,
      total: pythonResult.nodes.length,
    });
  }
  if (pythonResult.edges.length > 0) {
    const scrubbedEdges = pythonResult.edges.map((e) =>
      stripNulls({
        edgeId: e.edgeId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        edgeType: e.edgeType,
        isPrimary: e.isPrimary,
        order: e.order ?? undefined,
      }),
    );
    const res = (await client.mutation(mutationRef("storyboards:bulkCreateEdges"), {
      storyboardId: storyboardId as Id<"storyboards">,
      edges: scrubbedEdges,
    })) as { total?: number } | undefined;
    edgesWritten = res?.total ?? pythonResult.edges.length;
    emit("writing_graph", {
      phase: "edges",
      done: edgesWritten,
      total: pythonResult.edges.length,
    });
  }

  return {
    storyboardId,
    characterCount: totalCharacters,
    identityPacksWritten: packIdByCharacter.size,
    identityPackFailures,
    portraitCount: portraitRowsWritten,
    nodeCount: nodesWritten,
    edgeCount: edgesWritten,
    durationMs: Date.now() - startedAt,
  };
}
