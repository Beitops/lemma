import { describe, expect, it } from "vitest";

import {
  createEmbedStepsHandler,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  EMBEDDING_WORKER_HEADER,
  retryVisibilityTimeoutSeconds,
  type EmbeddingAdminClient,
  type EmbeddingRunOptions,
  type EmbeddingSession,
  type RpcResult,
} from "./handler.ts";

const WORKER_TOKEN = "test-embedding-worker-token";

type RpcCall = {
  arguments_: Record<string, unknown>;
  functionName: string;
};

function environment() {
  return {
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key",
    SUPABASE_URL: "https://example.supabase.co",
  };
}

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attempt: 1,
    content_hash: "content-hash-1",
    embedding_model: EMBEDDING_MODEL,
    message_id: 101,
    search_text: "Use Cauchy-Schwarz after completing the square.",
    step_id: "77777777-7777-4777-8777-777777777777",
    workspace_id: "88888888-8888-4888-8888-888888888888",
    ...overrides,
  };
}

function vector(value = 0.125): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => value);
}

function request(method = "POST", workerToken = WORKER_TOKEN): Request {
  return new Request("https://worker.example/embed-steps", {
    headers: workerToken ? { [EMBEDDING_WORKER_HEADER]: workerToken } : {},
    method,
  });
}

function client(
  responder: (functionName: string, arguments_: Record<string, unknown>) => Promise<RpcResult>,
): { calls: RpcCall[]; client: EmbeddingAdminClient } {
  const calls: RpcCall[] = [];
  return {
    calls,
    client: {
      rpc: async (functionName, arguments_) => {
        calls.push({ arguments_, functionName });
        return responder(functionName, arguments_);
      },
    },
  };
}

function session(
  responder: (input: string, options: EmbeddingRunOptions) => Promise<unknown>,
): { calls: Array<{ input: string; options: EmbeddingRunOptions }>; session: EmbeddingSession } {
  const calls: Array<{ input: string; options: EmbeddingRunOptions }> = [];
  return {
    calls,
    session: {
      run: async (input, options) => {
        calls.push({ input, options });
        return responder(input, options);
      },
    },
  };
}

async function responseData(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json();
  return payload as Record<string, unknown>;
}

describe("embed-steps worker", () => {
  it("only accepts a POST request with the worker header", async () => {
    const admin = client(async () => ({ data: [], error: null }));
    const model = session(async () => vector());
    const handler = createEmbedStepsHandler({
      admin: admin.client,
      environment: environment(),
      session: model.session,
    });

    const methodResponse = await handler(request("GET"));
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("Allow")).toBe("POST");

    const authResponse = await handler(request("POST", ""));
    expect(authResponse.status).toBe(401);
    const blankAuthResponse = await handler(request("POST", " "));
    expect(blankAuthResponse.status).toBe(401);
    expect(admin.calls).toEqual([]);
  });

  it("claims, embeds, and completes one valid job", async () => {
    const claimedJob = job();
    const admin = client(async (functionName) => {
      if (functionName === "claim_step_embedding_jobs") {
        return { data: [claimedJob], error: null };
      }
      if (functionName === "complete_step_embedding_job") {
        return { data: { completed: true }, error: null };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    });
    const model = session(async () => vector());
    const handler = createEmbedStepsHandler({
      admin: admin.client,
      environment: environment(),
      session: model.session,
    });

    const response = await handler(request());
    const payload = await responseData(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      data: { claimed: 1, completed: 1, retried: 0, stale: 0 },
      ok: true,
    });
    expect(model.calls).toEqual([
      {
        input: claimedJob.search_text,
        options: { mean_pool: true, normalize: true },
      },
    ]);
    expect(admin.calls[0]).toEqual({
      arguments_: {
        p_max_jobs: 1,
        p_visibility_timeout_seconds: 120,
        p_worker_token: WORKER_TOKEN,
      },
      functionName: "claim_step_embedding_jobs",
    });
    const completion = admin.calls[1];
    expect(completion?.functionName).toBe("complete_step_embedding_job");
    expect(completion?.arguments_).toMatchObject({
      p_content_hash: claimedJob.content_hash,
      p_embedding_model: EMBEDDING_MODEL,
      p_message_id: 101,
      p_step_id: claimedJob.step_id,
      p_worker_token: WORKER_TOKEN,
    });
    const serializedVector = completion?.arguments_.p_embedding;
    expect(typeof serializedVector).toBe("string");
    expect(JSON.parse(serializedVector as string)).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it("retries an invalid model vector instead of completing the job", async () => {
    const admin = client(async (functionName) => {
      if (functionName === "claim_step_embedding_jobs") {
        return { data: [job()], error: null };
      }
      if (functionName === "retry_step_embedding_job") {
        return { data: { status: "retry_scheduled" }, error: null };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    });
    const model = session(async () => vector().slice(1));
    const handler = createEmbedStepsHandler({
      admin: admin.client,
      environment: environment(),
      session: model.session,
    });

    const response = await handler(request());
    const payload = await responseData(response);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ data: { claimed: 1, completed: 0, retried: 1 }, ok: true });
    expect(admin.calls.map((call) => call.functionName)).toEqual([
      "claim_step_embedding_jobs",
      "retry_step_embedding_job",
    ]);
    expect(admin.calls[1]?.arguments_).toEqual({
      p_attempt: 1,
      p_error: "invalid_embedding_vector",
      p_message_id: 101,
      p_visibility_timeout_seconds: 30,
      p_worker_token: WORKER_TOKEN,
    });
  });

  it("retries an embedding generation failure", async () => {
    const admin = client(async (functionName) => {
      if (functionName === "claim_step_embedding_jobs") {
        return { data: [job()], error: null };
      }
      if (functionName === "retry_step_embedding_job") {
        return { data: { status: "retry_scheduled" }, error: null };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    });
    const model = session(async () => {
      throw new Error("Embedding runtime unavailable");
    });
    const handler = createEmbedStepsHandler({
      admin: admin.client,
      environment: environment(),
      session: model.session,
    });

    const response = await handler(request());

    expect(response.status).toBe(200);
    expect(admin.calls.map((call) => call.functionName)).toEqual([
      "claim_step_embedding_jobs",
      "retry_step_embedding_job",
    ]);
    expect(admin.calls[1]?.arguments_).toMatchObject({
      p_error: "embedding_generation_failed",
      p_visibility_timeout_seconds: 30,
      p_worker_token: WORKER_TOKEN,
    });
  });

  it("uses bounded exponential backoff for retries", () => {
    expect(retryVisibilityTimeoutSeconds(1)).toBe(30);
    expect(retryVisibilityTimeoutSeconds(2)).toBe(60);
    expect(retryVisibilityTimeoutSeconds(5)).toBe(480);
    expect(retryVisibilityTimeoutSeconds(6)).toBe(900);
    expect(retryVisibilityTimeoutSeconds(20)).toBe(900);
  });

  it("continues processing a later delivery after a job is retried", async () => {
    const badJob = job({ message_id: 201, search_text: "Invalid first step." });
    const goodJob = job({ message_id: 202, search_text: "Valid second step." });
    let claimedBatches = 0;
    const admin = client(async (functionName) => {
      if (functionName === "claim_step_embedding_jobs") {
        claimedBatches += 1;
        return { data: claimedBatches === 1 ? [badJob] : [goodJob], error: null };
      }
      if (functionName === "complete_step_embedding_job") {
        return { data: { status: "completed" }, error: null };
      }
      if (functionName === "retry_step_embedding_job") {
        return { data: { status: "retry_scheduled" }, error: null };
      }
      return { data: null, error: { message: "Unexpected RPC" } };
    });
    let runs = 0;
    const model = session(async () => {
      runs += 1;
      return runs === 1 ? [Number.NaN, ...vector().slice(1)] : vector();
    });
    const handler = createEmbedStepsHandler({
      admin: admin.client,
      environment: environment(),
      session: model.session,
    });

    const firstResponse = await handler(request());
    const secondResponse = await handler(request());
    const firstPayload = await responseData(firstResponse);
    const secondPayload = await responseData(secondResponse);

    expect(firstResponse.status).toBe(200);
    expect(firstPayload).toMatchObject({ data: { claimed: 1, completed: 0, retried: 1 }, ok: true });
    expect(secondResponse.status).toBe(200);
    expect(secondPayload).toMatchObject({ data: { claimed: 1, completed: 1, retried: 0 }, ok: true });
    expect(model.calls).toHaveLength(2);
    expect(admin.calls.map((call) => call.functionName)).toEqual([
      "claim_step_embedding_jobs",
      "retry_step_embedding_job",
      "claim_step_embedding_jobs",
      "complete_step_embedding_job",
    ]);
  });
});
