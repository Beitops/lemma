import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEMMA_REASONING_WORKSPACE_SKILL, webMcpToolRegistry } from "@lemma/contracts";
import type { LemmaApi } from "./api";
import { useWebMcp } from "../hooks/useWebMcp";
import { registerWebMcpTools, type WebMcpRuntime } from "./webmcp";

const WORKSPACE_ID = "123e4567-e89b-42d3-a456-426614174000";
const OBJECTIVE_ID = "223e4567-e89b-42d3-a456-426614174000";
const STRATEGY_ID = "323e4567-e89b-42d3-a456-426614174000";
const BRANCH_ID = "423e4567-e89b-42d3-a456-426614174000";
const CONTEXT_ID = "523e4567-e89b-42d3-a456-426614174000";
const RESULT_ID = "623e4567-e89b-42d3-a456-426614174000";
const STEP_ID = "723e4567-e89b-42d3-a456-426614174000";
const DECISION_ID = "823e4567-e89b-42d3-a456-426614174000";
const TIMESTAMP = "2026-08-31T10:00:00.000Z";

interface RegisteredToolCall {
  options: WebMCP.ModelContextRegisterToolOptions | undefined;
  tool: WebMCP.ModelContextTool;
}

function setModelContext(modelContext: WebMCP.ModelContext | undefined): void {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: modelContext,
  });
}

function createModelContext(registerTool: WebMCP.ModelContext["registerTool"]): WebMCP.ModelContext {
  return { registerTool } as unknown as WebMCP.ModelContext;
}

function createRuntime(api: LemmaApi, agentName = "Test Agent"): {
  highlight: ReturnType<typeof vi.fn>;
  refreshCurrentWorkspace: ReturnType<typeof vi.fn>;
  runtime: WebMcpRuntime;
} {
  const refreshCurrentWorkspace = vi.fn(async () => undefined);
  const highlight = vi.fn(() => undefined);

  return {
    runtime: { agentName, api, highlight, refreshCurrentWorkspace },
    highlight,
    refreshCurrentWorkspace,
  };
}

function findRegisteredTool(calls: RegisteredToolCall[], name: string): WebMCP.ModelContextTool {
  const tool = calls.find((call) => call.tool.name === name)?.tool;
  if (!tool) throw new Error(`Expected ${name} to be registered.`);
  return tool;
}

async function registerWith(
  runtime: WebMcpRuntime,
  registerTool?: WebMCP.ModelContext["registerTool"],
): Promise<{ available: boolean; calls: RegisteredToolCall[]; controller: AbortController }> {
  const calls: RegisteredToolCall[] = [];
  const registration = registerTool ?? (async (tool, options) => {
    calls.push({ options, tool });
  });
  setModelContext(createModelContext(registration));
  const controller = new AbortController();
  const available = await registerWebMcpTools({ controller, getRuntime: () => runtime });
  return { available, calls, controller };
}

function reasoningResult() {
  return {
    author_agent_name: "Test Agent",
    author_type: "agent" as const,
    author_user_id: null,
    branch_id: BRANCH_ID,
    created_at: TIMESTAMP,
    id: RESULT_ID,
    objective_id: OBJECTIVE_ID,
    outcome_status: "inconclusive" as const,
    result_markdown: "The current route is inconclusive.",
    revision: 1,
    strategy_id: STRATEGY_ID,
    target_id: BRANCH_ID,
    target_revision: 2,
    target_type: "branch" as const,
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

function contextItem() {
  return {
    author_agent_name: "Test Agent",
    author_type: "agent" as const,
    author_user_id: null,
    body_markdown: "Only for this objective.",
    created_at: TIMESTAMP,
    id: CONTEXT_ID,
    kind: "text" as const,
    metadata: {},
    mime_type: null,
    objective_id: OBJECTIVE_ID,
    processing_status: "ready" as const,
    revision: 1,
    size_bytes: null,
    source_url: null,
    storage_bucket: null,
    storage_path: null,
    title: "Objective context",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

afterEach(() => {
  cleanup();
  setModelContext(undefined);
  vi.restoreAllMocks();
});

describe("WebMCP registration", () => {
  it("registers the multi-objective canonical surface with contract schemas and annotations", async () => {
    const { available, calls, controller } = await registerWith(createRuntime({} as LemmaApi).runtime);

    expect(available).toBe(true);
    expect(calls).toHaveLength(21);
    expect(calls.map((call) => call.tool.name).sort()).toEqual([
      "branch_from_step",
      "compare_branches",
      "create_context",
      "create_objective",
      "create_step",
      "create_strategy",
      "find_steps",
      "generate_clean_solution",
      "get_context",
      "get_objective",
      "get_skill",
      "get_workspace",
      "list_objectives",
      "list_strategies",
      "mark_assumption",
      "mark_dead_end",
      "mark_end",
      "request_human_decision",
      "set_reasoning_result",
      "update_objective",
      "update_step",
    ]);

    for (const call of calls) {
      const definition = webMcpToolRegistry[call.tool.name as keyof typeof webMcpToolRegistry];
      expect(call.tool.title).toBe(definition.title);
      if (call.tool.name === "request_human_decision") {
        expect(call.tool.description).toContain("stop mutations on that route");
        expect(call.tool.description).toContain("human resolution");
        expect(call.tool.description).toContain("Side effect:");
      } else {
        expect(call.tool.description).toBe(definition.description);
      }
      expect(call.tool.inputSchema).toBe(definition.inputSchema);
      expect(call.tool.annotations).toEqual(definition.annotations);
      expect(call.options?.signal).toBe(controller.signal);
    }
  });

  it("creates a human checkpoint, preserves its ancestry in the highlight, and never registers resolve", async () => {
    const requestDecision = vi.fn(async () => ({
      ancestry: {
        branch_id: BRANCH_ID,
        objective_id: OBJECTIVE_ID,
        step_id: STEP_ID,
        strategy_id: STRATEGY_ID,
      },
      decision_id: DECISION_ID,
      decision_revision: 1,
      objective_id: OBJECTIVE_ID,
      status: "pending" as const,
      workspace_id: WORKSPACE_ID,
    }));
    const { highlight, refreshCurrentWorkspace, runtime } = createRuntime(
      { requestDecision } as unknown as LemmaApi,
    );
    const { calls } = await registerWith(runtime);
    const signal = new AbortController().signal;

    const response = await findRegisteredTool(calls, "request_human_decision").execute({
      idempotency_key: "decision-checkpoint-001",
      question_markdown: "Should we pursue this bound before continuing?",
      step_id: STEP_ID,
      workspace_id: WORKSPACE_ID,
    }, { signal });

    expect(response).toMatchObject({ ok: true, data: { decision_id: DECISION_ID } });
    expect(requestDecision).toHaveBeenCalledWith(WORKSPACE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      idempotency_key: "decision-checkpoint-001",
      kind: "human_decision",
      question_markdown: "Should we pursue this bound before continuing?",
      step_id: STEP_ID,
    }, signal);
    expect(refreshCurrentWorkspace).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledWith({
      ancestry: {
        branchId: BRANCH_ID,
        objectiveId: OBJECTIVE_ID,
        stepId: STEP_ID,
        strategyId: STRATEGY_ID,
      },
      id: DECISION_ID,
      objectiveId: OBJECTIVE_ID,
      type: "decision",
    });
    expect(calls.map((call) => call.tool.name)).not.toContain("resolve_human_decision");
  });

  it("returns trusted v2 instructions without contacting the API", async () => {
    const { calls } = await registerWith(createRuntime({} as LemmaApi).runtime);
    const result = await findRegisteredTool(calls, "get_skill").execute(
      {},
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({ ok: true, data: LEMMA_REASONING_WORKSPACE_SKILL });
    expect(LEMMA_REASONING_WORKSPACE_SKILL.skill_version).toBe("2.0.0");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).not.toContain("set_workspace_result");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).not.toContain("workspace objective");
  });

  it("returns unavailable when WebMCP is absent and aborts a failed registration", async () => {
    const controller = new AbortController();
    await expect(registerWebMcpTools({ controller, getRuntime: () => createRuntime({} as LemmaApi).runtime }))
      .resolves.toBe(false);
    expect(controller.signal.aborted).toBe(false);

    const registerTool = vi.fn(async () => {
      throw new Error("Registration denied");
    }) as unknown as WebMCP.ModelContext["registerTool"];
    const failed = await registerWith(createRuntime({} as LemmaApi).runtime, registerTool);
    expect(failed.available).toBe(false);
    expect(failed.controller.signal.aborted).toBe(true);
  });

  it("validates untrusted input before contacting the current API client", async () => {
    const getWorkspaceOverview = vi.fn();
    const { calls } = await registerWith(
      createRuntime({ getWorkspaceOverview } as unknown as LemmaApi).runtime,
    );
    const result = await findRegisteredTool(calls, "get_workspace").execute(
      { workspace_id: "not-a-uuid" },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      error: { code: "VALIDATION_ERROR", message: "The tool input does not match its required schema." },
      ok: false,
    });
    expect(getWorkspaceOverview).not.toHaveBeenCalled();
  });

  it("passes an explicit scope and the invocation signal to context reads", async () => {
    const getContext = vi.fn(async () => ({
      effective_context_items: [],
      general_context_items: [],
      objective_context_items: [],
      objective_id: OBJECTIVE_ID,
      workspace_id: WORKSPACE_ID,
    }));
    const { calls } = await registerWith(createRuntime({ getContext } as unknown as LemmaApi).runtime);
    const signal = new AbortController().signal;
    const result = await findRegisteredTool(calls, "get_context").execute(
      { objective_id: OBJECTIVE_ID, scope: "effective", workspace_id: WORKSPACE_ID },
      { signal },
    );

    expect(result).toMatchObject({ ok: true, data: { objective_id: OBJECTIVE_ID } });
    expect(getContext).toHaveBeenCalledWith(
      WORKSPACE_ID,
      { objective_id: OBJECTIVE_ID, scope: "effective" },
      signal,
    );
  });

  it("uses current API actions for objectives, scoped context, and target results", async () => {
    const createObjective = vi.fn(async () => ({
      objective_id: OBJECTIVE_ID,
      objective_revision: 1,
      workspace_id: WORKSPACE_ID,
    }));
    const updateObjective = vi.fn(async () => ({
      objective_id: OBJECTIVE_ID,
      objective_revision: 2,
      status: "active" as const,
      workspace_id: WORKSPACE_ID,
    }));
    const createStrategy = vi.fn(async () => ({
      objective_id: OBJECTIVE_ID,
      root_branch_id: BRANCH_ID,
      root_branch_revision: 1,
      strategy_id: STRATEGY_ID,
      strategy_revision: 1,
      workspace_id: WORKSPACE_ID,
    }));
    const createTextContext = vi.fn(async () => contextItem());
    const setReasoningResult = vi.fn(async () => reasoningResult());
    const { highlight, refreshCurrentWorkspace, runtime } = createRuntime(
      {
        createObjective,
        createStrategy,
        createTextContext,
        setReasoningResult,
        updateObjective,
      } as unknown as LemmaApi,
    );
    const { calls } = await registerWith(runtime);
    const signal = new AbortController().signal;

    const objective = await findRegisteredTool(calls, "create_objective").execute({
      idempotency_key: "objective-create-001",
      objective_markdown: "Prove the claim.",
      title: "Main claim",
      workspace_id: WORKSPACE_ID,
    }, { signal });
    const updatedObjective = await findRegisteredTool(calls, "update_objective").execute({
      expected_revision: 1,
      idempotency_key: "objective-update-001",
      objective_id: OBJECTIVE_ID,
      title: "Refined claim",
      workspace_id: WORKSPACE_ID,
    }, { signal });
    const context = await findRegisteredTool(calls, "create_context").execute({
      body_markdown: "Only for this objective.",
      idempotency_key: "context-create-001",
      objective_id: OBJECTIVE_ID,
      scope: "objective",
      title: "Objective context",
      workspace_id: WORKSPACE_ID,
    }, { signal });
    const strategy = await findRegisteredTool(calls, "create_strategy").execute({
      idempotency_key: "strategy-create-001",
      objective_id: OBJECTIVE_ID,
      title: "Try a direct proof",
      workspace_id: WORKSPACE_ID,
    }, { signal });
    const result = await findRegisteredTool(calls, "set_reasoning_result").execute({
      expected_result_revision: null,
      expected_target_revision: 2,
      idempotency_key: "result-create-001",
      objective_id: OBJECTIVE_ID,
      outcome_status: "inconclusive",
      result_markdown: "The current route is inconclusive.",
      target_id: BRANCH_ID,
      target_type: "branch",
      workspace_id: WORKSPACE_ID,
    }, { signal });

    expect(objective).toMatchObject({ ok: true, data: { objective_id: OBJECTIVE_ID } });
    expect(updatedObjective).toMatchObject({ ok: true, data: { objective_id: OBJECTIVE_ID } });
    expect(context).toMatchObject({ ok: true, data: { id: CONTEXT_ID } });
    expect(strategy).toMatchObject({ ok: true, data: { strategy_id: STRATEGY_ID } });
    expect(result).toMatchObject({ ok: true, data: { id: RESULT_ID, target_type: "branch" } });
    expect(createObjective).toHaveBeenCalledWith(WORKSPACE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      constraints_markdown: "",
      idempotency_key: "objective-create-001",
      objective_markdown: "Prove the claim.",
      title: "Main claim",
    }, signal);
    expect(updateObjective).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      expected_revision: 1,
      idempotency_key: "objective-update-001",
      title: "Refined claim",
    }, signal);
    expect(createTextContext).toHaveBeenCalledWith(WORKSPACE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      body_markdown: "Only for this objective.",
      idempotency_key: "context-create-001",
      kind: "text",
      metadata: {},
      objective_id: OBJECTIVE_ID,
      scope: "objective",
      title: "Objective context",
    }, signal);
    expect(createStrategy).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      description_markdown: "",
      idempotency_key: "strategy-create-001",
      root_branch_name: "Main",
      title: "Try a direct proof",
    }, signal);
    expect(setReasoningResult).toHaveBeenCalledWith(WORKSPACE_ID, OBJECTIVE_ID, {
      author_agent_name: "Test Agent",
      author_type: "agent",
      expected_result_revision: null,
      expected_target_revision: 2,
      idempotency_key: "result-create-001",
      outcome_status: "inconclusive",
      result_markdown: "The current route is inconclusive.",
      target_id: BRANCH_ID,
      target_type: "branch",
    }, signal);
    expect(refreshCurrentWorkspace).toHaveBeenCalledTimes(5);
    expect(highlight).toHaveBeenNthCalledWith(1, {
      id: OBJECTIVE_ID,
      objectiveId: OBJECTIVE_ID,
      type: "objective",
    });
    expect(highlight).toHaveBeenNthCalledWith(2, {
      id: OBJECTIVE_ID,
      objectiveId: OBJECTIVE_ID,
      type: "objective",
    });
    expect(highlight).toHaveBeenNthCalledWith(3, {
      id: CONTEXT_ID,
      objectiveId: OBJECTIVE_ID,
      type: "context",
    });
    expect(highlight).toHaveBeenNthCalledWith(4, {
      id: STRATEGY_ID,
      objectiveId: OBJECTIVE_ID,
      type: "strategy",
    });
    expect(highlight).toHaveBeenNthCalledWith(5, {
      id: BRANCH_ID,
      objectiveId: OBJECTIVE_ID,
      type: "branch",
    });
  });

  it("forwards every retrieval filter with a default limit when the host omits execution options", async () => {
    const findSteps = vi.fn(async (input: { query: string; workspace_id: string }, signal: AbortSignal) => {
      if (signal.aborted) throw new Error("The fallback signal must remain active.");
      return {
        embedding_model: null,
        query: input.query,
        results: [],
        retrieval_mode: "lexical_fallback" as const,
        workspace_id: input.workspace_id,
      };
    });
    const { calls } = await registerWith(createRuntime({ findSteps } as unknown as LemmaApi).runtime);
    const execute = findRegisteredTool(calls, "find_steps").execute as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>;

    await expect(execute({
      branch_id: BRANCH_ID,
      objective_id: OBJECTIVE_ID,
      query: "Cauchy-Schwarz",
      status: "active",
      strategy_id: STRATEGY_ID,
      workspace_id: WORKSPACE_ID,
    }))
      .resolves.toMatchObject({ ok: true });
    expect(findSteps).toHaveBeenCalledWith({
      branch_id: BRANCH_ID,
      objective_id: OBJECTIVE_ID,
      query: "Cauchy-Schwarz",
      status: "active",
      strategy_id: STRATEGY_ID,
      top_k: 10,
      workspace_id: WORKSPACE_ID,
    }, expect.any(AbortSignal));
    expect((findSteps.mock.calls[0]?.[1] as AbortSignal | undefined)?.aborted).toBe(false);

    await expect(execute({
      query: "Cauchy-Schwarz",
      query_embedding: "[0.1, 0.2]",
      workspace_id: WORKSPACE_ID,
    })).resolves.toEqual({
      error: { code: "VALIDATION_ERROR", message: "The tool input does not match its required schema." },
      ok: false,
    });
    expect(findSteps).toHaveBeenCalledTimes(1);
  });

  it("keeps all registrations on one controller and aborts it on hook unmount", async () => {
    const calls: RegisteredToolCall[] = [];
    const registerTool = vi.fn(async (tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
      calls.push({ options, tool });
    });
    setModelContext(createModelContext(registerTool));
    const { result, unmount } = renderHook(() => useWebMcp(createRuntime({} as LemmaApi).runtime));

    await waitFor(() => expect(result.current).toBe(true));
    expect(calls).toHaveLength(21);
    const signal = calls[0]?.options?.signal;
    expect(calls.every((call) => call.options?.signal === signal)).toBe(true);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
