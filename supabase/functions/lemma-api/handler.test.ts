import {
  ApiError,
  createLemmaApiHandler,
  createSupabaseAuthenticator,
  loadLemmaApiEnvironment,
  SupabaseGraphService,
  type AuthenticatedUser,
  type GraphService,
  type LemmaApiEnvironment,
} from "./handler.ts";
import { it } from "vitest";

const environment: LemmaApiEnvironment = {
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  SUPABASE_URL: "https://example.supabase.co",
  WEB_ORIGIN: ["http://localhost:5173"],
};

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const contextId = "44444444-4444-4444-8444-444444444444";
const objectiveId = "55555555-5555-4555-8555-555555555555";
const strategyId = "66666666-6666-4666-8666-666666666666";
const branchId = "77777777-7777-4777-8777-777777777777";
const decisionId = "88888888-8888-4888-8888-888888888888";
const sourceStepId = "99999999-9999-4999-8999-999999999999";
const targetStepId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const stepDependencyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const secondSourceStepId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const boundedDependencyIds = Array.from(
  { length: 64 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}. Expected ${String(expected)}, received ${String(actual)}.`);
  }
}

function workspace() {
  return {
    created_at: "2026-08-31T00:00:00.000Z",
    id: workspaceId,
    owner_id: userId,
    revision: 1,
    status: "active",
    title: "Identity",
    updated_at: "2026-08-31T00:00:00.000Z",
  };
}

function objective() {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: userId,
    constraints_markdown: "",
    created_at: "2026-08-31T00:00:00.000Z",
    id: objectiveId,
    objective_markdown: "Prove $x=x$.",
    revision: 1,
    status: "active",
    title: "Identity",
    updated_at: "2026-08-31T00:00:00.000Z",
    workspace_id: workspaceId,
  };
}

function workspaceOverview() {
  return {
    general_context_items: [],
    objectives: [{ ...objective(), branch_count: 0, step_count: 0, strategy_count: 0 }],
    workspace: workspace(),
  };
}

function objectiveGraph() {
  return {
    activity_events: [],
    assumptions: [],
    branches: [],
    decisions: [],
    effective_context_items: [],
    general_context_items: [],
    objective: objective(),
    objective_context_items: [],
    reasoning_results: [],
    sources: [],
    step_assumptions: [],
    step_dependencies: [],
    step_sources: [],
    steps: [],
    strategies: [],
    workspace: workspace(),
  };
}

function reasoningResult() {
  return {
    author_agent_name: "Test Agent",
    author_type: "agent",
    author_user_id: null,
    branch_id: branchId,
    created_at: "2026-08-31T00:00:00.000Z",
    id: "88888888-8888-4888-8888-888888888888",
    objective_id: objectiveId,
    outcome_status: "inconclusive",
    result_markdown: "The current route is inconclusive.",
    revision: 1,
    strategy_id: strategyId,
    target_id: branchId,
    target_revision: 2,
    target_type: "branch",
    updated_at: "2026-08-31T00:00:00.000Z",
    workspace_id: workspaceId,
  };
}

function searchStepResult() {
  return {
    branch_id: branchId,
    combined_score: 0.032,
    full_text_rank: 1,
    objective_id: objectiveId,
    objective_title: "Identity",
    semantic_rank: 2,
    snippet: "Apply the identity directly.",
    status: "active",
    step_id: "99999999-9999-4999-8999-999999999999",
    step_revision: 1,
    strategy_id: strategyId,
    strategy_title: "Direct proof",
    title: "Apply the identity",
    workspace_id: workspaceId,
  };
}

function pendingDecision() {
  return {
    ancestry: {
      branch_id: branchId,
      objective_id: objectiveId,
      step_id: "99999999-9999-4999-8999-999999999999",
      strategy_id: strategyId,
    },
    decision: {
      branch_id: null,
      created_at: "2026-08-31T00:00:00.000Z",
      id: decisionId,
      kind: "human_decision",
      objective_id: null,
      question_markdown: "Should we continue this branch?",
      requested_by_agent_name: "Lemma Agent",
      requested_by_type: "agent",
      requested_by_user_id: userId,
      resolution_markdown: null,
      resolution_outcome: null,
      resolved_at: null,
      resolved_by_user_id: null,
      revision: 1,
      status: "pending",
      step_id: "99999999-9999-4999-8999-999999999999",
      strategy_id: null,
      updated_at: "2026-08-31T00:00:00.000Z",
      workspace_id: workspaceId,
    },
  };
}

function contextItem() {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: userId,
    body_markdown: null,
    created_at: "2026-08-31T00:00:00.000Z",
    id: contextId,
    kind: "pdf",
    metadata: {},
    mime_type: "application/pdf",
    objective_id: null,
    processing_status: "ready",
    revision: 1,
    size_bytes: 42,
    source_url: null,
    storage_bucket: "workspace-context",
    storage_path: `${userId}/${workspaceId}/${contextId}/proof.pdf`,
    title: "A direct upload",
    updated_at: "2026-08-31T00:00:00.000Z",
    workspace_id: workspaceId,
  };
}

function unsupported(): Promise<never> {
  return Promise.reject(new Error("Unexpected graph-service call."));
}

function graphService(overrides: Partial<GraphService> = {}): GraphService {
  return {
    branchFromStep: unsupported,
    compareBranches: unsupported,
    createFileContext: unsupported,
    createLinkContext: unsupported,
    createObjective: unsupported,
    createStep: unsupported,
    createStepDependency: unsupported,
    createStrategy: unsupported,
    createTextContext: unsupported,
    createWorkspace: unsupported,
    findSteps: unsupported,
    generateCleanSolution: unsupported,
    getBranchPath: unsupported,
    getContext: unsupported,
    getDownloadUrl: unsupported,
    getObjective: unsupported,
    getObjectiveGraph: unsupported,
    getWorkspace: unsupported,
    getWorkspaceOverview: unsupported,
    listObjectives: unsupported,
    listPendingDecisions: unsupported,
    listStrategies: unsupported,
    listWorkspaces: unsupported,
    markAssumption: unsupported,
    markDeadEnd: unsupported,
    markEnd: unsupported,
    requestHumanDecision: unsupported,
    resolveHumanDecision: unsupported,
    saveCleanSolution: unsupported,
    setReasoningResult: unsupported,
    updateStep: unsupported,
    updateObjective: unsupported,
    updateWorkspace: unsupported,
    verifyContextFile: unsupported,
    ...overrides,
  };
}

function user(): AuthenticatedUser {
  return {
    accessToken: "test-token",
    id: userId,
    supabase: {} as AuthenticatedUser["supabase"],
  };
}

function handler(service: GraphService, authenticate = async (): Promise<AuthenticatedUser> => user()) {
  return createLemmaApiHandler({
    authenticate,
    createGraphService: () => service,
    environment,
  });
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, init);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

it("keeps health public through direct and gateway-prefixed paths", async () => {
  const api = handler(graphService());

  for (const path of ["/api/v1/health", "/lemma-api/api/v1/health"]) {
    const response = await api(request(path));
    const payload = await readJson(response);
    assertEqual(response.status, 200, "health status");
    assertEqual((payload.data as Record<string, unknown>).service, "lemma-api", "health service");
    assertEqual(response.headers.get("Origin-Agent-Cluster"), "?1", "WebMCP header");
  }
});

it("accepts authenticated routes through direct and gateway-prefixed paths", async () => {
  let authCalls = 0;
  const api = handler(
    graphService({
      listWorkspaces: async () => [
        { active_objective_count: 1, objective_count: 1, workspace: workspace() },
      ],
    }),
    async () => {
      authCalls += 1;
      return user();
    },
  );

  for (const path of ["/api/v1/workspaces", "/lemma-api/api/v1/workspaces"]) {
    const response = await api(
      request(path, { headers: { Authorization: "Bearer test-token" } }),
    );
    const payload = await readJson(response);
    assertEqual(response.status, 200, "workspace list status");
    const data = payload.data as Record<string, unknown>;
    assertEqual((data.workspaces as unknown[]).length, 1, "workspace list length");
  }

  assertEqual(authCalls, 2, "authenticated requests must verify their token");
});

it("permits apikey preflight and keeps CORS/security headers on errors", async () => {
  const api = handler(graphService());
  const preflight = await api(
    request("/lemma-api/api/v1/workspaces", {
      headers: {
        "Access-Control-Request-Headers": "authorization, apikey",
        "Access-Control-Request-Method": "GET",
        Origin: "http://localhost:5173",
      },
      method: "OPTIONS",
    }),
  );

  assertEqual(preflight.status, 204, "preflight status");
  assert(
    preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase().includes("apikey"),
    "preflight must permit apikey",
  );
  assertEqual(
    preflight.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5173",
    "preflight origin",
  );

  const unauthorized = await api(
    request("/api/v1/workspaces", { headers: { Origin: "http://localhost:5173" } }),
  );
  const payload = await readJson(unauthorized);
  assertEqual(unauthorized.status, 401, "unauthorized status");
  assertEqual(
    (payload.error as Record<string, unknown>).code,
    "UNAUTHORIZED",
    "unauthorized envelope code",
  );
  assertEqual(
    unauthorized.headers.get("Access-Control-Allow-Origin"),
    "http://localhost:5173",
    "error CORS origin",
  );
  assertEqual(unauthorized.headers.get("X-Content-Type-Options"), "nosniff", "error security header");
});

it("logs sanitized diagnostics for 5xx failures but not 4xx responses", async () => {
  const diagnostics: Record<string, unknown>[] = [];
  const tokenLikeValue = "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue";
  const api = createLemmaApiHandler({
    authenticate: async () => user(),
    createGraphService: () =>
      graphService({
        listWorkspaces: async () => {
          throw new Error(`Unexpected upstream failure: ${tokenLikeValue}`);
        },
      }),
    environment,
    logError: (diagnostic) => diagnostics.push(diagnostic),
  });

  const serverError = await api(
    request("/api/v1/workspaces", { headers: { Authorization: "Bearer test-token" } }),
  );
  assertEqual(serverError.status, 500, "server-error status");
  assertEqual(diagnostics.length, 1, "5xx diagnostics count");
  const loggedError = diagnostics[0]?.error as Record<string, unknown>;
  assert(
    !String(loggedError.message).includes(tokenLikeValue),
    "diagnostics must not contain a bearer-like token",
  );

  const clientError = await api(request("/api/v1/workspaces"));
  assertEqual(clientError.status, 401, "client-error status");
  assertEqual(diagnostics.length, 1, "4xx responses must not be logged as server errors");
});

it("validates Supabase claims before creating an RLS client", async () => {
  const calls: unknown[][] = [];
  const callerClient = {} as AuthenticatedUser["supabase"];
  const fakeFactory = ((...args: unknown[]) => {
    calls.push(args);
    if (calls.length === 1) {
      return {
        auth: {
          getClaims: async () => ({
            data: {
              claims: {
                aud: "authenticated",
                iss: "https://example.supabase.co/auth/v1",
                role: "authenticated",
                sub: userId,
              },
            },
            error: null,
          }),
        },
      };
    }
    return callerClient;
  }) as never;

  const authenticate = createSupabaseAuthenticator(environment, fakeFactory);
  const authenticated = await authenticate("test-token");
  assertEqual(authenticated.id, userId, "verified user id");
  assertEqual(authenticated.supabase, callerClient, "caller-scoped client");
  assertEqual(calls.length, 2, "a data client is created only after verification");
});

it("accepts the Edge runtime anon key when no publishable key is configured", () => {
  const loaded = loadLemmaApiEnvironment({
    SUPABASE_ANON_KEY: "sb_anon_test_key",
    SUPABASE_PUBLISHABLE_KEY: "",
    SUPABASE_URL: "https://example.supabase.co",
  });

  assertEqual(
    loaded.SUPABASE_PUBLISHABLE_KEY,
    "sb_anon_test_key",
    "anon key fallback is the caller-scoped public key",
  );
  assert(
    loaded.WEB_ORIGIN.includes("http://localhost:5173") &&
      loaded.WEB_ORIGIN.includes("http://127.0.0.1:5173"),
    "the default CORS allowlist must support both local Vite origins",
  );
});

it("serves objective shell, graph, scoped context, and objective mutations through v1 routes", async () => {
  let createdObjective: Record<string, unknown> | undefined;
  let updatedObjective: Record<string, unknown> | undefined;
  let contextInput: Record<string, unknown> | undefined;
  let strategyInput: Record<string, unknown> | undefined;
  let resultInput: Record<string, unknown> | undefined;
  const api = handler(
    graphService({
      createObjective: async (input) => {
        createdObjective = input;
        return { objective_id: objectiveId, objective_revision: 1, workspace_id: workspaceId };
      },
      createStrategy: async (input) => {
        strategyInput = input;
        return {
          objective_id: objectiveId,
          root_branch_id: branchId,
          root_branch_revision: 1,
          strategy_id: strategyId,
          strategy_revision: 1,
          workspace_id: workspaceId,
        };
      },
      getContext: async (input) => {
        contextInput = input;
        return {
          effective_context_items: [],
          general_context_items: [],
          objective_context_items: [],
          objective_id: objectiveId,
          workspace_id: workspaceId,
        };
      },
      getObjective: async () => objective(),
      getObjectiveGraph: async () => objectiveGraph(),
      getWorkspaceOverview: async () => workspaceOverview(),
      listObjectives: async () => ({
        objectives: workspaceOverview().objectives,
        workspace_id: workspaceId,
      }),
      listStrategies: async () => ({
        branches: [],
        objective_id: objectiveId,
        strategies: [],
        workspace_id: workspaceId,
      }),
      setReasoningResult: async (input) => {
        resultInput = input;
        return reasoningResult();
      },
      updateObjective: async (input) => {
        updatedObjective = input;
        return {
          objective_id: objectiveId,
          objective_revision: 2,
          status: "active",
          workspace_id: workspaceId,
        };
      },
    }),
  );
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

  const shell = await api(request(`/api/v1/workspaces/${workspaceId}`, { headers }));
  assertEqual(shell.status, 200, "workspace overview status");

  const objectives = await api(request(`/api/v1/workspaces/${workspaceId}/objectives`, { headers }));
  assertEqual(objectives.status, 200, "objective list status");

  const created = await api(request(`/api/v1/workspaces/${workspaceId}/objectives`, {
    body: JSON.stringify({
      author_type: "human",
      constraints_markdown: "",
      idempotency_key: "objective-create-123",
      objective_markdown: "Prove the identity.",
      title: "Identity",
    }),
    headers,
    method: "POST",
  }));
  assertEqual(created.status, 201, "objective create status");
  assertEqual(createdObjective?.workspace_id, workspaceId, "route workspace owns objective creation");

  const objectiveResponse = await api(request(
    `/api/v1/workspaces/${workspaceId}/objectives/${objectiveId}`,
    { headers },
  ));
  assertEqual(objectiveResponse.status, 200, "objective get status");

  const graph = await api(request(
    `/api/v1/workspaces/${workspaceId}/objectives/${objectiveId}/graph`,
    { headers },
  ));
  assertEqual(graph.status, 200, "objective graph status");

  const updated = await api(request(
    `/api/v1/workspaces/${workspaceId}/objectives/${objectiveId}`,
    {
      body: JSON.stringify({
        author_type: "human",
        expected_revision: 1,
        idempotency_key: "objective-update-123",
        title: "Identity, revised",
      }),
      headers,
      method: "PATCH",
    },
  ));
  assertEqual(updated.status, 200, "objective update status");
  assertEqual(updatedObjective?.workspace_id, workspaceId, "route workspace owns objective update");
  assertEqual(updatedObjective?.objective_id, objectiveId, "route objective owns objective update");

  const context = await api(request(
    `/api/v1/workspaces/${workspaceId}/context?scope=effective&objective_id=${objectiveId}`,
    { headers },
  ));
  assertEqual(context.status, 200, "effective context status");
  assertEqual(contextInput?.scope, "effective", "context scope is forwarded to the service");
  assertEqual(contextInput?.objective_id, objectiveId, "context objective is forwarded to the service");

  const strategies = await api(request(
    `/api/v1/workspaces/${workspaceId}/objectives/${objectiveId}/strategies`,
    {
      body: JSON.stringify({
        author_type: "human",
        idempotency_key: "strategy-create-123",
        title: "Direct proof",
      }),
      headers,
      method: "POST",
    },
  ));
  assertEqual(strategies.status, 201, "strategy create status");
  assertEqual(strategyInput?.objective_id, objectiveId, "route objective owns strategy creation");

  const result = await api(request(
    `/api/v1/workspaces/${workspaceId}/objectives/${objectiveId}/reasoning-results`,
    {
      body: JSON.stringify({
        author_type: "human",
        expected_result_revision: null,
        expected_target_revision: 2,
        idempotency_key: "result-create-123",
        outcome_status: "inconclusive",
        result_markdown: "The current route is inconclusive.",
        target_id: branchId,
        target_type: "branch",
      }),
      headers,
      method: "PUT",
    },
  ));
  assertEqual(result.status, 200, "reasoning result status");
  assertEqual(resultInput?.objective_id, objectiveId, "route objective owns reasoning result");
});

it("lists workspace-wide pending decisions and accepts only a typed human resolution", async () => {
  let resolvedInput: Record<string, unknown> | undefined;
  const api = handler(graphService({
    listPendingDecisions: async (receivedWorkspaceId) => ({
      decisions: [pendingDecision()],
      workspace_id: receivedWorkspaceId,
    }),
    resolveHumanDecision: async (input) => {
      resolvedInput = input;
      return {
        decision_id: decisionId,
        decision_revision: 2,
        resolution_outcome: "accepted",
        resolved_at: "2026-08-31T00:01:00.000Z",
        status: "resolved",
      };
    },
  }));
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

  const inbox = await api(request(
    `/api/v1/workspaces/${workspaceId}/decisions/pending`,
    { headers },
  ));
  const inboxPayload = await readJson(inbox);
  assertEqual(inbox.status, 200, "pending-decision inbox status");
  const inboxData = inboxPayload.data as Record<string, unknown>;
  const first = (inboxData.decisions as Array<Record<string, unknown>>)[0] ?? {};
  assertEqual(
    ((first.ancestry as Record<string, unknown>).strategy_id),
    strategyId,
    "inbox includes derived strategy ancestry",
  );
  assertEqual(
    ((first.decision as Record<string, unknown>).id),
    decisionId,
    "inbox includes pending decision data",
  );

  const resolved = await api(request(`/api/v1/decisions/${decisionId}/resolve`, {
    body: JSON.stringify({
      expected_decision_revision: 1,
      idempotency_key: "decision-resolve-001",
      resolution_markdown: "Continue with the substitution.",
      resolution_outcome: "accepted",
    }),
    headers,
    method: "POST",
  }));
  assertEqual(resolved.status, 200, "human decision resolution status");
  assertEqual(resolvedInput?.resolution_outcome, "accepted", "typed outcome reaches the service");
  assertEqual(
    Object.hasOwn(resolvedInput ?? {}, "author_type"),
    false,
    "resolution input has no caller-selectable author type",
  );

  const rejected = await api(request(`/api/v1/decisions/${decisionId}/resolve`, {
    body: JSON.stringify({
      author_type: "agent",
      expected_decision_revision: 1,
      idempotency_key: "decision-resolve-002",
      resolution_markdown: "Impersonation must fail.",
      resolution_outcome: "accepted",
    }),
    headers,
    method: "POST",
  }));
  const rejectedPayload = await readJson(rejected);
  assertEqual(rejected.status, 400, "agent resolver declaration is rejected");
  assertEqual(
    (rejectedPayload.error as Record<string, unknown>).code,
    "VALIDATION_ERROR",
    "agent resolver declaration is a validation error",
  );
});

it("maps a decision resolution to the human-only typed RPC signature", async () => {
  const calls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  const service = new SupabaseGraphService({
    rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
      calls.push({ arguments_, functionName });
      return {
        data: {
          decision_id: decisionId,
          decision_revision: 2,
          resolution_outcome: "accepted",
          resolved_at: "2026-08-31T00:01:00.000Z",
          status: "resolved",
        },
        error: null,
      };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  await service.resolveHumanDecision({
    // A GraphService caller cannot alter the resolver: public route validation
    // rejects this field, and the service deliberately never forwards it.
    author_type: "agent",
    decision_id: decisionId,
    expected_decision_revision: 1,
    idempotency_key: "decision-resolve-001",
    resolution_markdown: "Continue with the substitution.",
    resolution_outcome: "accepted",
  });

  assertEqual(calls[0]?.functionName, "resolve_human_decision", "resolution RPC name");
  assertEqual(
    JSON.stringify(calls[0]?.arguments_),
    JSON.stringify({
      p_decision_id: decisionId,
      p_expected_revision: 1,
      p_idempotency_key: "decision-resolve-001",
      p_resolution_markdown: "Continue with the substitution.",
      p_resolution_outcome: "accepted",
    }),
    "resolution RPC has only the typed five-argument payload",
  );
});

it("maps ordered agent-authored step dependencies to the create-step RPC", async () => {
  const calls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  const service = new SupabaseGraphService({
    rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
      calls.push({ arguments_, functionName });
      return {
        data: {
          branch_id: branchId,
          branch_revision: 2,
          ordinal: 1,
          step_dependencies: [
            {
              dependency_revision: 1,
              source_step_id: sourceStepId,
              step_dependency_id: stepDependencyId,
              target_step_id: targetStepId,
            },
          ],
          step_id: targetStepId,
          step_revision: 1,
        },
        error: null,
      };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  await service.createStep({
    author_agent_name: "Step Agent",
    author_type: "agent",
    body_markdown: "Apply the prerequisite result.",
    branch_id: branchId,
    concepts: ["substitution"],
    depends_on_step_ids: [sourceStepId, secondSourceStepId],
    expected_branch_revision: 1,
    idempotency_key: "step-create-dependencies-001",
    status: "active",
    theorem_tags: ["algebra"],
    title: "Use prior results",
  });

  assertEqual(calls[0]?.functionName, "create_step", "step RPC name");
  assertEqual(
    JSON.stringify(calls[0]?.arguments_.p_depends_on_step_ids),
    JSON.stringify([sourceStepId, secondSourceStepId]),
    "step RPC preserves prerequisite source ordering",
  );
  assertEqual(calls[0]?.arguments_.p_author_type, "agent", "step RPC preserves agent author type");
  assertEqual(
    calls[0]?.arguments_.p_author_agent_name,
    "Step Agent",
    "step RPC preserves agent provenance",
  );
});

it("omits the dependency RPC argument when create-step has no prerequisites", async () => {
  const calls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  const service = new SupabaseGraphService({
    rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
      calls.push({ arguments_, functionName });
      return {
        data: {
          branch_id: branchId,
          branch_revision: 2,
          ordinal: 1,
          step_id: targetStepId,
          step_revision: 1,
        },
        error: null,
      };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  await service.createStep({
    author_type: "human",
    body_markdown: "A standalone step.",
    branch_id: branchId,
    depends_on_step_ids: [],
    expected_branch_revision: 1,
    idempotency_key: "step-create-without-dependencies-001",
    title: "Standalone step",
  });

  assertEqual(calls[0]?.functionName, "create_step", "step RPC name without dependencies");
  assert(
    !("p_depends_on_step_ids" in (calls[0]?.arguments_ ?? {})),
    "empty prerequisites should preserve compatibility with the legacy RPC signature",
  );
});

it("validates bounded step dependencies and routes them through the branch-scoped endpoint", async () => {
  let stepInput: Record<string, unknown> | undefined;
  let createCalls = 0;
  const api = handler(graphService({
    createStep: async (input) => {
      createCalls += 1;
      stepInput = input;
      return {
        branch_id: branchId,
        branch_revision: 2,
        ordinal: 1,
        step_dependencies: [],
        step_id: targetStepId,
        step_revision: 1,
      };
    },
  }));
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

  const created = await api(request(`/api/v1/branches/${branchId}/steps`, {
    body: JSON.stringify({
      author_agent_name: "Step Agent",
      author_type: "agent",
      body_markdown: "Apply the prerequisite result.",
      branch_id: otherWorkspaceId,
      depends_on_step_ids: boundedDependencyIds,
      expected_branch_revision: 1,
      idempotency_key: "step-create-dependencies-002",
      title: "Use bounded dependencies",
    }),
    headers,
    method: "POST",
  }));
  const createdPayload = await readJson(created);
  assertEqual(created.status, 201, "step creation with bounded dependencies status");
  assertEqual(stepInput?.branch_id, branchId, "route controls step branch");
  assertEqual(
    JSON.stringify(stepInput?.depends_on_step_ids),
    JSON.stringify(boundedDependencyIds),
    "route forwards the bounded prerequisite list in order",
  );
  assertEqual(stepInput?.author_type, "agent", "route retains step agent author type");
  assertEqual(stepInput?.author_agent_name, "Step Agent", "route retains step agent provenance");
  assertEqual(
    ((createdPayload.data as Record<string, unknown>).step_dependencies as unknown[]).length,
    0,
    "create-step result permits no dependencies when none were created",
  );

  const overLimit = await api(request(`/api/v1/branches/${branchId}/steps`, {
    body: JSON.stringify({
      author_agent_name: "Step Agent",
      author_type: "agent",
      body_markdown: "This list must be rejected before reaching the service.",
      depends_on_step_ids: [
        ...boundedDependencyIds,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ],
      expected_branch_revision: 2,
      idempotency_key: "step-create-dependencies-003",
      title: "Too many dependencies",
    }),
    headers,
    method: "POST",
  }));
  assertEqual(overLimit.status, 400, "over-limit step dependencies are rejected");
  assertEqual(createCalls, 1, "over-limit dependencies never reach the graph service");
});

it("maps an agent-authored dependency to the receipt-backed RPC signature", async () => {
  const calls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  const service = new SupabaseGraphService({
    rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
      calls.push({ arguments_, functionName });
      return {
        data: {
          created: true,
          dependency_revision: 1,
          source_step_id: sourceStepId,
          step_dependency_id: stepDependencyId,
          target_step_id: targetStepId,
          workspace_id: workspaceId,
        },
        error: null,
      };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  await service.createStepDependency({
    author_agent_name: "Dependency Agent",
    author_type: "agent",
    idempotency_key: stepDependencyId,
    source_step_id: sourceStepId,
    target_step_id: targetStepId,
    workspace_id: workspaceId,
  });

  assertEqual(calls[0]?.functionName, "create_step_dependency", "dependency RPC name");
  assertEqual(
    JSON.stringify(calls[0]?.arguments_),
    JSON.stringify({
      p_idempotency_key: stepDependencyId,
      p_source_step_id: sourceStepId,
      p_target_step_id: targetStepId,
      p_workspace_id: workspaceId,
      p_author_type: "agent",
      p_author_agent_name: "Dependency Agent",
    }),
    "dependency RPC preserves source/target orientation and agent provenance",
  );
});

it("validates and routes agent dependency provenance through the workspace-scoped endpoint", async () => {
  let dependencyInput: Record<string, unknown> | undefined;
  const api = handler(graphService({
    createStepDependency: async (input) => {
      dependencyInput = input;
      return {
        created: true,
        dependency_revision: 1,
        source_step_id: sourceStepId,
        step_dependency_id: stepDependencyId,
        target_step_id: targetStepId,
        workspace_id: workspaceId,
      };
    },
  }));
  const headers = { Authorization: "Bearer test-token", "Content-Type": "application/json" };

  const created = await api(request(`/api/v1/workspaces/${workspaceId}/step-dependencies`, {
    body: JSON.stringify({
      author_agent_name: "Dependency Agent",
      author_type: "agent",
      idempotency_key: stepDependencyId,
      source_step_id: sourceStepId,
      target_step_id: targetStepId,
      workspace_id: otherWorkspaceId,
    }),
    headers,
    method: "POST",
  }));
  assertEqual(created.status, 201, "agent dependency creation status");
  assertEqual(dependencyInput?.workspace_id, workspaceId, "route controls dependency workspace");
  assertEqual(dependencyInput?.source_step_id, sourceStepId, "route retains prerequisite source");
  assertEqual(dependencyInput?.target_step_id, targetStepId, "route retains dependent target");
  assertEqual(dependencyInput?.author_type, "agent", "route retains agent author type");
  assertEqual(
    dependencyInput?.author_agent_name,
    "Dependency Agent",
    "route retains agent provenance",
  );

  const invalid = await api(request(`/api/v1/workspaces/${workspaceId}/step-dependencies`, {
    body: JSON.stringify({
      author_type: "agent",
      idempotency_key: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      source_step_id: sourceStepId,
      target_step_id: targetStepId,
    }),
    headers,
    method: "POST",
  }));
  assertEqual(invalid.status, 400, "agent dependency without provenance is rejected");
});

it("rejects ambiguous context scope before contacting the graph service", async () => {
  let called = false;
  const api = handler(graphService({ getContext: async () => {
    called = true;
    return {};
  } }));
  const response = await api(request(`/api/v1/workspaces/${workspaceId}/context`, {
    headers: { Authorization: "Bearer test-token" },
  }));
  const payload = await readJson(response);
  assertEqual(response.status, 400, "missing context scope status");
  assertEqual((payload.error as Record<string, unknown>).code, "VALIDATION_ERROR", "context scope error");
  assertEqual(called, false, "service cannot infer context scope");
});

it("returns only the arrays requested by explicit context scope", async () => {
  const rpcArguments: Record<string, unknown>[] = [];
  const selectable = (data: Record<string, unknown>) => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data, error: null }),
      select: () => query,
    };
    return query;
  };
  const service = new SupabaseGraphService({
    from: (table: string) => selectable(table === "workspaces" ? workspace() : objective()),
    rpc: async (_functionName: string, arguments_: Record<string, unknown>) => {
      rpcArguments.push(arguments_);
      return {
        data: {
          effective_context_items: [{ marker: "general" }, { marker: "specific" }],
          general_context_items: [{ marker: "general" }],
          objective_context_items: [{ marker: "specific" }],
        },
        error: null,
      };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  const workspaceScope = await service.getContext({ scope: "workspace", workspace_id: workspaceId }) as Record<string, unknown>;
  const objectiveScope = await service.getContext({
    objective_id: objectiveId,
    scope: "objective",
    workspace_id: workspaceId,
  }) as Record<string, unknown>;
  const effectiveScope = await service.getContext({
    objective_id: objectiveId,
    scope: "effective",
    workspace_id: workspaceId,
  }) as Record<string, unknown>;

  assertEqual((workspaceScope.objective_context_items as unknown[]).length, 0, "workspace scope omits specific context");
  assertEqual((workspaceScope.effective_context_items as unknown[]).length, 1, "workspace scope returns general context only");
  assertEqual((objectiveScope.general_context_items as unknown[]).length, 0, "objective scope omits general context");
  assertEqual((objectiveScope.effective_context_items as unknown[]).length, 1, "objective scope returns specific context only");
  assertEqual((effectiveScope.effective_context_items as unknown[]).length, 2, "effective scope returns both groups");
  assertEqual(rpcArguments[0]?.p_objective_id, null, "general lookup uses an explicit null objective");
  assertEqual(rpcArguments[1]?.p_objective_id, objectiveId, "objective lookup carries its objective id");
});

it("generates a 384-dimensional query embedding only after workspace authorization", async () => {
  const rpcCalls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  let embedCalls = 0;
  const selectable = (data: Record<string, unknown> | null) => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data, error: null }),
      select: () => query,
    };
    return query;
  };
  const service = new SupabaseGraphService(
    {
      from: () => selectable(workspace()),
      rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
        rpcCalls.push({ arguments_, functionName });
        return { data: [searchStepResult()], error: null };
      },
    } as unknown as AuthenticatedUser["supabase"],
    async () => {
      embedCalls += 1;
      return Array.from({ length: 384 }, (_, index) => index / 384);
    },
  );

  const result = await service.findSteps({
    branch_id: branchId,
    objective_id: objectiveId,
    query: "direct identity",
    status: "active",
    strategy_id: strategyId,
    top_k: 5,
    workspace_id: workspaceId,
  }) as Record<string, unknown>;

  assertEqual(embedCalls, 1, "query embedding call count");
  assertEqual(result.retrieval_mode, "hybrid", "hybrid retrieval mode");
  assertEqual(
    result.embedding_model,
    "gte-small:384:mean-pool-normalized:v1",
    "active embedding model",
  );
  assertEqual(rpcCalls[0]?.functionName, "find_steps", "hybrid search RPC");
  const embedding = rpcCalls[0]?.arguments_.p_query_embedding;
  assert(typeof embedding === "string", "pgvector input is serialized server-side");
  assertEqual(JSON.parse(embedding).length, 384, "query embedding dimensions");
  assertEqual(rpcCalls[0]?.arguments_.p_workspace_id, workspaceId, "mandatory workspace scope");
  assertEqual(rpcCalls[0]?.arguments_.p_objective_id, objectiveId, "optional objective scope");
  assertEqual(rpcCalls[0]?.arguments_.p_strategy_id, strategyId, "optional strategy scope");
  assertEqual(rpcCalls[0]?.arguments_.p_branch_id, branchId, "optional branch scope");
});

it("falls back to lexical retrieval when query embedding fails", async () => {
  const rpcArguments: Record<string, unknown>[] = [];
  const embeddingErrors: unknown[] = [];
  const selectable = () => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data: workspace(), error: null }),
      select: () => query,
    };
    return query;
  };
  const service = new SupabaseGraphService(
    {
      from: () => selectable(),
      rpc: async (_functionName: string, arguments_: Record<string, unknown>) => {
        rpcArguments.push(arguments_);
        return { data: [], error: null };
      },
    } as unknown as AuthenticatedUser["supabase"],
    async () => {
      throw new Error("model unavailable");
    },
    (error) => embeddingErrors.push(error),
  );

  const result = await service.findSteps({
    query: "identity",
    top_k: 10,
    workspace_id: workspaceId,
  }) as Record<string, unknown>;

  assertEqual(result.retrieval_mode, "lexical_fallback", "fallback retrieval mode");
  assertEqual(result.embedding_model, null, "fallback omits the embedding model");
  assertEqual(embeddingErrors.length, 1, "embedding failure is observable");
  assertEqual(
    Object.hasOwn(rpcArguments[0] ?? {}, "p_query_embedding"),
    false,
    "fallback never sends an invalid vector",
  );
});

it("does not call the embedding model for an unauthorized workspace", async () => {
  let embedCalls = 0;
  const selectable = () => {
    const query = {
      eq: () => query,
      maybeSingle: async () => ({ data: null, error: null }),
      select: () => query,
    };
    return query;
  };
  const service = new SupabaseGraphService(
    { from: () => selectable() } as unknown as AuthenticatedUser["supabase"],
    async () => {
      embedCalls += 1;
      return Array(384).fill(0);
    },
  );

  let failure: unknown;
  try {
    await service.findSteps({ query: "identity", top_k: 10, workspace_id: workspaceId });
  } catch (error) {
    failure = error;
  }

  assert(failure instanceof ApiError, "missing workspace must fail before inference");
  assertEqual(failure.code, "NOT_FOUND", "unauthorized workspace is hidden");
  assertEqual(embedCalls, 0, "embedding model cannot see an unauthorized query");
});

it("returns hybrid retrieval metadata and forwards every optional search filter", async () => {
  let forwarded: Record<string, unknown> | undefined;
  const api = handler(graphService({
    findSteps: async (input) => {
      forwarded = input;
      return {
        embedding_model: "gte-small:384:mean-pool-normalized:v1",
        results: [searchStepResult()],
        retrieval_mode: "hybrid",
      };
    },
  }));
  const response = await api(request(
    `/api/v1/workspaces/${workspaceId}/steps/search?query=identity&objective_id=${objectiveId}&strategy_id=${strategyId}&branch_id=${branchId}&status=active&top_k=5`,
    { headers: { Authorization: "Bearer test-token" } },
  ));
  const payload = await readJson(response);
  const data = payload.data as Record<string, unknown>;

  assertEqual(response.status, 200, "search response status");
  assertEqual(data.retrieval_mode, "hybrid", "search response retrieval mode");
  assertEqual(
    data.embedding_model,
    "gte-small:384:mean-pool-normalized:v1",
    "search response model provenance",
  );
  assertEqual((data.results as unknown[]).length, 1, "search result count");
  assertEqual(forwarded?.workspace_id, workspaceId, "route controls workspace scope");
  assertEqual(forwarded?.objective_id, objectiveId, "objective filter forwarding");
  assertEqual(forwarded?.strategy_id, strategyId, "strategy filter forwarding");
  assertEqual(forwarded?.branch_id, branchId, "branch filter forwarding");
  assertEqual(forwarded?.status, "active", "status filter forwarding");
  assertEqual(forwarded?.top_k, 5, "bounded top_k forwarding");
});

it("routes text, link, and verified file context through one receipt-backed RPC", async () => {
  const calls: Array<{ arguments_: Record<string, unknown>; functionName: string }> = [];
  const service = new SupabaseGraphService({
    rpc: async (functionName: string, arguments_: Record<string, unknown>) => {
      calls.push({ arguments_, functionName });
      return { data: contextItem(), error: null };
    },
  } as unknown as AuthenticatedUser["supabase"]);

  await service.createTextContext({
    author_type: "human",
    body_markdown: "Shared definitions.",
    idempotency_key: "context-text-001",
    kind: "text",
    metadata: {},
    scope: "workspace",
    title: "Definitions",
    workspace_id: workspaceId,
  });
  await service.createLinkContext({
    author_type: "human",
    idempotency_key: "context-link-001",
    kind: "link",
    metadata: {},
    objective_id: objectiveId,
    scope: "objective",
    source_url: "https://example.com/lemma",
    title: "Reference",
    workspace_id: workspaceId,
  });
  await service.createFileContext({
    author_type: "human",
    context_id: contextId,
    file_name: "proof.pdf",
    idempotency_key: "context-file-001",
    kind: "pdf",
    metadata: {},
    mime_type: "application/pdf",
    objective_id: objectiveId,
    scope: "objective",
    size_bytes: 42,
    storage_path: `${userId}/${workspaceId}/${contextId}/proof.pdf`,
    title: "Proof file",
    workspace_id: workspaceId,
  });

  assertEqual(calls.length, 3, "each context variant uses one RPC call");
  assert(calls.every((call) => call.functionName === "create_context_item"), "canonical context RPC name");
  assertEqual(calls[0]?.arguments_.p_scope, "workspace", "text scope");
  assertEqual(calls[0]?.arguments_.p_objective_id, null, "workspace context has no objective id");
  assertEqual(calls[1]?.arguments_.p_scope, "objective", "link scope");
  assertEqual(calls[1]?.arguments_.p_objective_id, objectiveId, "link objective id");
  assertEqual(calls[2]?.arguments_.p_context_id, contextId, "file retains validated storage id");
  assertEqual(calls[2]?.arguments_.p_storage_bucket, "workspace-context", "file storage bucket");
});

it("checks the exact caller-visible Storage object before file finalization", async () => {
  let listedBucket: string | undefined;
  let listedFolder: string | undefined;
  let listedSearch: string | undefined;
  const service = new SupabaseGraphService(
    {
      storage: {
        from: (bucket: string) => {
          listedBucket = bucket;
          return {
            list: async (folder: string, options: { search?: string }) => {
              listedFolder = folder;
              listedSearch = options.search;
              return { data: [], error: null };
            },
          };
        },
      },
    } as unknown as AuthenticatedUser["supabase"],
  );
  const storagePath = `${userId}/${workspaceId}/${contextId}/proof.pdf`;

  let failure: unknown;
  try {
    await service.verifyContextFile(storagePath, 42, "application/pdf");
  } catch (error) {
    failure = error;
  }

  assert(failure instanceof ApiError, "missing Storage object must fail with the API error type");
  assertEqual(failure.code, "UPLOAD_FAILED", "missing Storage object error code");
  assertEqual(failure.statusCode, 400, "missing Storage object status");
  assertEqual(listedBucket, "workspace-context", "Storage bucket");
  assertEqual(listedFolder, `${userId}/${workspaceId}/${contextId}`, "exact Storage folder");
  assertEqual(listedSearch, "proof.pdf", "exact Storage file name");
});

it("validates a direct RLS upload before creating file metadata", async () => {
  let checkedPath: string | undefined;
  let created: Parameters<GraphService["createFileContext"]>[0] | undefined;
  const api = handler(
    graphService({
      createFileContext: async (input) => {
        created = input;
        return contextItem();
      },
      getWorkspace: async () => workspace(),
      verifyContextFile: async (path, size, mime) => {
        checkedPath = path;
        assertEqual(size, 42, "declared storage size");
        assertEqual(mime, "application/pdf", "declared storage MIME type");
      },
    }),
  );
  const storagePath = `${userId}/${workspaceId}/${contextId}/unsafe_name.pdf`;
  const response = await api(
    request(`/lemma-api/api/v1/workspaces/${workspaceId}/context/file`, {
      body: JSON.stringify({
        author_type: "human",
        idempotency_key: "file-finalize-key-123",
        kind: "pdf",
        metadata: { original_file_name: "unsafe name.pdf" },
        mime_type: "application/pdf",
        size_bytes: 42,
        storage_bucket: "workspace-context",
        storage_path: storagePath,
        scope: "workspace",
        title: "A direct upload",
        workspace_id: otherWorkspaceId,
      }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );

  assertEqual(response.status, 201, "file finalization status");
  assertEqual(checkedPath, storagePath, "the exact RLS storage object is checked");
  assert(created, "file metadata is created after the storage check");
  assertEqual(created.context_id, contextId, "the validated storage context id is preserved for the RPC");
  assertEqual(created.workspace_id, workspaceId, "route workspace overrides body workspace");
  assertEqual(created.file_name, "unsafe_name.pdf", "safe basename is persisted for path tracking");
  assertEqual(
    created.metadata?.original_file_name,
    "unsafe name.pdf",
    "the browser-provided original filename is retained",
  );
});

it("does not create file metadata when direct storage verification fails", async () => {
  let created = false;
  const api = handler(
    graphService({
      createFileContext: async () => {
        created = true;
        return contextItem();
      },
      getWorkspace: async () => workspace(),
      verifyContextFile: async () => {
        throw new ApiError("UPLOAD_FAILED", "The uploaded file could not be found.", 400);
      },
    }),
  );

  const response = await api(
    request(`/api/v1/workspaces/${workspaceId}/context/file`, {
      body: JSON.stringify({
        author_type: "human",
        idempotency_key: "file-verify-failed-key",
        kind: "pdf",
        metadata: {},
        mime_type: "application/pdf",
        size_bytes: 42,
        storage_bucket: "workspace-context",
        storage_path: `${userId}/${workspaceId}/${contextId}/proof.pdf`,
        scope: "workspace",
        title: "Missing direct upload",
      }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  const payload = await readJson(response);
  assertEqual(response.status, 400, "missing uploaded object status");
  assertEqual((payload.error as Record<string, unknown>).code, "UPLOAD_FAILED", "missing object code");
  assertEqual(created, false, "metadata must not be created for a missing object");
});
