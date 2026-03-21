import {
  executeApprovedExecutionPlan,
  executeApprovedGraphPatch,
  executeApprovedMediaPrompt,
  executeRejectedExecutionPlan,
  executeRejectedGraphPatch,
  executeRejectedMediaPrompt,
  type AdapterDependencies,
  type ExecutionPlanInput,
  type GraphPatchInput,
  type MediaPromptInput,
} from "../agentExecutionAdapter";

type GraphHitlResponse =
  | { approved: true; editedOperations?: unknown[] }
  | { approved: false };

type MediaHitlResponse =
  | { approved: true; prompt?: string; negativePrompt?: string }
  | { approved: false };

type ExecutionPlanHitlResponse =
  | { approved: true; editedOperations?: unknown[] }
  | { approved: false };

type DailiesBatchHitlResponse =
  | { approved: true; editedOperations?: unknown[] }
  | { approved: false };

type SimulationCriticBatchHitlResponse =
  | { approved: true; editedOperations?: unknown[] }
  | { approved: false };

export const runGraphHitlApproval = async (
  deps: AdapterDependencies,
  input: GraphPatchInput,
  response: GraphHitlResponse,
) => {
  if (!response.approved) {
    return await executeRejectedGraphPatch(deps, input);
  }
  return await executeApprovedGraphPatch(deps, input, response.editedOperations);
};

export const runMediaHitlApproval = async (
  deps: AdapterDependencies,
  input: MediaPromptInput,
  response: MediaHitlResponse,
) => {
  if (!response.approved) {
    return await executeRejectedMediaPrompt(deps, input);
  }
  return await executeApprovedMediaPrompt(
    deps,
    input,
    response.prompt
      ? {
          prompt: response.prompt,
          negativePrompt: response.negativePrompt,
        }
      : undefined,
  );
};

export const runExecutionPlanHitlApproval = async (
  deps: AdapterDependencies,
  input: ExecutionPlanInput,
  response: ExecutionPlanHitlResponse,
) => {
  if (!response.approved) {
    return await executeRejectedExecutionPlan(deps, input);
  }
  return await executeApprovedExecutionPlan(deps, input, response.editedOperations);
};

export const runDailiesBatchHitlApproval = async (
  deps: AdapterDependencies,
  input: ExecutionPlanInput,
  response: DailiesBatchHitlResponse,
) => {
  if (!response.approved) {
    return await executeRejectedExecutionPlan(deps, input);
  }
  return await executeApprovedExecutionPlan(deps, input, response.editedOperations);
};

export const runSimulationCriticBatchHitlApproval = async (
  deps: AdapterDependencies,
  input: ExecutionPlanInput,
  response: SimulationCriticBatchHitlResponse,
) => {
  if (!response.approved) {
    return await executeRejectedExecutionPlan(deps, input);
  }
  return await executeApprovedExecutionPlan(deps, input, response.editedOperations);
};

export type {
  GraphHitlResponse,
  MediaHitlResponse,
  ExecutionPlanHitlResponse,
  DailiesBatchHitlResponse,
  SimulationCriticBatchHitlResponse,
};
