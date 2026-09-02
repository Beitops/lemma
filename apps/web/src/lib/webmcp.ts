import {
  LEMMA_REASONING_WORKSPACE_SKILL,
  webMcpToolRegistry,
  type BranchFromStepInput,
  type CompareBranchesInput,
  type CreateContextInput,
  type CreateContextLinkInput,
  type CreateContextTextInput,
  type CreateObjectiveInput,
  type CreateStepDependencyInput,
  type CreateStepInput,
  type CreateStrategyInput,
  type FindStepsInput,
  type GetContextInput,
  type GetObjectiveInput,
  type MarkAssumptionInput,
  type MarkDeadEndInput,
  type MarkEndInput,
  type RequestHumanDecisionResult,
  type RequestHumanDecisionInput,
  type SetReasoningResultInput,
  type UpdateObjectiveInput,
  type UpdateStepInput,
} from "@lemma/contracts";
import { ApiClientError, type LemmaApi } from "./api";

export const DEFAULT_WEB_MCP_AGENT_NAME = "Lemma Agent";

type WebMcpToolName = keyof typeof webMcpToolRegistry;
type WorkspaceScopedInput = { workspace_id: string };
type BranchScopedInput = { branch_id: string };
type ObjectiveScopedInput = { objective_id: string; workspace_id: string };

type WebMcpHighlightBase = {
  id: string;
  /**
   * Carries the owning objective when a mutation is scoped to one. The UI uses
   * it to load the correct board before selecting a nested graph target.
   */
  objectiveId?: string;
};

/**
 * The graph location resolved by the API for a human-decision checkpoint.
 * It is deliberately separate from the decision record itself so presentation
 * can refresh and navigate to the affected route without treating a pending
 * request as a resolved human choice.
 */
export type WebMcpDecisionAncestry = {
  branchId?: string;
  objectiveId?: string;
  stepId?: string;
  strategyId?: string;
};

export type WebMcpHighlight =
  | (WebMcpHighlightBase & { objectiveId: string; type: "objective" })
  | (WebMcpHighlightBase & { type: "strategy" })
  | (WebMcpHighlightBase & { type: "branch" })
  | (WebMcpHighlightBase & { type: "step" })
  | (WebMcpHighlightBase & { stepId: string; type: "assumption" })
  | (WebMcpHighlightBase & { ancestry: WebMcpDecisionAncestry; type: "decision" })
  | (WebMcpHighlightBase & { type: "context" });

export type WebMcpToolResponse =
  | { data: unknown; ok: true }
  | { error: { code: string; message: string }; ok: false };

/**
 * Runtime dependencies deliberately match the UI's API client and presentation
 * callbacks. The resolver lets handlers use current React callbacks without
 * replacing WebMCP registrations when the selected workspace changes.
 */
export interface WebMcpRuntime {
  agentName?: string;
  api: LemmaApi;
  highlight: (target: WebMcpHighlight) => void;
  refreshCurrentWorkspace: (signal: AbortSignal) => Promise<void> | void;
}

export interface RegisterWebMcpToolsOptions {
  controller: AbortController;
  getRuntime: () => WebMcpRuntime;
}

interface ToolInvocation {
  data: unknown;
  highlight?: WebMcpHighlight;
  mutated: boolean;
}

const MUTATION_TOOL_NAMES = new Set<WebMcpToolName>([
  "create_objective",
  "update_objective",
  "create_context",
  "create_strategy",
  "create_step",
  "create_step_dependency",
  "update_step",
  "branch_from_step",
  "mark_assumption",
  "mark_dead_end",
  "mark_end",
  "set_reasoning_result",
  "request_human_decision",
]);

const HUMAN_DECISION_CHECKPOINT_DESCRIPTION = "Create a pending, scoped decision request for a human. Side effect: this records a visible checkpoint in the shared reasoning graph. After requesting it, stop mutations on that route until you reread the decision state and its human resolution; then continue only from the resolved state. This mutation is idempotent for the supplied idempotency_key.";

// This signal is only for hosts that omit execution options; registrations use their own controller.
const FALLBACK_EXECUTION_SIGNAL = new AbortController().signal;

function failure(code: string, message: string): WebMcpToolResponse {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withAgentProvenance(value: unknown, agentName: string): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    author_type: "agent",
    author_agent_name: agentName,
  };
}

function agentNameFor(runtime: WebMcpRuntime): string {
  const name = runtime.agentName?.trim();
  return name && name.length > 0 ? name : DEFAULT_WEB_MCP_AGENT_NAME;
}

function decisionAncestryFor(result: RequestHumanDecisionResult): WebMcpDecisionAncestry {
  return {
    ...(result.ancestry.objective_id ? { objectiveId: result.ancestry.objective_id } : {}),
    ...(result.ancestry.strategy_id ? { strategyId: result.ancestry.strategy_id } : {}),
    ...(result.ancestry.branch_id ? { branchId: result.ancestry.branch_id } : {}),
    ...(result.ancestry.step_id ? { stepId: result.ancestry.step_id } : {}),
  };
}

function decisionHighlightFor(result: RequestHumanDecisionResult): WebMcpHighlight {
  const ancestry = decisionAncestryFor(result);
  const objectiveId = ancestry.objectiveId ?? result.objective_id ?? undefined;
  return {
    ancestry,
    id: result.decision_id,
    ...(objectiveId ? { objectiveId } : {}),
    type: "decision",
  };
}

function registeredToolDescription(toolName: WebMcpToolName): string {
  if (toolName === "request_human_decision") return HUMAN_DECISION_CHECKPOINT_DESCRIPTION;
  return webMcpToolRegistry[toolName].description;
}

function compactMessage(value: unknown, fallback: string): string {
  if (!(value instanceof Error)) return fallback;
  const message = value.message.replace(/\s+/g, " ").trim();
  return message.length > 0 ? message.slice(0, 300) : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function errorResponse(error: unknown, signal: AbortSignal): WebMcpToolResponse {
  if (signal.aborted || isAbortError(error)) {
    return failure("CANCELLED", "The tool execution was cancelled.");
  }

  if (error instanceof ApiClientError) {
    return failure(error.code, compactMessage(error, "The Lemma API request failed."));
  }

  return failure("INTERNAL_ERROR", compactMessage(error, "The Lemma tool could not complete."));
}

function cancelledResponse(signal: AbortSignal): WebMcpToolResponse | null {
  return signal.aborted ? failure("CANCELLED", "The tool execution was cancelled.") : null;
}

async function notifyMutation(
  runtime: WebMcpRuntime,
  target: WebMcpHighlight | undefined,
  signal: AbortSignal,
): Promise<void> {
  try {
    await runtime.refreshCurrentWorkspace(signal);
  } catch {
    // A completed graph mutation remains valid even if the UI refresh is interrupted.
  }

  if (!target || signal.aborted) return;

  try {
    runtime.highlight(target);
  } catch {
    // Presentation callbacks must not turn a committed API mutation into a tool failure.
  }
}

async function invokeTool(
  toolName: WebMcpToolName,
  parsedInput: unknown,
  runtime: WebMcpRuntime,
  signal: AbortSignal,
): Promise<ToolInvocation> {
  switch (toolName) {
    case "get_skill": {
      return {
        data: LEMMA_REASONING_WORKSPACE_SKILL,
        mutated: false,
      };
    }
    case "get_workspace": {
      const input = parsedInput as WorkspaceScopedInput;
      return {
        data: await runtime.api.getWorkspaceOverview(input.workspace_id, signal),
        mutated: false,
      };
    }
    case "list_objectives": {
      const input = parsedInput as WorkspaceScopedInput;
      return {
        data: await runtime.api.listObjectives(input.workspace_id, signal),
        mutated: false,
      };
    }
    case "get_objective": {
      const input = parsedInput as GetObjectiveInput;
      return {
        data: await runtime.api.getObjectiveGraph(input.workspace_id, input.objective_id, signal),
        mutated: false,
      };
    }
    case "create_objective": {
      const input = parsedInput as CreateObjectiveInput;
      const { workspace_id, ...request } = input;
      const data = await runtime.api.createObjective(workspace_id, request, signal);
      return {
        data,
        highlight: { id: data.objective_id, objectiveId: data.objective_id, type: "objective" },
        mutated: true,
      };
    }
    case "update_objective": {
      const input = parsedInput as UpdateObjectiveInput;
      const { workspace_id, objective_id, ...request } = input;
      const data = await runtime.api.updateObjective(workspace_id, objective_id, request, signal);
      return {
        data,
        highlight: { id: data.objective_id, objectiveId: data.objective_id, type: "objective" },
        mutated: true,
      };
    }
    case "get_context": {
      const input = parsedInput as GetContextInput;
      const request = input.objective_id === undefined
        ? { scope: input.scope }
        : { objective_id: input.objective_id, scope: input.scope };
      return {
        data: await runtime.api.getContext(input.workspace_id, request, signal),
        mutated: false,
      };
    }
    case "create_context": {
      const input = parsedInput as CreateContextInput;
      const data = (() => {
        if (input.kind === "link" || input.kind === "paper") {
          const { workspace_id, ...request } = input as CreateContextLinkInput;
          return runtime.api.createLinkContext(workspace_id, request, signal);
        }

        const { workspace_id, ...request } = input as CreateContextTextInput;
        return runtime.api.createTextContext(workspace_id, request, signal);
      })();
      const context = await data;
      return {
        data: context,
        highlight: {
          id: context.id,
          ...(context.objective_id ? { objectiveId: context.objective_id } : {}),
          type: "context",
        },
        mutated: true,
      };
    }
    case "list_strategies": {
      const input = parsedInput as ObjectiveScopedInput;
      return {
        data: await runtime.api.listStrategies(input.workspace_id, input.objective_id, signal),
        mutated: false,
      };
    }
    case "create_strategy": {
      const input = parsedInput as CreateStrategyInput;
      const { workspace_id, objective_id, ...request } = input;
      const data = await runtime.api.createStrategy(workspace_id, objective_id, request, signal);
      return {
        data,
        highlight: { id: data.strategy_id, objectiveId: objective_id, type: "strategy" },
        mutated: true,
      };
    }
    case "create_step": {
      const input = parsedInput as CreateStepInput;
      const { branch_id, ...request } = input;
      const data = await runtime.api.createStep(branch_id, request, signal);
      return { data, highlight: { id: data.step_id, type: "step" }, mutated: true };
    }
    case "create_step_dependency": {
      const input = parsedInput as CreateStepDependencyInput;
      const { workspace_id, ...request } = input;
      const data = await runtime.api.createStepDependency(workspace_id, request, signal);
      return {
        data,
        highlight: { id: data.target_step_id, type: "step" },
        mutated: true,
      };
    }
    case "update_step": {
      const input = parsedInput as UpdateStepInput;
      const { step_id, ...request } = input;
      const data = await runtime.api.updateStep(step_id, request, signal);
      return { data, highlight: { id: data.step_id, type: "step" }, mutated: true };
    }
    case "branch_from_step": {
      const input = parsedInput as BranchFromStepInput;
      const { step_id, ...request } = input;
      const data = await runtime.api.branchFromStep(step_id, request, signal);
      return { data, highlight: { id: data.branch_id, type: "branch" }, mutated: true };
    }
    case "mark_assumption": {
      const input = parsedInput as MarkAssumptionInput;
      const { step_id, ...request } = input;
      const data = await runtime.api.markAssumption(step_id, request, signal);
      return {
        data,
        highlight: { id: data.assumption_id, stepId: data.step_id, type: "assumption" },
        mutated: true,
      };
    }
    case "mark_dead_end": {
      const input = parsedInput as MarkDeadEndInput;
      const { step_id, ...request } = input;
      const data = await runtime.api.markDeadEnd(step_id, request, signal);
      return { data, highlight: { id: data.step_id, type: "step" }, mutated: true };
    }
    case "mark_end": {
      const input = parsedInput as MarkEndInput;
      const { branch_id, ...request } = input;
      const data = await runtime.api.markEnd(branch_id, request, signal);
      return { data, highlight: { id: data.branch_id, type: "branch" }, mutated: true };
    }
    case "set_reasoning_result": {
      const input = parsedInput as SetReasoningResultInput;
      const { workspace_id, objective_id, ...request } = input;
      const data = await runtime.api.setReasoningResult(workspace_id, objective_id, request, signal);
      return {
        data,
        highlight: { id: data.target_id, objectiveId: objective_id, type: data.target_type },
        mutated: true,
      };
    }
    case "find_steps": {
      return {
        data: await runtime.api.findSteps(parsedInput as FindStepsInput, signal),
        mutated: false,
      };
    }
    case "compare_branches": {
      return {
        data: await runtime.api.compareBranches(parsedInput as CompareBranchesInput, signal),
        mutated: false,
      };
    }
    case "request_human_decision": {
      const input = parsedInput as RequestHumanDecisionInput;
      const { workspace_id, ...request } = input;
      const data = await runtime.api.requestDecision(workspace_id, request, signal);
      return { data, highlight: decisionHighlightFor(data), mutated: true };
    }
    case "generate_clean_solution": {
      const input = parsedInput as BranchScopedInput;
      return {
        data: await runtime.api.generateCleanSolution(input.branch_id, signal),
        mutated: false,
      };
    }
  }

  throw new Error(`Unsupported WebMCP tool: ${toolName}`);
}

function createToolHandler(
  toolName: WebMcpToolName,
  getRuntime: () => WebMcpRuntime,
): WebMCP.ToolExecuteCallback {
  return async (input, options?: WebMCP.ToolExecuteCallbackOptions): Promise<WebMcpToolResponse> => {
    const signal = options?.signal ?? FALLBACK_EXECUTION_SIGNAL;
    const cancelled = cancelledResponse(signal);
    if (cancelled) return cancelled;

    try {
      const runtime = getRuntime();
      const definition = webMcpToolRegistry[toolName];
      const inputWithProvenance = MUTATION_TOOL_NAMES.has(toolName)
        ? withAgentProvenance(input, agentNameFor(runtime))
        : input;
      const inputResult = definition.input_schema.safeParse(inputWithProvenance);

      if (!inputResult.success) {
        return failure("VALIDATION_ERROR", "The tool input does not match its required schema.");
      }

      const invocation = await invokeTool(toolName, inputResult.data, runtime, signal);
      const cancelledAfterCall = cancelledResponse(signal);
      if (cancelledAfterCall) return cancelledAfterCall;

      const result = definition.result_schema.safeParse(invocation.data);
      if (!result.success) {
        return failure("INTERNAL_ERROR", "The Lemma API returned data that does not match this tool's result schema.");
      }

      if (invocation.mutated) {
        await notifyMutation(runtime, invocation.highlight, signal);
      }

      const cancelledAfterMutation = cancelledResponse(signal);
      if (cancelledAfterMutation) return cancelledAfterMutation;

      return { ok: true, data: result.data };
    } catch (error) {
      return errorResponse(error, signal);
    }
  };
}

/**
 * Registers the canonical WebMCP surface against the current document.
 * The supplied controller is intentionally the sole owner of every registration.
 */
export async function registerWebMcpTools({
  controller,
  getRuntime,
}: RegisterWebMcpToolsOptions): Promise<boolean> {
  if (controller.signal.aborted || typeof document === "undefined") return false;

  let modelContext: WebMCP.ModelContext | undefined;
  try {
    modelContext = document.modelContext;
  } catch {
    return false;
  }

  if (!modelContext) return false;

  try {
    const toolNames = Object.keys(webMcpToolRegistry) as WebMcpToolName[];
    for (const toolName of toolNames) {
      if (controller.signal.aborted) return false;
      const definition = webMcpToolRegistry[toolName];
      await modelContext.registerTool(
        {
          name: definition.name,
          title: definition.title,
          description: registeredToolDescription(toolName),
          inputSchema: definition.inputSchema,
          annotations: definition.annotations,
          execute: createToolHandler(toolName, getRuntime),
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return false;
    }
  } catch {
    controller.abort();
    return false;
  }

  return !controller.signal.aborted;
}
