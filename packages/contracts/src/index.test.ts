import { describe, expect, it } from "vitest";

import {
  branchSchema,
  createContextItemResultSchema,
  createContextTextInputSchema,
  createObjectiveInputSchema,
  createStepDependencyInputSchema,
  createStepDependencyResultSchema,
  createStrategyInputSchema,
  decisionSchema,
  findStepsInputSchema,
  findStepsResultSchema,
  getContextInputSchema,
  getSkillInputSchema,
  getSkillResultSchema,
  LEMMA_REASONING_WORKSPACE_SKILL,
  markEndInputSchema,
  markEndResultSchema,
  objectiveSchema,
  pendingDecisionsResultSchema,
  requestHumanDecisionResultSchema,
  reasoningResultSchema,
  resolveHumanDecisionInputSchema,
  resolveHumanDecisionResultSchema,
  setReasoningResultInputSchema,
  setReasoningResultResultSchema,
  webMcpToolRegistry,
  workspaceSchema,
} from "./index.js";

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const objectiveId = "223e4567-e89b-42d3-a456-426614174000";
const strategyId = "323e4567-e89b-42d3-a456-426614174000";
const branchId = "423e4567-e89b-42d3-a456-426614174000";
const stepId = "523e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-08-30T10:00:00.000Z";

const agentAuthor = {
  author_agent_name: "Lemma Agent",
  author_type: "agent" as const,
};

describe("Lemma contracts", () => {
  it("models an empty workspace separately from its objectives", () => {
    expect(
      workspaceSchema.safeParse({
        id: workspaceId,
        owner_id: workspaceId,
        title: "A proof workspace",
        status: "active",
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);

    expect(
      workspaceSchema.safeParse({
        id: workspaceId,
        owner_id: workspaceId,
        title: "A proof workspace",
        objective_markdown: "This must belong to an objective.",
        status: "active",
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(false);

    expect(
      objectiveSchema.safeParse({
        id: objectiveId,
        workspace_id: workspaceId,
        title: "Prove the inequality",
        objective_markdown: "Prove $x^2 \\geq 0$.",
        constraints_markdown: "Use elementary arguments.",
        status: "active",
        author_type: "human",
        author_user_id: workspaceId,
        author_agent_name: null,
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
  });

  it("requires an explicit context scope and objective only for objective context", () => {
    const base = {
      author_type: "human" as const,
      body_markdown: "Definitions shared by the workspace.",
      idempotency_key: "context-create-001",
      title: "Definitions",
      workspace_id: workspaceId,
    };

    expect(createContextTextInputSchema.safeParse(base).success).toBe(false);
    expect(
      createContextTextInputSchema.safeParse({ ...base, scope: "workspace" }).success,
    ).toBe(true);
    expect(
      createContextTextInputSchema.safeParse({
        ...base,
        objective_id: objectiveId,
        scope: "workspace",
      }).success,
    ).toBe(false);
    expect(
      createContextTextInputSchema.safeParse({ ...base, scope: "objective" }).success,
    ).toBe(false);
    expect(
      createContextTextInputSchema.safeParse({
        ...base,
        objective_id: objectiveId,
        scope: "objective",
      }).success,
    ).toBe(true);

    expect(
      getContextInputSchema.safeParse({ workspace_id: workspaceId, scope: "effective" }).success,
    ).toBe(false);
    expect(
      getContextInputSchema.safeParse({
        workspace_id: workspaceId,
        objective_id: objectiveId,
        scope: "effective",
      }).success,
    ).toBe(true);

    expect(
      createContextItemResultSchema.safeParse({
        author_agent_name: null,
        author_type: "human",
        author_user_id: workspaceId,
        body_markdown: "Definitions shared by the workspace.",
        created_at: timestamp,
        id: stepId,
        kind: "text",
        metadata: {},
        mime_type: null,
        objective_id: null,
        processing_status: "ready",
        revision: 1,
        size_bytes: null,
        source_url: null,
        storage_bucket: null,
        storage_path: null,
        title: "Definitions",
        updated_at: timestamp,
        workspace_id: workspaceId,
      }).success,
    ).toBe(true);
  });

  it("requires an objective for strategies and agent-authored mutations", () => {
    const baseInput = {
      workspace_id: workspaceId,
      title: "Use an inequality",
      idempotency_key: "strategy-create-001",
      author_type: "agent" as const,
    };

    expect(createStrategyInputSchema.safeParse(baseInput).success).toBe(false);
    expect(
      createStrategyInputSchema.safeParse({
        ...baseInput,
        objective_id: objectiveId,
        author_agent_name: "Lemma Agent",
      }).success,
    ).toBe(true);
    expect(
      createObjectiveInputSchema.safeParse({
        workspace_id: workspaceId,
        title: "Prove the result",
        objective_markdown: "Prove the result.",
        idempotency_key: "objective-create-001",
        ...agentAuthor,
      }).success,
    ).toBe(true);
  });

  it("preserves branch lineage as an all-or-nothing pair", () => {
    const parsed = branchSchema.safeParse({
      id: branchId,
      workspace_id: workspaceId,
      strategy_id: strategyId,
      name: "Alternative proof",
      status: "active",
      parent_branch_id: branchId,
      forked_from_step_id: null,
      author_type: "human",
      author_user_id: workspaceId,
      author_agent_name: null,
      revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps retrieval workspace-scoped while allowing every public narrowing filter", () => {
    expect(findStepsInputSchema.safeParse({ query: "Cauchy-Schwarz" }).success).toBe(false);
    expect(
      findStepsInputSchema.safeParse({
        workspace_id: workspaceId,
        query: "Cauchy-Schwarz",
        top_k: 21,
      }).success,
    ).toBe(false);
    expect(findStepsInputSchema.parse({
      branch_id: branchId,
      objective_id: objectiveId,
      query: "Cauchy-Schwarz",
      status: "active",
      strategy_id: strategyId,
      workspace_id: workspaceId,
    })).toEqual({
      branch_id: branchId,
      objective_id: objectiveId,
      query: "Cauchy-Schwarz",
      status: "active",
      strategy_id: strategyId,
      top_k: 10,
      workspace_id: workspaceId,
    });
    expect(findStepsInputSchema.safeParse({
      query: "Cauchy-Schwarz",
      query_embedding: "[0.1, 0.2]",
      workspace_id: workspaceId,
    }).success).toBe(false);
    expect(findStepsInputSchema.safeParse({
      embedding_model: "gte-small:384:mean-pool-normalized:v1",
      query: "Cauchy-Schwarz",
      workspace_id: workspaceId,
    }).success).toBe(false);
  });

  it("reports retrieval mode and server-owned embedding metadata", () => {
    expect(findStepsResultSchema.safeParse({
      embedding_model: "gte-small:384:mean-pool-normalized:v1",
      query: "Cauchy-Schwarz",
      results: [],
      retrieval_mode: "hybrid",
      workspace_id: workspaceId,
    }).success).toBe(true);
    expect(findStepsResultSchema.safeParse({
      embedding_model: null,
      query: "Cauchy-Schwarz",
      results: [],
      retrieval_mode: "lexical_fallback",
      workspace_id: workspaceId,
    }).success).toBe(true);
    expect(findStepsResultSchema.safeParse({
      embedding_model: null,
      query: "Cauchy-Schwarz",
      results: [],
      retrieval_mode: "semantic_only",
      workspace_id: workspaceId,
    }).success).toBe(false);
  });

  it("models a workspace-wide human decision inbox and human-only typed resolution", () => {
    const decision = {
      id: "623e4567-e89b-42d3-a456-426614174000",
      workspace_id: workspaceId,
      objective_id: null,
      strategy_id: null,
      branch_id: null,
      step_id: stepId,
      kind: "human_decision" as const,
      question_markdown: "Should we pursue this substitution?",
      status: "pending" as const,
      resolution_markdown: null,
      resolution_outcome: null,
      requested_by_type: "agent" as const,
      requested_by_user_id: workspaceId,
      requested_by_agent_name: "Lemma Agent",
      resolved_by_user_id: null,
      resolved_at: null,
      revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const ancestry = {
      objective_id: objectiveId,
      strategy_id: strategyId,
      branch_id: branchId,
      step_id: stepId,
    };

    expect(decisionSchema.safeParse(decision).success).toBe(true);
    expect(pendingDecisionsResultSchema.safeParse({
      workspace_id: workspaceId,
      decisions: [{ decision, ancestry }],
    }).success).toBe(true);
    expect(requestHumanDecisionResultSchema.safeParse({
      decision_id: decision.id,
      decision_revision: 1,
      workspace_id: workspaceId,
      objective_id: null,
      ancestry,
      status: "pending",
    }).success).toBe(true);

    const resolution = {
      decision_id: decision.id,
      expected_decision_revision: 1,
      resolution_outcome: "accepted" as const,
      resolution_markdown: "Proceed with the substitution.",
      idempotency_key: "decision-resolve-001",
    };
    expect(resolveHumanDecisionInputSchema.safeParse(resolution).success).toBe(true);
    expect(resolveHumanDecisionInputSchema.safeParse({
      ...resolution,
      author_type: "agent",
    }).success).toBe(false);
    expect(resolveHumanDecisionInputSchema.safeParse({
      ...resolution,
      resolution_outcome: "maybe",
    }).success).toBe(false);
    expect(resolveHumanDecisionResultSchema.safeParse({
      decision_id: decision.id,
      decision_revision: 2,
      status: "resolved",
      resolution_outcome: "accepted",
      resolved_at: timestamp,
    }).success).toBe(true);
  });

  it("validates outcome results against exactly one strategy or branch target", () => {
    const input = {
      workspace_id: workspaceId,
      objective_id: objectiveId,
      target_type: "branch" as const,
      target_id: branchId,
      expected_target_revision: 4,
      expected_result_revision: null,
      result_markdown: "The initial hypothesis is false by contradiction.",
      outcome_status: "unsuccessful" as const,
      idempotency_key: "reasoning-result-001",
      ...agentAuthor,
    };

    expect(setReasoningResultInputSchema.safeParse(input).success).toBe(true);
    expect(
      setReasoningResultInputSchema.safeParse({ ...input, expected_result_revision: 0 }).success,
    ).toBe(false);

    const result = {
      id: "623e4567-e89b-42d3-a456-426614174000",
      workspace_id: workspaceId,
      objective_id: objectiveId,
      strategy_id: strategyId,
      branch_id: branchId,
      target_type: "branch" as const,
      target_id: branchId,
      target_revision: 4,
      outcome_status: "unsuccessful" as const,
      result_markdown: input.result_markdown,
      author_type: "agent" as const,
      author_user_id: null,
      author_agent_name: "Lemma Agent",
      revision: 1,
      created_at: timestamp,
      updated_at: timestamp,
    };
    expect(reasoningResultSchema.safeParse(result).success).toBe(true);
    expect(setReasoningResultResultSchema.safeParse(result).success).toBe(true);
    expect(
      reasoningResultSchema.safeParse({ ...result, target_id: strategyId }).success,
    ).toBe(false);
    expect(
      reasoningResultSchema.safeParse({ ...result, branch_id: null }).success,
    ).toBe(false);

    const strategyResult = {
      ...result,
      branch_id: null,
      target_id: strategyId,
      target_type: "strategy" as const,
    };
    expect(reasoningResultSchema.safeParse(strategyResult).success).toBe(true);
    expect(
      reasoningResultSchema.safeParse({ ...strategyResult, branch_id: branchId }).success,
    ).toBe(false);
    expect(
      reasoningResultSchema.safeParse({ ...strategyResult, target_id: branchId }).success,
    ).toBe(false);

    expect(
      markEndInputSchema.safeParse({
        branch_id: branchId,
        expected_branch_revision: 2,
        expected_strategy_revision: 3,
        idempotency_key: "branch-completion-001",
        ...agentAuthor,
      }).success,
    ).toBe(true);
    expect(
      markEndResultSchema.safeParse({
        workspace_id: workspaceId,
        objective_id: objectiveId,
        branch_id: branchId,
        branch_revision: 4,
        branch_status: "completed",
        strategy_id: strategyId,
        strategy_revision: 4,
        strategy_status: "completed",
      }).success,
    ).toBe(true);
  });

  it("validates a narrow, retry-safe directed dependency connection", () => {
    const targetStepId = "723e4567-e89b-42d3-a456-426614174000";
    const input = {
      idempotency_key: "823e4567-e89b-42d3-a456-426614174000",
      source_step_id: stepId,
      target_step_id: targetStepId,
      workspace_id: workspaceId,
    };

    expect(createStepDependencyInputSchema.safeParse(input).success).toBe(true);
    expect(
      createStepDependencyInputSchema.safeParse({ ...input, target_step_id: stepId }).success,
    ).toBe(false);
    expect(
      createStepDependencyResultSchema.safeParse({
        created: true,
        dependency_revision: 1,
        source_step_id: stepId,
        step_dependency_id: "923e4567-e89b-42d3-a456-426614174000",
        target_step_id: targetStepId,
        workspace_id: workspaceId,
      }).success,
    ).toBe(true);
  });

  it("publishes trusted v2 operating instructions without single-workspace objective wording", () => {
    expect(getSkillInputSchema.safeParse({}).success).toBe(true);
    expect(getSkillInputSchema.safeParse({ workspace_id: workspaceId }).success).toBe(false);
    expect(getSkillResultSchema.safeParse(LEMMA_REASONING_WORKSPACE_SKILL).success).toBe(true);
    expect(LEMMA_REASONING_WORKSPACE_SKILL.skill_version).toBe("2.0.0");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`get_objective`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`set_reasoning_result`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`strategy_id`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`branch_id`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`status`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).toContain("`retrieval_mode`");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).not.toContain("workspace objective");
    expect(LEMMA_REASONING_WORKSPACE_SKILL.instructions_markdown).not.toContain("set_workspace_result");
  });

  it("publishes the multi-objective WebMCP surface with JSON Schema", () => {
    expect(Object.keys(webMcpToolRegistry).sort()).toEqual([
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

    expect(webMcpToolRegistry.create_step.input_json_schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        body_markdown: { description: expect.stringContaining("$...") },
      },
    });
    expect(webMcpToolRegistry.find_steps.input_json_schema).toMatchObject({
      required: ["workspace_id", "query"],
      type: "object",
      properties: {
        branch_id: { description: expect.stringContaining("branch") },
        objective_id: { description: expect.stringContaining("objective") },
        status: { description: expect.stringContaining("status") },
        strategy_id: { description: expect.stringContaining("strategy") },
        workspace_id: { description: expect.stringContaining("workspace") },
      },
    });
    expect(webMcpToolRegistry.find_steps.input_json_schema).not.toHaveProperty("properties.query_embedding");
    expect(webMcpToolRegistry.find_steps.input_json_schema).not.toHaveProperty("properties.embedding_model");
    expect(webMcpToolRegistry.find_steps.description).toContain("strategy_id");
    expect(webMcpToolRegistry.find_steps.description).toContain("lexical-fallback");
    expect(webMcpToolRegistry.get_workspace.read_only_hint).toBe(true);
    expect(webMcpToolRegistry.get_objective.read_only_hint).toBe(true);
    expect(webMcpToolRegistry.create_objective.read_only_hint).toBe(false);
    expect(webMcpToolRegistry.set_reasoning_result.read_only_hint).toBe(false);
    expect(webMcpToolRegistry.get_objective.annotations.untrustedContentHint).toBe(true);
    expect(webMcpToolRegistry.get_skill.annotations.untrustedContentHint).toBe(false);
  });
});
