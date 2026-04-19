/**
 * ViMax M3 #3 — Novel2Video SSE ingestion route.
 *
 * POST { title, novel, style, userRequirement?, targetEpisodeCount? }
 *
 * Proxies Python's /novel-ingest-stream, rescales its 0-90% progress
 * range into the overall bar, generates portraits once globally, writes
 * identity packs + portraits once, then writes per-episode shot graphs
 * in sequence — emitting per-episode events so the client shows a live
 * grid of episodes flipping from queued → writing → done.
 *
 * Event protocol on top of ingest-stream's vocabulary:
 *   - `novel_meta`           — { chunkCount, episodeCount, narrativeLength }
 *   - `episode_writing`      — { episodeIndex, title, nodeCount, edgeCount }
 *   - `episode_written`      — { episodeIndex, nodesWritten, edgesWritten }
 *   - `done`                 — { storyboardId, episodeCount, totalShots,
 *                                totalEdges, totalDurationMs, ... }
 */

import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { getToken } from "@/lib/auth-server";
import { mutationRef, queryRef } from "@/lib/convexRefs";
import {
  cheapDnaFromCharacter,
  generatePortraitImage,
  portraitKey,
  sseFrame,
  stripNulls,
  type PortraitView,
  type PythonIngestedCharacter,
  type PythonIngestedPortrait,
  type PythonIngestedShotNode,
  type PythonIngestedEdge,
} from "@/lib/ingest-postprocess";

export const runtime = "nodejs";
export const maxDuration = 900; // 15 min — novel ingestion can be long

const PYTHON_BASE_URL =
  process.env.STORYBOARD_AGENT_BASE_URL || "http://localhost:8123";
const INGEST_TIMEOUT_MS = 14 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;

interface IngestNovelBody {
  title?: string;
  novel?: string;
  style?: string;
  userRequirement?: string;
  targetEpisodeCount?: number;
}

interface PythonEpisode {
  index: number;
  title: string;
  branchId: string;
  branchName: string;
  nodes: PythonIngestedShotNode[];
  edges: PythonIngestedEdge[];
  episodeDurationMs: number;
  llmCallCount: number;
  screenplayLength: number;
  preprocessed: boolean;
}

interface PythonNovelResult {
  storyboardId: string;
  novelLength: number;
  compressedNarrativeLength: number;
  chunkCount: number;
  characters: PythonIngestedCharacter[];
  portraits: PythonIngestedPortrait[];
  episodes: PythonEpisode[];
  pipelineDurationMs: number;
  llmCallCount: number;
  episodeCount: number;
}

export async function POST(request: NextRequest): Promise<Response> {
  const token = await getToken();
  if (!token) {
    return new Response(sseFrame("error", { message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  let body: IngestNovelBody;
  try {
    body = (await request.json()) as IngestNovelBody;
  } catch {
    return new Response(sseFrame("error", { message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const title = (body.title ?? "").trim() || "Untitled novel";
  const novel = (body.novel ?? "").trim();
  const style = (body.style ?? "").trim() || "Cinematic, natural lighting";
  const userRequirement = (body.userRequirement ?? "").trim();
  const targetEpisodeCount =
    typeof body.targetEpisodeCount === "number" &&
    body.targetEpisodeCount >= 1 &&
    body.targetEpisodeCount <= 10
      ? Math.floor(body.targetEpisodeCount)
      : undefined;

  if (novel.length < 200 || novel.length > 500_000) {
    return new Response(
      sseFrame("error", {
        message: `novel body must be 200-500,000 chars (got ${novel.length})`,
      }),
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response(
      sseFrame("error", { message: "NEXT_PUBLIC_CONVEX_URL not configured" }),
      { status: 500, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  const origin = request.nextUrl.origin;
  const cookieHeader = request.headers.get("cookie");
  const startedAt = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (eventType: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseFrame(eventType, data)));
        } catch {
          /* already closed */
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const heartbeat = setInterval(() => {
        send("ping", { elapsedMs: Date.now() - startedAt });
      }, HEARTBEAT_INTERVAL_MS);

      // P0 QA: track the storyboard we create so the finally block can
      // trash it if the pipeline never reaches a successful done event.
      let createdStoryboardId: string | null = null;
      let ingestSucceeded = false;

      try {
        send("open", { ok: true, mode: "novel" });

        // 1. Create storyboard.
        send("stage", {
          stage: "creating_storyboard",
          percentComplete: 0.5,
          statusMessage: "Creating storyboard",
        });
        let storyboardId: string;
        try {
          storyboardId = (await client.mutation(
            mutationRef("storyboards:createStoryboard"),
            { title, mode: "agent_draft" },
          )) as string;
          createdStoryboardId = storyboardId;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createStoryboard failed";
          send("error", { message: msg });
          return;
        }

        // 2. Proxy Python /novel-ingest-stream.
        let pythonResult: PythonNovelResult | null = null;
        const pythonAbort = new AbortController();
        const pythonTimeout = setTimeout(() => pythonAbort.abort(), INGEST_TIMEOUT_MS);
        try {
          const res = await fetch(`${PYTHON_BASE_URL}/novel-ingest-stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              storyboardId,
              novel,
              style,
              userRequirement,
              targetEpisodeCount,
              mediaBaseUrl: origin,
            }),
            signal: pythonAbort.signal,
          });
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            send("error", {
              message: `storyboard-agent returned ${res.status}: ${text.slice(0, 500)}`,
            });
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx = buffer.indexOf("\n\n");
            while (idx !== -1) {
              const rawFrame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              idx = buffer.indexOf("\n\n");
              let eventType = "message";
              const dataLines: string[] = [];
              for (const line of rawFrame.split("\n")) {
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
              }
              if (dataLines.length === 0) continue;
              const payload = dataLines.join("\n");
              if (eventType === "stage") {
                try {
                  const parsed = JSON.parse(payload) as {
                    percentComplete?: number;
                    [k: string]: unknown;
                  };
                  // Python reports 0-90%; rescale into 5-55% of the overall
                  // progress bar so portrait gen + Convex writes have room.
                  const scaled = {
                    ...parsed,
                    percentComplete:
                      typeof parsed.percentComplete === "number"
                        ? 5 + (parsed.percentComplete / 90) * 50
                        : undefined,
                  };
                  send("stage", scaled);
                } catch {
                  send("stage", { statusMessage: payload });
                }
              } else if (eventType === "result") {
                try {
                  pythonResult = JSON.parse(payload) as PythonNovelResult;
                } catch {
                  send("error", { message: "Failed to parse Python result frame" });
                  return;
                }
              } else if (eventType === "error") {
                try {
                  send("error", JSON.parse(payload));
                } catch {
                  send("error", { message: payload });
                }
                return;
              }
            }
          }
        } finally {
          clearTimeout(pythonTimeout);
        }

        if (!pythonResult) {
          send("error", { message: "Python pipeline exited without a result" });
          return;
        }

        send("novel_meta", {
          chunkCount: pythonResult.chunkCount,
          episodeCount: pythonResult.episodeCount,
          narrativeLength: pythonResult.compressedNarrativeLength,
          characterCount: pythonResult.characters.length,
          visibleCharacterCount: pythonResult.portraits.length / 3,
        });

        // 3. Portrait generation — two passes, shared across episodes.
        const totalPortraits = pythonResult.portraits.length;
        const portraitUrlResults: (string | null)[] = new Array(totalPortraits).fill(null);
        const resolvedByCharView = new Map<string, string>();

        const pass1: number[] = [];
        const pass2: number[] = [];
        pythonResult.portraits.forEach((p, i) => {
          (p.conditionOnView ? pass2 : pass1).push(i);
        });

        if (totalPortraits > 0) {
          send("stage", {
            stage: "generating_portraits",
            percentComplete: 58,
            statusMessage: `Generating ${totalPortraits} portrait${totalPortraits === 1 ? "" : "s"} (front-view first)`,
            totalPortraits,
          });
        }
        // Track portrait failures so the producer learns about them via
        // the SSE stream + final done payload, instead of silently shipping
        // characters with incomplete 3-view sets (P0 QA finding).
        const portraitFailures: Array<{
          characterId: string;
          view: PortraitView;
          reason: string;
        }> = [];
        const recordPortraitFailure = (
          p: (typeof pythonResult)["portraits"][number],
          reason: string,
        ) => {
          portraitFailures.push({
            characterId: p.characterIdentifier,
            view: p.view as PortraitView,
            reason,
          });
          send("portraits_failed", {
            characterId: p.characterIdentifier,
            view: p.view,
            reason,
            totalFailures: portraitFailures.length,
          });
        };

        let portraitsDone = 0;
        await Promise.all(
          pass1.map(async (i) => {
            const p = pythonResult!.portraits[i];
            const url = await generatePortraitImage({
              origin,
              prompt: p.prompt,
              cookieHeader,
            });
            portraitUrlResults[i] = url;
            if (url) {
              resolvedByCharView.set(portraitKey(p.characterIdentifier, p.view), url);
            } else {
              recordPortraitFailure(p, "portrait generator returned no image");
            }
            portraitsDone += 1;
            send("portraits_progress", {
              done: portraitsDone,
              total: totalPortraits,
              phase: "front",
            });
          }),
        );

        if (pass2.length > 0) {
          send("stage", {
            stage: "generating_portraits",
            percentComplete: 66,
            statusMessage: "Conditioning side + back views on front portraits",
          });
        }
        await Promise.all(
          pass2.map(async (i) => {
            const p = pythonResult!.portraits[i];
            const refView = (p.conditionOnView ?? null) as PortraitView | null;
            const refUrl = refView
              ? resolvedByCharView.get(portraitKey(p.characterIdentifier, refView))
              : undefined;
            if (refView && !refUrl) {
              // Upstream pass1 portrait failed, so the side/back conditioning
              // has nothing to reference. Skip + surface the cascade.
              recordPortraitFailure(
                p,
                `${refView} reference missing (upstream failure)`,
              );
              portraitUrlResults[i] = null;
              portraitsDone += 1;
              send("portraits_progress", {
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
            if (url) {
              resolvedByCharView.set(portraitKey(p.characterIdentifier, p.view), url);
            } else {
              recordPortraitFailure(p, "portrait generator returned no image");
            }
            portraitsDone += 1;
            send("portraits_progress", {
              done: portraitsDone,
              total: totalPortraits,
              phase: "side_back",
            });
          }),
        );

        // 4. Identity packs — shared across all episodes.
        const totalCharacters = pythonResult.characters.length;
        if (totalCharacters > 0) {
          send("stage", {
            stage: "writing_to_convex",
            percentComplete: 75,
            statusMessage: `Writing ${totalCharacters} identity pack${totalCharacters === 1 ? "" : "s"}`,
          });
        }
        const packIdByCharacter = new Map<string, string>();
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
            const bundle = (await client.query(
              queryRef("continuityOS:listConstraintBundle"),
              { storyboardId },
            )) as { identityPacks?: Array<{ _id: string; packId: string }> } | null;
            const hit = bundle?.identityPacks?.find((r) => r.packId === packAppId);
            if (hit) packIdByCharacter.set(c.identifier, hit._id);
            identityWritten += 1;
            send("writing_identities", { done: identityWritten, total: totalCharacters });
          } catch (err) {
            console.warn("identity pack write failed", err);
          }
        }

        // 5. Portraits → Convex.
        let portraitRowsWritten = 0;
        const portraitsToWrite = portraitUrlResults.filter((u) => u != null).length;
        if (portraitsToWrite > 0) {
          send("stage", {
            stage: "writing_to_convex",
            percentComplete: 80,
            statusMessage: `Attaching ${portraitsToWrite} portrait reference${portraitsToWrite === 1 ? "" : "s"}`,
          });
        }
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
            send("writing_portraits", { done: portraitRowsWritten, total: portraitsToWrite });
          } catch (err) {
            console.warn("portrait write failed", err);
          }
        }

        // 6. Per-episode shot graphs.
        const perEpisodeSpan = 15.0 / Math.max(pythonResult.episodes.length, 1); // 85-100%
        let totalShotsWritten = 0;
        let totalEdgesWritten = 0;
        for (const episode of pythonResult.episodes) {
          const episodePercent = 85.0 + episode.index * perEpisodeSpan;
          send("episode_writing", {
            episodeIndex: episode.index,
            episodeCount: pythonResult.episodes.length,
            title: episode.title,
            branchName: episode.branchName,
            nodeCount: episode.nodes.length,
            edgeCount: episode.edges.length,
          });
          send("stage", {
            stage: "writing_to_convex",
            percentComplete: episodePercent,
            statusMessage: `Writing episode ${episode.index + 1}/${pythonResult.episodes.length}: ${episode.title}`,
            episodeIndex: episode.index,
          });

          let nodesWritten = 0;
          let edgesWritten = 0;
          try {
            if (episode.nodes.length > 0) {
              const scrubbedNodes = episode.nodes.map((n) =>
                stripNulls({
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
                }),
              );
              const res = (await client.mutation(
                mutationRef("storyboards:bulkCreateNodes"),
                { storyboardId: storyboardId as Id<"storyboards">, nodes: scrubbedNodes },
              )) as { total?: number } | undefined;
              nodesWritten = res?.total ?? episode.nodes.length;
            }
            if (episode.edges.length > 0) {
              const scrubbedEdges = episode.edges.map((e) =>
                stripNulls({
                  edgeId: e.edgeId,
                  sourceNodeId: e.sourceNodeId,
                  targetNodeId: e.targetNodeId,
                  edgeType: e.edgeType,
                  isPrimary: e.isPrimary,
                  order: e.order ?? undefined,
                }),
              );
              const res = (await client.mutation(
                mutationRef("storyboards:bulkCreateEdges"),
                { storyboardId: storyboardId as Id<"storyboards">, edges: scrubbedEdges },
              )) as { total?: number } | undefined;
              edgesWritten = res?.total ?? episode.edges.length;
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : "episode write failed";
            send("episode_failed", {
              episodeIndex: episode.index,
              title: episode.title,
              error: msg,
            });
            continue;
          }
          totalShotsWritten += nodesWritten;
          totalEdgesWritten += edgesWritten;
          send("episode_written", {
            episodeIndex: episode.index,
            title: episode.title,
            nodesWritten,
            edgesWritten,
          });
        }

        // 7. Done.
        const totalDurationMs = Date.now() - startedAt;
        send("stage", {
          stage: "complete",
          percentComplete: 100,
          statusMessage: "Opening storyboard",
        });
        send("done", {
          storyboardId,
          characterCount: pythonResult.characters.length,
          identityPacksWritten: packIdByCharacter.size,
          portraitCount: portraitRowsWritten,
          portraitFailureCount: portraitFailures.length,
          portraitFailures,
          episodeCount: pythonResult.episodes.length,
          nodeCount: totalShotsWritten,
          edgeCount: totalEdgesWritten,
          llmCallCount: pythonResult.llmCallCount,
          pipelineDurationMs: pythonResult.pipelineDurationMs,
          totalDurationMs,
          novelLength: pythonResult.novelLength,
          compressedNarrativeLength: pythonResult.compressedNarrativeLength,
        });
        ingestSucceeded = totalShotsWritten > 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send("error", { message: msg });
      } finally {
        clearInterval(heartbeat);
        // Orphan cleanup (matches ingest-stream): trash the storyboard row
        // on any non-success exit so the library doesn't accumulate
        // "0 nodes" cards from failed / aborted runs.
        if (!ingestSucceeded && createdStoryboardId) {
          try {
            await client.mutation(mutationRef("storyboards:trashStoryboard"), {
              storyboardId: createdStoryboardId as Id<"storyboards">,
            });
          } catch {
            // best-effort
          }
        }
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
