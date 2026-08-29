export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_MODEL = "gte-small:384:mean-pool-normalized:v1";
export const EMBEDDING_WORKER_HEADER = "x-lemma-embedding-worker-token";
// `gte-small` runs inside the Edge isolate's 2-second CPU budget. One job per
// request bounds inference work even while PGMQ safely drives later deliveries.
export const MAX_EMBEDDING_JOBS_PER_RUN = 1;

const CLAIM_VISIBILITY_TIMEOUT_SECONDS = 120;
const INITIAL_RETRY_VISIBILITY_TIMEOUT_SECONDS = 30;
const MAX_RETRY_VISIBILITY_TIMEOUT_SECONDS = 900;

type EnvironmentSource = Record<string, string | undefined>;
type RecordValue = Record<string, unknown>;

export type EmbedStepsEnvironment = {
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_URL: string;
};

export type RpcError = {
  code?: string;
  message?: string;
  name?: string;
};

export type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

/** Minimal caller contract, deliberately independent of the Edge runtime. */
export interface EmbeddingAdminClient {
  rpc(functionName: string, arguments_: RecordValue): Promise<RpcResult>;
}

export type EmbeddingRunOptions = {
  mean_pool: boolean;
  normalize: boolean;
};

/** Supabase AI session interface used by the testable worker handler. */
export interface EmbeddingSession {
  run(input: string, options: EmbeddingRunOptions): Promise<unknown>;
}

export type WorkerDiagnostic = {
  event: "embedding_claim_failed" | "embedding_job_invalid" | "embedding_retry_failed";
  job_id?: number;
};

export type EmbedStepsHandlerOptions = {
  admin: EmbeddingAdminClient;
  environment: EmbedStepsEnvironment;
  logError?: (diagnostic: WorkerDiagnostic) => void;
  session: EmbeddingSession;
};

type ClaimedEmbeddingJob = {
  attempt: number;
  contentHash: string;
  embeddingModel: string;
  messageId: number;
  searchText: string;
  stepId: string;
  workspaceId: string;
};

type EmbeddingRunSummary = {
  claimed: number;
  completed: number;
  invalid: number;
  retried: number;
  retry_failed: number;
  stale: number;
};

class JobProcessingError extends Error {
  public constructor(public readonly reason: string) {
    super(reason);
    this.name = "JobProcessingError";
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function recordValue(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString().replace(/\/$/u, "");
  } catch {
    throw new Error("SUPABASE_URL must be an absolute URL.");
  }
}

function requiredEnvironmentValue(source: EnvironmentSource, key: keyof EmbedStepsEnvironment): string {
  const value = source[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

export function loadEmbedStepsEnvironment(source: EnvironmentSource): EmbedStepsEnvironment {
  return {
    SUPABASE_SERVICE_ROLE_KEY: requiredEnvironmentValue(source, "SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_URL: normalizeUrl(requiredEnvironmentValue(source, "SUPABASE_URL")),
  };
}

function jsonResponse(status: number, payload: unknown, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { headers, status });
}

function errorResponse(status: number, code: string, message: string, headers?: HeadersInit): Response {
  return jsonResponse(status, { error: { code, message }, ok: false }, headers);
}

function parseClaimedJob(value: unknown): ClaimedEmbeddingJob | undefined {
  const row = recordValue(value);
  if (!row) {
    return undefined;
  }

  const attempt = positiveInteger(row.attempt);
  const contentHash = nonEmptyString(row.content_hash);
  const embeddingModel = nonEmptyString(row.embedding_model);
  const messageId = positiveInteger(row.message_id);
  const searchText = nonEmptyString(row.search_text);
  const stepId = nonEmptyString(row.step_id);
  const workspaceId = nonEmptyString(row.workspace_id);

  if (
    attempt === undefined ||
    !contentHash ||
    !embeddingModel ||
    messageId === undefined ||
    !searchText ||
    !stepId ||
    !workspaceId
  ) {
    return undefined;
  }

  return {
    attempt,
    contentHash,
    embeddingModel,
    messageId,
    searchText,
    stepId,
    workspaceId,
  };
}

function typedArrayValues(value: unknown): unknown[] | undefined {
  if (!ArrayBuffer.isView(value)) {
    return undefined;
  }

  const candidate = value as unknown as { [index: number]: unknown; length?: unknown };
  if (typeof candidate.length !== "number" || !Number.isSafeInteger(candidate.length)) {
    return undefined;
  }

  return Array.from({ length: candidate.length }, (_, index) => candidate[index]);
}

function finiteVector(value: unknown): number[] | undefined {
  const rawValues = Array.isArray(value) ? value : typedArrayValues(value);

  if (!rawValues || rawValues.length !== EMBEDDING_DIMENSIONS) {
    return undefined;
  }

  const vector: number[] = [];
  for (const valueAtIndex of rawValues) {
    if (typeof valueAtIndex !== "number" || !Number.isFinite(valueAtIndex)) {
      return undefined;
    }
    vector.push(valueAtIndex);
  }
  return vector;
}

function embeddingLiteral(vector: number[]): string {
  return JSON.stringify(vector);
}

export function retryVisibilityTimeoutSeconds(attempt: number): number {
  const exponent = Math.max(attempt - 1, 0);
  return Math.min(
    INITIAL_RETRY_VISIBILITY_TIMEOUT_SECONDS * 2 ** exponent,
    MAX_RETRY_VISIBILITY_TIMEOUT_SECONDS,
  );
}

function completionOutcome(value: unknown): "completed" | "retry" | "stale" {
  if (value === true) {
    return "completed";
  }
  if (value === false) {
    return "stale";
  }

  const result = recordValue(value);
  if (!result) {
    return "retry";
  }

  const status = typeof result.status === "string" ? result.status.toLowerCase() : "";
  if (["completed", "complete", "already_completed", "succeeded", "success"].includes(status)) {
    return "completed";
  }
  if (["stale", "superseded", "content_changed", "already_replaced"].includes(status)) {
    return "stale";
  }
  if (["failed", "error", "retry", "rejected"].includes(status)) {
    return "retry";
  }

  if (result.completed === true) {
    return "completed";
  }
  if (result.stale === true || result.completed === false) {
    return "stale";
  }

  // A successful RPC transport is not proof that the completion was applied.
  // Retrying is safe because the completion RPC performs the stale/hash check.
  return "retry";
}

async function callRpc(
  client: EmbeddingAdminClient,
  functionName: string,
  arguments_: RecordValue,
): Promise<unknown> {
  const result = await client.rpc(functionName, arguments_);
  if (result.error) {
    throw new JobProcessingError(`${functionName}_failed`);
  }
  return result.data;
}

async function retryJob(
  client: EmbeddingAdminClient,
  job: ClaimedEmbeddingJob,
  reason: string,
  workerToken: string,
): Promise<void> {
  await callRpc(client, "retry_step_embedding_job", {
    p_attempt: job.attempt,
    p_error: reason,
    p_message_id: job.messageId,
    p_visibility_timeout_seconds: retryVisibilityTimeoutSeconds(job.attempt),
    p_worker_token: workerToken,
  });
}

async function processJob(
  client: EmbeddingAdminClient,
  session: EmbeddingSession,
  job: ClaimedEmbeddingJob,
  workerToken: string,
): Promise<"completed" | "stale"> {
  if (job.embeddingModel !== EMBEDDING_MODEL) {
    throw new JobProcessingError("unsupported_embedding_model");
  }

  const output = await session.run(job.searchText, {
    mean_pool: true,
    normalize: true,
  });
  const vector = finiteVector(output);
  if (!vector) {
    throw new JobProcessingError("invalid_embedding_vector");
  }

  const completion = await callRpc(client, "complete_step_embedding_job", {
    p_content_hash: job.contentHash,
    p_embedding: embeddingLiteral(vector),
    p_embedding_model: job.embeddingModel,
    p_message_id: job.messageId,
    p_step_id: job.stepId,
    p_worker_token: workerToken,
  });
  const outcome = completionOutcome(completion);
  if (outcome === "retry") {
    throw new JobProcessingError("embedding_completion_rejected");
  }
  return outcome;
}

async function runEmbeddingJobs(
  options: EmbedStepsHandlerOptions,
  workerToken: string,
): Promise<EmbeddingRunSummary> {
  const summary: EmbeddingRunSummary = {
    claimed: 0,
    completed: 0,
    invalid: 0,
    retried: 0,
    retry_failed: 0,
    stale: 0,
  };

  let claimResult: unknown;
  try {
    claimResult = await callRpc(options.admin, "claim_step_embedding_jobs", {
      p_max_jobs: MAX_EMBEDDING_JOBS_PER_RUN,
      p_visibility_timeout_seconds: CLAIM_VISIBILITY_TIMEOUT_SECONDS,
      p_worker_token: workerToken,
    });
  } catch {
    options.logError?.({ event: "embedding_claim_failed" });
    throw new JobProcessingError("embedding_claim_failed");
  }

  if (claimResult === null) {
    return summary;
  }
  if (!Array.isArray(claimResult)) {
    options.logError?.({ event: "embedding_claim_failed" });
    throw new JobProcessingError("embedding_claim_failed");
  }

  summary.claimed = claimResult.length;
  for (const rawJob of claimResult) {
    const job = parseClaimedJob(rawJob);
    if (!job) {
      summary.invalid += 1;
      options.logError?.({ event: "embedding_job_invalid" });
      continue;
    }

    try {
      const outcome = await processJob(options.admin, options.session, job, workerToken);
      if (outcome === "stale") {
        summary.stale += 1;
      } else {
        summary.completed += 1;
      }
    } catch (error) {
      const reason = error instanceof JobProcessingError ? error.reason : "embedding_generation_failed";
      try {
        await retryJob(options.admin, job, reason, workerToken);
        summary.retried += 1;
      } catch {
        summary.retry_failed += 1;
        options.logError?.({ event: "embedding_retry_failed", job_id: job.messageId });
      }
    }
  }

  return summary;
}

/**
 * Creates a POST-only internal worker handler. Runtime-only dependencies are
 * injected so Vitest can exercise the behavior without Supabase.ai or Deno.
 */
export function createEmbedStepsHandler(
  options: EmbedStepsHandlerOptions,
): (request: Request) => Promise<Response> {
  const environment = loadEmbedStepsEnvironment(options.environment);
  const normalizedOptions: EmbedStepsHandlerOptions = { ...options, environment };

  return async (request) => {
    if (request.method !== "POST") {
      return errorResponse(405, "METHOD_NOT_ALLOWED", "Only POST is supported.", { Allow: "POST" });
    }

    const workerToken = request.headers.get(EMBEDDING_WORKER_HEADER);
    if (!workerToken || workerToken.trim().length === 0) {
      return errorResponse(401, "UNAUTHORIZED", "The embedding worker token is invalid.");
    }

    try {
      const summary = await runEmbeddingJobs(normalizedOptions, workerToken);
      return jsonResponse(200, { data: summary, ok: true });
    } catch {
      return errorResponse(502, "EMBEDDING_CLAIM_FAILED", "Embedding jobs could not be claimed.");
    }
  };
}
