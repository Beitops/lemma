import {
  createClient,
  isAuthError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import {
  apiErrorEnvelopeSchema,
  branchComparisonSchema,
  branchFromStepInputSchema,
  branchFromStepResultSchema,
  branchPathSchema,
  cleanSolutionSchema,
  compareBranchesInputSchema,
  createContextItemResultSchema,
  createContextLinkInputSchema,
  createContextTextInputSchema,
  createContextUploadInputSchema,
  createObjectiveInputSchema,
  createObjectiveResultSchema,
  createStepDependencyInputSchema,
  createStepDependencyResultSchema,
  createStepInputSchema,
  createStepResultSchema,
  createStrategyInputSchema,
  createStrategyResultSchema,
  createWorkspaceInputSchema,
  createWorkspaceResultSchema,
  findStepsInputSchema,
  findStepsResultSchema,
  getContextInputSchema,
  getContextResultSchema,
  getObjectiveInputSchema,
  getWorkspaceInputSchema,
  listObjectivesInputSchema,
  listObjectivesResultSchema,
  listStrategiesInputSchema,
  listStrategiesResultSchema,
  markAssumptionInputSchema,
  markAssumptionResultSchema,
  markDeadEndInputSchema,
  markEndInputSchema,
  markEndResultSchema,
  objectiveSchema,
  pendingDecisionsResultSchema,
  requestHumanDecisionInputSchema,
  requestHumanDecisionResultSchema,
  resolveHumanDecisionInputSchema,
  resolveHumanDecisionResultSchema,
  saveCleanSolutionInputSchema,
  saveCleanSolutionResultSchema,
  setReasoningResultInputSchema,
  setReasoningResultResultSchema,
  signedContextDownloadResultSchema,
  updateObjectiveInputSchema,
  updateObjectiveResultSchema,
  updateStepInputSchema,
  updateStepResultSchema,
  updateWorkspaceInputSchema,
  updateWorkspaceResultSchema,
  uuidSchema,
  objectiveGraphSchema,
  workspaceListResultSchema,
  workspaceOverviewSchema,
  type ApiErrorPayload,
  type CreateContextUploadInput,
} from "@lemma/contracts";

const API_PREFIX = "/api/v1";
export const ACTIVE_STEP_EMBEDDING_MODEL = "gte-small:384:mean-pool-normalized:v1";
const STEP_EMBEDDING_DIMENSIONS = 384;
const DEFAULT_WEB_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
const MAX_CONTEXT_FILE_BYTES = 50 * 1024 * 1024;
const SIGNED_URL_SECONDS = 300;
const STORAGE_BUCKET = "workspace-context";
const JWT_LIKE_VALUE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu;
const SUPPORTED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type RecordInput = Record<string, unknown>;

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "AUTHENTICATION_UNAVAILABLE"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "CONFLICT"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "UPLOAD_FAILED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly details: unknown;

  public constructor(
    code: ApiErrorCode,
    message: string,
    statusCode: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type ErrorLike = {
  code?: unknown;
  details?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

type RuntimeSchema<T> = {
  parse(value: unknown): T;
  safeParse(value: unknown):
    | { data: T; success: true }
    | { error: { issues?: ValidationIssue[] }; success: false };
};

type ValidationIssue = {
  message?: unknown;
  path?: unknown;
};

export type LemmaApiEnvironment = {
  AUTH_ISSUER: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_URL: string;
  WEB_ORIGIN: string[];
};

type EnvironmentSource = Record<string, string | undefined>;

export type AuthenticatedUser = {
  accessToken: string;
  id: string;
  supabase: SupabaseClient;
};

export type TextEmbeddingProvider = (input: string) => Promise<unknown>;

export type ActorFields = {
  author_agent_name?: string;
  author_type?: "agent" | "human";
};

export type CreateFileContextInput = ActorFields & {
  body_markdown?: string;
  context_id: string;
  file_name: string;
  idempotency_key: string;
  kind: "image" | "pdf";
  metadata?: Record<string, unknown>;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  title: string;
  workspace_id: string;
  objective_id?: string;
  scope: "workspace" | "objective";
};

export interface GraphService {
  branchFromStep(input: RecordInput): Promise<unknown>;
  compareBranches(input: RecordInput): Promise<unknown>;
  createFileContext(input: CreateFileContextInput): Promise<unknown>;
  createLinkContext(input: RecordInput): Promise<unknown>;
  createObjective(input: RecordInput): Promise<unknown>;
  createStep(input: RecordInput): Promise<unknown>;
  createStepDependency(input: RecordInput): Promise<unknown>;
  createStrategy(input: RecordInput): Promise<unknown>;
  createTextContext(input: RecordInput): Promise<unknown>;
  createWorkspace(input: RecordInput): Promise<unknown>;
  findSteps(input: RecordInput): Promise<unknown>;
  generateCleanSolution(branchId: string): Promise<unknown>;
  getBranchPath(branchId: string): Promise<unknown>;
  getContext(input: RecordInput): Promise<unknown>;
  getDownloadUrl(workspaceId: string, contextId: string): Promise<unknown>;
  getObjective(workspaceId: string, objectiveId: string): Promise<unknown>;
  getObjectiveGraph(workspaceId: string, objectiveId: string): Promise<unknown>;
  getWorkspace(workspaceId: string): Promise<unknown>;
  getWorkspaceOverview(workspaceId: string): Promise<unknown>;
  listObjectives(workspaceId: string): Promise<unknown>;
  listPendingDecisions(workspaceId: string): Promise<unknown>;
  listStrategies(workspaceId: string, objectiveId: string): Promise<unknown>;
  listWorkspaces(): Promise<unknown>;
  markAssumption(input: RecordInput): Promise<unknown>;
  markDeadEnd(input: RecordInput): Promise<unknown>;
  markEnd(input: RecordInput): Promise<unknown>;
  requestHumanDecision(input: RecordInput): Promise<unknown>;
  resolveHumanDecision(input: RecordInput): Promise<unknown>;
  saveCleanSolution(input: RecordInput): Promise<unknown>;
  setReasoningResult(input: RecordInput): Promise<unknown>;
  updateStep(input: RecordInput): Promise<unknown>;
  updateObjective(input: RecordInput): Promise<unknown>;
  updateWorkspace(input: RecordInput): Promise<unknown>;
  verifyContextFile(path: string, sizeBytes: number, mimeType: string): Promise<void>;
}

type Authenticator = (accessToken: string) => Promise<AuthenticatedUser>;
type GraphServiceFactory = (user: AuthenticatedUser) => GraphService;

export type LemmaApiHandlerOptions = {
  authenticate?: Authenticator;
  createClient?: typeof createClient;
  createGraphService?: GraphServiceFactory;
  embedText?: TextEmbeddingProvider;
  environment: LemmaApiEnvironment;
  logError?: (diagnostic: Record<string, unknown>) => void;
};

type AuthenticatedScope = {
  service: GraphService;
  user: AuthenticatedUser;
};

type VerifiedClaims = {
  aud: unknown;
  iss: unknown;
  role: unknown;
  sub: unknown;
};

const AUTH_CLIENT_OPTIONS = {
  autoRefreshToken: false,
  detectSessionInUrl: false,
  persistSession: false,
} as const;

function hasErrorShape(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

function contains(value: unknown, fragment: string): boolean {
  return typeof value === "string" && value.includes(fragment);
}

export function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (!hasErrorShape(error)) {
    return new ApiError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
  }

  const databaseCode = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message : "";

  if (
    contains(message, "LEMMA_REVISION_CONFLICT") ||
    contains(message, "LEMMA_REVISION_CONFLICT_OR_DECISION_CLOSED") ||
    databaseCode === "40001"
  ) {
    return new ApiError(
      "REVISION_CONFLICT",
      "This item changed before your update could be applied. Refresh and try again.",
      409,
    );
  }

  if (contains(message, "LEMMA_IDEMPOTENCY_KEY_REUSED") || databaseCode === "23505") {
    return new ApiError(
      "IDEMPOTENCY_CONFLICT",
      "This idempotency key was already used for a different operation.",
      409,
    );
  }

  if (contains(message, "LEMMA_MUTATION_INCOMPLETE")) {
    return new ApiError(
      "CONFLICT",
      "This mutation is still being processed. Retry with the same idempotency key.",
      409,
    );
  }

  if (
    contains(message, "LEMMA_WORKSPACE_NOT_FOUND") ||
    contains(message, "WORKSPACE_NOT_FOUND")
  ) {
    return new ApiError("NOT_FOUND", "Workspace not found.", 404);
  }

  if (
    contains(message, "LEMMA_OBJECTIVE_NOT_FOUND") ||
    contains(message, "LEMMA_STEP_NOT_FOUND") ||
    contains(message, "LEMMA_BRANCH_NOT_FOUND") ||
    contains(message, "LEMMA_DECISION_NOT_FOUND") ||
    databaseCode === "P0002" ||
    databaseCode === "PGRST116"
  ) {
    return new ApiError("NOT_FOUND", "Resource not found.", 404);
  }

  if (
    databaseCode === "42501" ||
    contains(message, "row-level security") ||
    contains(message, "new row violates row-level security")
  ) {
    return new ApiError(
      "FORBIDDEN",
      "You do not have access to this resource.",
      403,
    );
  }

  if (
    contains(message, "Payload too large") ||
    contains(message, "File size exceeds") ||
    databaseCode === "FST_REQ_FILE_TOO_LARGE"
  ) {
    return new ApiError(
      "PAYLOAD_TOO_LARGE",
      "Files must be 50 MB or smaller.",
      413,
    );
  }

  if (databaseCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return new ApiError(
      "UNSUPPORTED_MEDIA_TYPE",
      "This endpoint requires the expected content type.",
      415,
    );
  }

  if (
    contains(message, "Storage") ||
    contains(message, "storage") ||
    contains(message, "upload")
  ) {
    return new ApiError(
      "UPLOAD_FAILED",
      "The file could not be uploaded. Please try again.",
      502,
    );
  }

  if (databaseCode === "22023" || databaseCode === "23514") {
    return new ApiError("VALIDATION_ERROR", "The request is not valid for this resource.", 400);
  }

  return new ApiError("INTERNAL_ERROR", "An unexpected error occurred.", 500);
}

export function validationError(details?: unknown): ApiError {
  return new ApiError("VALIDATION_ERROR", "The request body is invalid.", 400, details);
}

function authenticationUnavailable(): ApiError {
  return new ApiError(
    "AUTHENTICATION_UNAVAILABLE",
    "Authentication is temporarily unavailable. Please try again.",
    503,
    { retry_after_seconds: 1 },
  );
}

function notFound(resource: string): ApiError {
  return new ApiError("NOT_FOUND", `${resource} not found.`, 404);
}

function invalidAccessToken(): ApiError {
  return new ApiError("UNAUTHORIZED", "The access token is invalid or has expired.", 401);
}

function hasAuthenticatedAudience(value: unknown): boolean {
  return value === "authenticated" || (Array.isArray(value) && value.includes("authenticated"));
}

function hasExpectedClaims(claims: unknown, expectedIssuer: string): claims is VerifiedClaims & { sub: string } {
  if (typeof claims !== "object" || claims === null) {
    return false;
  }

  const candidate = claims as Record<string, unknown>;
  return (
    typeof candidate.sub === "string" &&
    candidate.sub.length > 0 &&
    candidate.iss === expectedIssuer &&
    hasAuthenticatedAudience(candidate.aud) &&
    candidate.role === "authenticated"
  );
}

function isInvalidTokenVerificationFailure(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.message === "Invalid alg claim");
}

export function createSupabaseAuthenticator(
  environment: LemmaApiEnvironment,
  clientFactory: typeof createClient = createClient,
): Authenticator {
  const verifier = clientFactory(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: AUTH_CLIENT_OPTIONS,
  });
  const expectedIssuer = environment.AUTH_ISSUER;

  return async (accessToken) => {
    let result: Awaited<ReturnType<typeof verifier.auth.getClaims>>;
    try {
      result = await verifier.auth.getClaims(accessToken);
    } catch (error) {
      if (isAuthRetryableFetchError(error)) {
        throw authenticationUnavailable();
      }

      if (isAuthError(error) || isInvalidTokenVerificationFailure(error)) {
        throw invalidAccessToken();
      }

      throw authenticationUnavailable();
    }

    if (isAuthRetryableFetchError(result.error)) {
      throw authenticationUnavailable();
    }

    if (result.error || !hasExpectedClaims(result.data?.claims, expectedIssuer)) {
      throw invalidAccessToken();
    }

    return {
      accessToken,
      id: result.data.claims.sub,
      supabase: clientFactory(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
        accessToken: () => Promise.resolve(accessToken),
        auth: AUTH_CLIENT_OPTIONS,
      }),
    };
  };
}

function recordValue(value: unknown, message: string): RecordInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError("INTERNAL_ERROR", message, 500);
  }
  return value as RecordInput;
}

function stringValue(input: RecordInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}

function requiredString(input: RecordInput, key: string): string {
  const value = stringValue(input, key);
  if (!value) {
    throw new ApiError("VALIDATION_ERROR", `Missing required field: ${key}.`, 400);
  }
  return value;
}

function numberValue(input: RecordInput, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredNumber(input: RecordInput, key: string): number {
  const value = numberValue(input, key);
  if (value === undefined) {
    throw new ApiError("VALIDATION_ERROR", `Missing required field: ${key}.`, 400);
  }
  return value;
}

function requiredNullableNumber(input: RecordInput, key: string): number | null {
  if (input[key] === null) {
    return null;
  }
  return requiredNumber(input, key);
}

function stringArray(input: RecordInput, key: string): string[] | undefined {
  const value = input[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value;
}

function optional<T>(value: T | undefined): T | undefined {
  return value;
}

function actorArguments(input: RecordInput): {
  p_author_agent_name?: string;
  p_author_type: "agent" | "human";
} {
  const authorType = input.author_type === "agent" ? "agent" : "human";
  const authorAgentName = stringValue(input, "author_agent_name");

  if (authorType === "agent") {
    if (!authorAgentName) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Agent-authored changes must include an author agent name.",
        400,
      );
    }
    return { p_author_type: authorType, p_author_agent_name: authorAgentName };
  }

  return { p_author_type: authorType };
}

function contextActor(input: {
  author_agent_name?: string | undefined;
  author_type?: "agent" | "human" | undefined;
}): {
  author_agent_name?: string;
  author_type: "agent" | "human";
} {
  if (input.author_type === "agent") {
    if (!input.author_agent_name) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Agent-authored changes must include an author agent name.",
        400,
      );
    }
    return {
      author_agent_name: input.author_agent_name,
      author_type: "agent",
    };
  }

  return { author_type: "human" };
}

function responseOrThrow<T>(result: { data: T; error: unknown }): T {
  if (result.error) {
    throw asApiError(result.error);
  }
  return result.data;
}

function embeddingVectorLiteral(value: unknown): string {
  if (!Array.isArray(value) || value.length !== STEP_EMBEDDING_DIMENSIONS) {
    throw new Error(`The embedding model must return exactly ${STEP_EMBEDDING_DIMENSIONS} dimensions.`);
  }

  const vector = value.map((component) => {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      throw new Error("The embedding model returned a non-finite component.");
    }
    return component;
  });

  return `[${vector.join(",")}]`;
}

/**
 * Data access remains caller-scoped: this client holds a verified user token,
 * so Postgres and Storage RLS are still the authorization boundary.
 */
export class SupabaseGraphService implements GraphService {
  public constructor(
    private readonly supabase: SupabaseClient,
    private readonly embedText?: TextEmbeddingProvider,
    private readonly reportEmbeddingError?: (error: unknown) => void,
  ) {}

  public async listWorkspaces(): Promise<unknown> {
    const raw = recordValue(
      await this.rpc("list_workspace_summaries", {}),
      "The database returned an invalid workspace summary response.",
    );
    const rows = raw.workspaces;
    if (!Array.isArray(rows)) {
      throw new ApiError("INTERNAL_ERROR", "The database returned invalid workspace summaries.", 500);
    }

    return rows.map((value) => {
      const row = recordValue(value, "The database returned an invalid workspace summary.");
      const objectiveCount = requiredNumber(row, "objective_count");
      const activeObjectiveCount = requiredNumber(row, "active_objective_count");
      const workspace = Object.fromEntries(
        Object.entries(row).filter(
          ([key]) => key !== "active_objective_count" && key !== "objective_count",
        ),
      );
      return {
        active_objective_count: activeObjectiveCount,
        objective_count: objectiveCount,
        workspace,
      };
    });
  }

  public getWorkspace(workspaceId: string): Promise<unknown> {
    return this.workspaceRow(workspaceId);
  }

  public async createWorkspace(input: RecordInput): Promise<unknown> {
    return this.rpc("create_workspace", {
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_title: requiredString(input, "title"),
      ...actorArguments(input),
    });
  }

  public updateWorkspace(input: RecordInput): Promise<unknown> {
    return this.rpc("update_workspace", {
      p_expected_revision: requiredNumber(input, "expected_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_status: optional(stringValue(input, "status")),
      p_title: optional(stringValue(input, "title")),
      p_workspace_id: requiredString(input, "workspace_id"),
      ...actorArguments(input),
    });
  }

  public async createObjective(input: RecordInput): Promise<unknown> {
    const workspaceId = requiredString(input, "workspace_id");
    await this.workspaceRow(workspaceId);
    return this.rpc("create_objective", {
      p_constraints_markdown: optional(stringValue(input, "constraints_markdown")),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_objective_markdown: requiredString(input, "objective_markdown"),
      p_title: requiredString(input, "title"),
      p_workspace_id: workspaceId,
      ...actorArguments(input),
    });
  }

  public async updateObjective(input: RecordInput): Promise<unknown> {
    const workspaceId = requiredString(input, "workspace_id");
    const objectiveId = requiredString(input, "objective_id");
    await this.objectiveRow(objectiveId, workspaceId);
    return this.rpc("update_objective", {
      p_constraints_markdown: optional(stringValue(input, "constraints_markdown")),
      p_expected_revision: requiredNumber(input, "expected_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_objective_id: objectiveId,
      p_objective_markdown: optional(stringValue(input, "objective_markdown")),
      p_status: optional(stringValue(input, "status")),
      p_title: optional(stringValue(input, "title")),
      p_workspace_id: workspaceId,
      ...actorArguments(input),
    });
  }

  public async getContext(input: RecordInput): Promise<unknown> {
    const workspaceId = requiredString(input, "workspace_id");
    const objectiveId = stringValue(input, "objective_id");
    const scope = requiredString(input, "scope");
    await this.workspaceRow(workspaceId);
    if (objectiveId) await this.objectiveRow(objectiveId, workspaceId);
    const response = recordValue(await this.rpc("get_context", {
      p_objective_id: objectiveId ?? null,
      p_workspace_id: workspaceId,
    }), "The database returned invalid context.");
    const general = this.contextArray(response, "general_context_items");
    const specific = this.contextArray(response, "objective_context_items");
    const effective = this.contextArray(response, "effective_context_items");

    if (scope === "workspace") {
      return {
        effective_context_items: general,
        general_context_items: general,
        objective_context_items: [],
        objective_id: null,
        workspace_id: workspaceId,
      };
    }

    if (scope === "objective") {
      return {
        effective_context_items: specific,
        general_context_items: [],
        objective_context_items: specific,
        objective_id: objectiveId ?? null,
        workspace_id: workspaceId,
      };
    }

    if (scope === "effective") {
      return {
        effective_context_items: effective,
        general_context_items: general,
        objective_context_items: specific,
        objective_id: objectiveId ?? null,
        workspace_id: workspaceId,
      };
    }

    throw new ApiError("VALIDATION_ERROR", "Context scope is invalid.", 400);
  }

  public async createTextContext(input: RecordInput): Promise<unknown> {
    return this.createContextItem(input);
  }

  public async createLinkContext(input: RecordInput): Promise<unknown> {
    return this.createContextItem(input);
  }

  public async createFileContext(input: CreateFileContextInput): Promise<unknown> {
    const originalFileName =
      typeof input.metadata?.original_file_name === "string" &&
      input.metadata.original_file_name.trim().length > 0
        ? input.metadata.original_file_name
        : input.file_name;
    return this.createContextItem({
      ...input,
      context_id: input.context_id,
      metadata: {
        ...(input.metadata ?? {}),
        original_file_name: originalFileName,
      },
      storage_bucket: STORAGE_BUCKET,
    });
  }

  /**
   * The browser uploads directly to the private bucket under its own JWT. Do
   * not create a graph reference until that caller can see the exact object.
   */
  public async verifyContextFile(path: string, sizeBytes: number, mimeType: string): Promise<void> {
    const separator = path.lastIndexOf("/");
    if (separator <= 0 || separator === path.length - 1) {
      throw validationError({ issues: [{ message: "storage_path is invalid.", path: ["storage_path"] }] });
    }

    const folder = path.slice(0, separator);
    const fileName = path.slice(separator + 1);
    const result = await this.supabase.storage.from(STORAGE_BUCKET).list(folder, {
      limit: 100,
      search: fileName,
    });
    const entries = responseOrThrow(result);
    const matchingEntry = Array.isArray(entries)
      ? entries.find(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as unknown as { name?: unknown }).name === fileName,
        )
      : undefined;

    if (!matchingEntry) {
      throw new ApiError(
        "UPLOAD_FAILED",
        "The uploaded file could not be found. Upload it before finalizing its metadata.",
        400,
      );
    }

    const entry = recordValue(matchingEntry, "Storage returned an invalid file object.");
    const metadata =
      typeof entry.metadata === "object" && entry.metadata !== null && !Array.isArray(entry.metadata)
        ? (entry.metadata as RecordInput)
        : undefined;
    const reportedSize = metadata ? numberValue(metadata, "size") : undefined;
    const reportedMimeType = metadata
      ? stringValue(metadata, "mimetype") ?? stringValue(metadata, "contentType")
      : undefined;

    if (
      (reportedSize !== undefined && reportedSize !== sizeBytes) ||
      (reportedMimeType !== undefined && reportedMimeType !== mimeType)
    ) {
      throw validationError({
        issues: [
          {
            message: "The uploaded file metadata does not match the declared file.",
            path: ["storage_path"],
          },
        ],
      });
    }
  }

  public async getDownloadUrl(workspaceId: string, contextId: string): Promise<unknown> {
    await this.workspaceRow(workspaceId);
    const result = await this.supabase
      .from("context_items")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", contextId)
      .maybeSingle();
    const rawContext = responseOrThrow(result);
    if (!rawContext) {
      throw notFound("Context item");
    }
    const context = recordValue(rawContext, "The database returned an invalid context item.");
    const storageBucket = stringValue(context, "storage_bucket");
    const storagePath = stringValue(context, "storage_path");
    if (!storageBucket || !storagePath) {
      throw new ApiError(
        "VALIDATION_ERROR",
        "This context item does not have an attached file.",
        400,
      );
    }

    const signed = await this.supabase.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, SIGNED_URL_SECONDS);
    const signedUrl = responseOrThrow(signed) as { signedUrl?: unknown } | null;
    if (!signedUrl || typeof signedUrl.signedUrl !== "string") {
      throw new ApiError("UPLOAD_FAILED", "A file download URL could not be created.", 502);
    }

    return {
      context,
      expires_in_seconds: SIGNED_URL_SECONDS,
      signed_url: signedUrl.signedUrl,
    };
  }

  public async listStrategies(workspaceId: string, objectiveId: string): Promise<unknown> {
    await this.objectiveRow(objectiveId, workspaceId);
    const strategiesResult = await this.supabase
      .from("strategies")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("objective_id", objectiveId)
      .order("created_at", { ascending: true });
    const strategies = responseOrThrow(strategiesResult) ?? [];
    const strategyIds = strategies
      .map((strategy) => recordValue(strategy, "The database returned an invalid strategy."))
      .map((strategy) => stringValue(strategy, "id"))
      .filter((id): id is string => id !== undefined);

    if (strategyIds.length === 0) {
      return { branches: [], objective_id: objectiveId, strategies, workspace_id: workspaceId };
    }

    const branchesResult = await this.supabase
      .from("branches")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("strategy_id", strategyIds)
      .order("created_at", { ascending: true });

    return {
      branches: responseOrThrow(branchesResult) ?? [],
      objective_id: objectiveId,
      strategies,
      workspace_id: workspaceId,
    };
  }

  public async getWorkspaceOverview(workspaceId: string): Promise<unknown> {
    await this.workspaceRow(workspaceId);
    return this.rpc("get_workspace_overview", { p_workspace_id: workspaceId });
  }

  public async listObjectives(workspaceId: string): Promise<unknown> {
    const overview = recordValue(
      await this.getWorkspaceOverview(workspaceId),
      "The database returned an invalid workspace overview.",
    );
    return {
      objectives: overview.objectives ?? [],
      workspace_id: workspaceId,
    };
  }

  public async listPendingDecisions(workspaceId: string): Promise<unknown> {
    await this.workspaceRow(workspaceId);
    return {
      decisions: await this.rpc("list_pending_decisions", { p_workspace_id: workspaceId }),
      workspace_id: workspaceId,
    };
  }

  public getObjective(workspaceId: string, objectiveId: string): Promise<unknown> {
    return this.objectiveRow(objectiveId, workspaceId);
  }

  public async getObjectiveGraph(workspaceId: string, objectiveId: string): Promise<unknown> {
    await this.objectiveRow(objectiveId, workspaceId);
    return this.rpc("get_objective_graph", { p_objective_id: objectiveId });
  }

  public async createStrategy(input: RecordInput): Promise<unknown> {
    const workspaceId = requiredString(input, "workspace_id");
    const objectiveId = requiredString(input, "objective_id");
    await this.objectiveRow(objectiveId, workspaceId);

    return this.rpc("create_strategy", {
      p_description_markdown: optional(stringValue(input, "description_markdown")),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_objective_id: objectiveId,
      p_root_branch_name: optional(stringValue(input, "root_branch_name")),
      p_title: requiredString(input, "title"),
      p_workspace_id: workspaceId,
      ...actorArguments(input),
    });
  }

  public createStep(input: RecordInput): Promise<unknown> {
    const dependencyStepIds = stringArray(input, "depends_on_step_ids") ?? [];
    return this.rpc("create_step", {
      p_body_markdown: requiredString(input, "body_markdown"),
      p_branch_id: requiredString(input, "branch_id"),
      p_concepts: optional(stringArray(input, "concepts")),
      p_expected_branch_revision: requiredNumber(input, "expected_branch_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_status: optional(stringValue(input, "status")),
      p_summary: optional(stringValue(input, "summary")),
      p_supersedes_step_id: optional(stringValue(input, "supersedes_step_id")),
      p_theorem_tags: optional(stringArray(input, "theorem_tags")),
      p_title: requiredString(input, "title"),
      ...actorArguments(input),
      ...(dependencyStepIds.length > 0
        ? { p_depends_on_step_ids: dependencyStepIds }
        : {}),
    });
  }

  public createStepDependency(input: RecordInput): Promise<unknown> {
    return this.rpc("create_step_dependency", {
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_source_step_id: requiredString(input, "source_step_id"),
      p_target_step_id: requiredString(input, "target_step_id"),
      p_workspace_id: requiredString(input, "workspace_id"),
      ...actorArguments(input),
    });
  }

  public updateStep(input: RecordInput): Promise<unknown> {
    return this.rpc("update_step", {
      p_body_markdown: optional(stringValue(input, "body_markdown")),
      p_concepts: optional(stringArray(input, "concepts")),
      p_expected_revision: requiredNumber(input, "expected_step_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_status: optional(stringValue(input, "status")),
      p_step_id: requiredString(input, "step_id"),
      p_summary: optional(stringValue(input, "summary")),
      p_theorem_tags: optional(stringArray(input, "theorem_tags")),
      p_title: optional(stringValue(input, "title")),
      ...actorArguments(input),
    });
  }

  public branchFromStep(input: RecordInput): Promise<unknown> {
    return this.rpc("branch_from_step", {
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_name: requiredString(input, "name"),
      p_step_id: requiredString(input, "step_id"),
      ...actorArguments(input),
    });
  }

  public markDeadEnd(input: RecordInput): Promise<unknown> {
    return this.rpc("mark_step_dead_end", {
      p_expected_revision: requiredNumber(input, "expected_step_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_step_id: requiredString(input, "step_id"),
      ...actorArguments(input),
    });
  }

  public async markEnd(input: RecordInput): Promise<unknown> {
    const result = await this.rpc("mark_branch_completed", {
      p_branch_id: requiredString(input, "branch_id"),
      p_expected_branch_revision: requiredNumber(input, "expected_branch_revision"),
      p_expected_strategy_revision: requiredNumber(input, "expected_strategy_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      ...actorArguments(input),
    });

    return markEndResultSchema.parse(result);
  }

  public async setReasoningResult(input: RecordInput): Promise<unknown> {
    const result = await this.rpc("set_reasoning_result", {
      p_expected_target_revision: requiredNumber(input, "expected_target_revision"),
      p_expected_result_revision: requiredNullableNumber(input, "expected_result_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_objective_id: requiredString(input, "objective_id"),
      p_outcome_status: requiredString(input, "outcome_status"),
      p_result_markdown: requiredString(input, "result_markdown"),
      p_target_id: requiredString(input, "target_id"),
      p_target_type: requiredString(input, "target_type"),
      p_workspace_id: requiredString(input, "workspace_id"),
      ...actorArguments(input),
    });

    return setReasoningResultResultSchema.parse(result);
  }

  public markAssumption(input: RecordInput): Promise<unknown> {
    return this.rpc("mark_assumption", {
      p_assumption_status: optional(stringValue(input, "assumption_status")),
      p_expected_step_revision: requiredNumber(input, "expected_step_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_label: requiredString(input, "label"),
      p_note_markdown: optional(stringValue(input, "note_markdown")),
      p_statement_markdown: requiredString(input, "statement_markdown"),
      p_step_id: requiredString(input, "step_id"),
      p_usage_kind: optional(stringValue(input, "usage_kind")),
      ...actorArguments(input),
    });
  }

  public async requestHumanDecision(input: RecordInput): Promise<unknown> {
    await this.workspaceRow(requiredString(input, "workspace_id"));

    return this.rpc("request_human_decision", {
      p_branch_id: optional(stringValue(input, "branch_id")),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_kind: optional(stringValue(input, "kind")),
      p_objective_id: optional(stringValue(input, "objective_id")),
      p_question_markdown: requiredString(input, "question_markdown"),
      p_step_id: optional(stringValue(input, "step_id")),
      p_strategy_id: optional(stringValue(input, "strategy_id")),
      p_workspace_id: requiredString(input, "workspace_id"),
      ...actorArguments(input),
    });
  }

  public resolveHumanDecision(input: RecordInput): Promise<unknown> {
    return this.rpc("resolve_human_decision", {
      p_decision_id: requiredString(input, "decision_id"),
      p_expected_revision: requiredNumber(input, "expected_decision_revision"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_resolution_markdown: requiredString(input, "resolution_markdown"),
      p_resolution_outcome: requiredString(input, "resolution_outcome"),
    });
  }

  public getBranchPath(branchId: string): Promise<unknown> {
    return this.rpc("get_branch_path", { p_branch_id: branchId });
  }

  public compareBranches(input: RecordInput): Promise<unknown> {
    return this.compareBranchesWithinObjective(input);
  }

  private async compareBranchesWithinObjective(input: RecordInput): Promise<unknown> {
    const branchAId = requiredString(input, "branch_a_id");
    const branchBId = requiredString(input, "branch_b_id");
    const [branchA, branchB] = await Promise.all([this.branchRow(branchAId), this.branchRow(branchBId)]);
    const [objectiveAId, objectiveBId] = await Promise.all([
      this.strategyObjectiveId(requiredString(branchA, "strategy_id"), requiredString(branchA, "workspace_id")),
      this.strategyObjectiveId(requiredString(branchB, "strategy_id"), requiredString(branchB, "workspace_id")),
    ]);
    if (objectiveAId !== objectiveBId) {
      throw new ApiError("VALIDATION_ERROR", "Branches from different objectives cannot be compared.", 400);
    }

    return this.rpc("compare_branches", {
      p_branch_a_id: requiredString(input, "branch_a_id"),
      p_branch_b_id: requiredString(input, "branch_b_id"),
    });
  }

  public async findSteps(input: RecordInput): Promise<unknown> {
    await this.workspaceRow(requiredString(input, "workspace_id"));

    let queryEmbedding: string | undefined;
    if (this.embedText) {
      try {
        queryEmbedding = embeddingVectorLiteral(
          await this.embedText(requiredString(input, "query")),
        );
      } catch (error) {
        this.reportEmbeddingError?.(error);
      }
    }

    const results = await this.rpc("find_steps", {
      p_branch_id: optional(stringValue(input, "branch_id")),
      p_embedding_model: ACTIVE_STEP_EMBEDDING_MODEL,
      p_query_embedding: queryEmbedding,
      p_query_text: requiredString(input, "query"),
      p_status: optional(stringValue(input, "status")),
      p_objective_id: optional(stringValue(input, "objective_id")),
      p_strategy_id: optional(stringValue(input, "strategy_id")),
      p_top_k: optional(numberValue(input, "top_k")),
      p_workspace_id: requiredString(input, "workspace_id"),
    });

    return {
      embedding_model: queryEmbedding ? ACTIVE_STEP_EMBEDDING_MODEL : null,
      results,
      retrieval_mode: queryEmbedding ? "hybrid" : "lexical_fallback",
    };
  }

  public generateCleanSolution(branchId: string): Promise<unknown> {
    return this.rpc("generate_clean_solution", { p_branch_id: branchId });
  }

  public async saveCleanSolution(input: RecordInput): Promise<unknown> {
    await this.branchRow(requiredString(input, "branch_id"));

    return this.rpc("save_clean_solution_snapshot", {
      p_branch_id: requiredString(input, "branch_id"),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      ...actorArguments(input),
    });
  }

  private async rpc(functionName: string, arguments_: RecordInput): Promise<unknown> {
    const cleanArguments = Object.fromEntries(
      Object.entries(arguments_).filter(([, value]) => value !== undefined),
    );
    const result = await this.supabase.rpc(functionName, cleanArguments);
    return responseOrThrow(result);
  }

  /**
   * Context rows are created through the same receipt-backed mutation path for
   * text, links, and verified uploads. The database validates kind-specific
   * fields and the workspace/objective scope atomically with the insert.
   */
  private createContextItem(input: RecordInput): Promise<unknown> {
    const scope = requiredString(input, "scope");
    const workspaceId = requiredString(input, "workspace_id");
    return this.rpc("create_context_item", {
      p_body_markdown: optional(stringValue(input, "body_markdown")),
      p_context_id: optional(stringValue(input, "context_id")),
      p_idempotency_key: requiredString(input, "idempotency_key"),
      p_kind: requiredString(input, "kind"),
      p_metadata: input.metadata ?? {},
      p_mime_type: optional(stringValue(input, "mime_type")),
      p_objective_id: stringValue(input, "objective_id") ?? null,
      p_processing_status: optional(stringValue(input, "processing_status")),
      p_scope: scope,
      p_size_bytes: optional(numberValue(input, "size_bytes")),
      p_source_url: optional(stringValue(input, "source_url")),
      p_storage_bucket: optional(stringValue(input, "storage_bucket")),
      p_storage_path: optional(stringValue(input, "storage_path")),
      p_title: requiredString(input, "title"),
      p_workspace_id: workspaceId,
      ...actorArguments(input),
    });
  }

  private async workspaceRow(workspaceId: string): Promise<RecordInput> {
    const result = await this.supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .maybeSingle();
    const workspace = responseOrThrow(result);
    if (!workspace) {
      throw new ApiError("NOT_FOUND", "Workspace not found.", 404);
    }
    return workspace as RecordInput;
  }

  private async objectiveRow(objectiveId: string, workspaceId: string): Promise<RecordInput> {
    const result = await this.supabase
      .from("objectives")
      .select("*")
      .eq("id", objectiveId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const objective = responseOrThrow(result);
    if (!objective) {
      throw notFound("Objective");
    }
    return objective as RecordInput;
  }

  private contextArray(response: RecordInput, field: string): unknown[] {
    const value = response[field];
    if (!Array.isArray(value)) {
      throw new ApiError("INTERNAL_ERROR", "The database returned invalid context.", 500);
    }
    return value;
  }

  private async strategyObjectiveId(strategyId: string, workspaceId: string): Promise<string> {
    const result = await this.supabase
      .from("strategies")
      .select("objective_id")
      .eq("id", strategyId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const strategy = responseOrThrow(result);
    if (!strategy) {
      throw notFound("Strategy");
    }
    return requiredString(
      recordValue(strategy, "The database returned an invalid strategy."),
      "objective_id",
    );
  }

  private async branchRow(branchId: string): Promise<RecordInput> {
    const result = await this.supabase
      .from("branches")
      .select("*")
      .eq("id", branchId)
      .maybeSingle();
    const branch = responseOrThrow(result);
    if (!branch) {
      throw notFound("Branch");
    }
    return branch as RecordInput;
  }

}

function validationIssues(issues: ValidationIssue[] | undefined): ApiErrorPayload["details"] {
  const normalized = (issues ?? []).slice(0, 100).map((issue) => ({
    message:
      typeof issue.message === "string" && issue.message.length > 0
        ? issue.message.slice(0, 1_000)
        : "Invalid value.",
    path: Array.isArray(issue.path)
      ? issue.path.filter(
          (segment): segment is string | number =>
            typeof segment === "string" ||
            (typeof segment === "number" && Number.isInteger(segment) && segment >= 0),
        )
      : [],
  }));

  return normalized.length > 0 ? { issues: normalized } : undefined;
}

function parseInput<T extends RecordInput>(schema: RuntimeSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationError(validationIssues(result.error.issues));
  }
  return result.data;
}

function requireUuid(value: unknown, label: string): string {
  if (!uuidSchema.safeParse(value).success) {
    throw validationError({ issues: [{ message: `${label} must be a UUID.`, path: [label] }] });
  }
  return value as string;
}

function withRouteIdentifier(body: RecordInput, identifier: string, value: string): RecordInput {
  return { ...body, [identifier]: value };
}

async function objectBody(request: Request): Promise<RecordInput> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ApiError(
      "UNSUPPORTED_MEDIA_TYPE",
      "This endpoint requires the expected content type.",
      415,
    );
  }

  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw validationError({ issues: [{ message: "Expected a JSON object.", path: [] }] });
    }
    return body as RecordInput;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw validationError({ issues: [{ message: "Expected a JSON object.", path: [] }] });
  }
}

function queryNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function safeFileName(fileName: string): string {
  const normalized = fileName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 180);

  return normalized.length > 0 ? normalized : "upload";
}

function uploadPathParts(userId: string, workspaceId: string, storagePath: string): {
  contextId: string;
  fileName: string;
} {
  const parts = storagePath.split("/");
  const [pathUserId, pathWorkspaceId, contextId, fileName] = parts;
  if (
    parts.length !== 4 ||
    pathUserId !== userId ||
    pathWorkspaceId !== workspaceId ||
    !contextId ||
    !fileName ||
    !uuidSchema.safeParse(contextId).success ||
    safeFileName(fileName) !== fileName
  ) {
    throw validationError({
      issues: [
        {
          message:
            "storage_path must be user/workspace/context-id/safe-file-name for the authenticated user.",
          path: ["storage_path"],
        },
      ],
    });
  }

  return { contextId, fileName };
}

function assertUploadSize(raw: RecordInput): void {
  const size = raw.size_bytes;
  if (typeof size === "number" && Number.isFinite(size) && size > MAX_CONTEXT_FILE_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Files must be 50 MB or smaller.", 413);
  }
}

function enforceFileMetadata(
  input: RecordInput,
  userId: string,
  workspaceId: string,
): { contextId: string; fileName: string } {
  if (input.storage_bucket !== STORAGE_BUCKET) {
    throw validationError({
      issues: [{ message: "storage_bucket must be workspace-context.", path: ["storage_bucket"] }],
    });
  }

  const mimeType = stringValue(input, "mime_type");
  if (!mimeType || !SUPPORTED_FILE_TYPES.has(mimeType)) {
    throw new ApiError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Only PDF, PNG, JPEG, and WebP files are supported.",
      415,
    );
  }

  const expectedKind = mimeType === "application/pdf" ? "pdf" : "image";
  if (input.kind !== expectedKind) {
    throw validationError({
      issues: [{ message: "kind must match mime_type.", path: ["kind"] }],
    });
  }

  const size = numberValue(input, "size_bytes");
  if (size === undefined || size > MAX_CONTEXT_FILE_BYTES) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "Files must be 50 MB or smaller.", 413);
  }

  return uploadPathParts(userId, workspaceId, requiredString(input, "storage_path"));
}

function normalizeUrl(value: string, label: string): string {
  try {
    return new URL(value).toString().replace(/\/$/u, "");
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
}

function normalizeOrigins(value: string | string[] | undefined): string[] {
  const candidates = (Array.isArray(value) ? value : (value ?? DEFAULT_WEB_ORIGINS).split(","))
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (candidates.length === 0) {
    throw new Error("WEB_ORIGIN must contain at least one absolute URL.");
  }
  return candidates.map((origin) => normalizeUrl(origin, "WEB_ORIGIN"));
}

function normalizeEnvironment(environment: LemmaApiEnvironment): LemmaApiEnvironment {
  if (!environment.SUPABASE_PUBLISHABLE_KEY.trim()) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required.");
  }

  return {
    AUTH_ISSUER: normalizeUrl(environment.AUTH_ISSUER, "AUTH_ISSUER"),
    SUPABASE_PUBLISHABLE_KEY: environment.SUPABASE_PUBLISHABLE_KEY.trim(),
    SUPABASE_URL: normalizeUrl(environment.SUPABASE_URL, "SUPABASE_URL"),
    WEB_ORIGIN: normalizeOrigins(environment.WEB_ORIGIN),
  };
}

export function loadLemmaApiEnvironment(source: EnvironmentSource): LemmaApiEnvironment {
  const publishableKey =
    source.SUPABASE_PUBLISHABLE_KEY?.trim() || source.SUPABASE_ANON_KEY?.trim();
  const url = source.SUPABASE_URL?.trim();
  if (!publishableKey || !url) {
    throw new Error(
      "SUPABASE_URL and either SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY are required.",
    );
  }
  const normalizedSupabaseUrl = normalizeUrl(url, "SUPABASE_URL");

  return normalizeEnvironment({
    AUTH_ISSUER: source.LEMMA_AUTH_ISSUER?.trim() || `${normalizedSupabaseUrl}/auth/v1`,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_URL: normalizedSupabaseUrl,
    WEB_ORIGIN: normalizeOrigins(source.WEB_ORIGIN),
  });
}

function originAllowed(origin: string | null, allowedOrigins: string[]): boolean {
  if (origin === null) {
    return true;
  }

  try {
    const normalized = new URL(origin).toString().replace(/\/$/u, "");
    return allowedOrigins.includes(normalized);
  } catch {
    return false;
  }
}

function baseHeaders(request: Request, environment: LemmaApiEnvironment): Headers {
  const headers = new Headers({
    "Cross-Origin-Resource-Policy": "same-site",
    "Origin-Agent-Cluster": "?1",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  const origin = request.headers.get("origin");
  if (origin !== null && originAllowed(origin, environment.WEB_ORIGIN)) {
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function preflightResponse(request: Request, environment: LemmaApiEnvironment): Response {
  const headers = baseHeaders(request, environment);
  if (originAllowed(request.headers.get("origin"), environment.WEB_ORIGIN)) {
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, apikey");
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, OPTIONS");
  }
  return new Response(null, { headers, status: 204 });
}

function jsonResponse(
  request: Request,
  environment: LemmaApiEnvironment,
  status: number,
  payload: unknown,
): Response {
  const headers = baseHeaders(request, environment);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { headers, status });
}

function sendSuccess<T>(
  request: Request,
  environment: LemmaApiEnvironment,
  schema: RuntimeSchema<T>,
  data: unknown,
  status = 200,
): Response {
  return jsonResponse(request, environment, status, { data: schema.parse(data), ok: true });
}

function sendError(request: Request, environment: LemmaApiEnvironment, error: ApiError): Response {
  const payload = apiErrorEnvelopeSchema.parse({
    error: {
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
      message: error.message,
    },
    ok: false,
  });
  return jsonResponse(request, environment, error.statusCode, payload);
}

function errorDiagnostic(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return { type: typeof error };
  }

  const value = error as Record<string, unknown>;
  const message =
    typeof value.message === "string"
      ? value.message.replace(JWT_LIKE_VALUE, "[redacted-token]").slice(0, 500)
      : undefined;

  return {
    ...(typeof value.code === "string" ? { upstream_code: value.code } : {}),
    ...(message === undefined ? {} : { message }),
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.status === "number" ? { upstream_status: value.status } : {}),
  };
}

function embeddingErrorDiagnostic(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return { type: typeof error };
  }

  const name = (error as Record<string, unknown>).name;
  return typeof name === "string" ? { name } : { type: "object" };
}

function matchPath(pathname: string, pattern: RegExp): RegExpExecArray | null {
  return pattern.exec(pathname);
}

/**
 * Hosted and local Function gateways forward the function name as the first
 * pathname segment. A reverse proxy can already strip it, so support exactly
 * those two documented forms and leave every other prefix untouched.
 */
function normalizeGatewayPath(pathname: string): string {
  const functionPrefix = "/lemma-api";
  if (!pathname.startsWith(functionPrefix)) {
    return pathname;
  }

  const withoutFunctionName = pathname.slice(functionPrefix.length);
  if (
    withoutFunctionName === API_PREFIX ||
    withoutFunctionName.startsWith(`${API_PREFIX}/`)
  ) {
    return withoutFunctionName;
  }

  return pathname;
}

async function routeRequest(
  request: Request,
  environment: LemmaApiEnvironment,
  scope: AuthenticatedScope,
  url: URL,
): Promise<Response> {
  const { pathname } = url;
  const { service, user } = scope;

  if (request.method === "GET" && pathname === `${API_PREFIX}/workspaces`) {
    const workspaces = await service.listWorkspaces();
    return sendSuccess(request, environment, workspaceListResultSchema, { workspaces });
  }

  if (request.method === "POST" && pathname === `${API_PREFIX}/workspaces`) {
    const input = parseInput(createWorkspaceInputSchema, await objectBody(request));
    const result = await service.createWorkspace(input);
    return sendSuccess(request, environment, createWorkspaceResultSchema, result, 201);
  }

  let match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)$/u);
  if (match) {
    const workspaceId = requireUuid(match[1], "workspaceId");
    if (request.method === "GET") {
      parseInput(getWorkspaceInputSchema, { workspace_id: workspaceId });
      const overview = await service.getWorkspaceOverview(workspaceId);
      return sendSuccess(request, environment, workspaceOverviewSchema, overview);
    }
    if (request.method === "PATCH") {
      const input = parseInput(
        updateWorkspaceInputSchema,
        withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
      );
      const result = await service.updateWorkspace(input);
      return sendSuccess(request, environment, updateWorkspaceResultSchema, result);
    }
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/objectives$/u);
  if (match) {
    const workspaceId = requireUuid(match[1], "workspaceId");
    if (request.method === "GET") {
      parseInput(listObjectivesInputSchema, { workspace_id: workspaceId });
      const result = await service.listObjectives(workspaceId);
      return sendSuccess(request, environment, listObjectivesResultSchema, result);
    }
    if (request.method === "POST") {
      const input = parseInput(
        createObjectiveInputSchema,
        withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
      );
      const result = await service.createObjective(input);
      return sendSuccess(request, environment, createObjectiveResultSchema, result, 201);
    }
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/objectives\/([^/]+)$/u);
  if (match) {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const objectiveId = requireUuid(match[2], "objectiveId");
    if (request.method === "GET") {
      parseInput(getObjectiveInputSchema, { objective_id: objectiveId, workspace_id: workspaceId });
      const objective = await service.getObjective(workspaceId, objectiveId);
      return sendSuccess(request, environment, objectiveSchema, objective);
    }
    if (request.method === "PATCH") {
      const input = parseInput(
        updateObjectiveInputSchema,
        withRouteIdentifier(
          withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
          "objective_id",
          objectiveId,
        ),
      );
      const result = await service.updateObjective(input);
      return sendSuccess(request, environment, updateObjectiveResultSchema, result);
    }
  }

  match = matchPath(
    pathname,
    /^\/api\/v1\/workspaces\/([^/]+)\/objectives\/([^/]+)\/graph$/u,
  );
  if (match && request.method === "GET") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const objectiveId = requireUuid(match[2], "objectiveId");
    parseInput(getObjectiveInputSchema, { objective_id: objectiveId, workspace_id: workspaceId });
    const graph = await service.getObjectiveGraph(workspaceId, objectiveId);
    return sendSuccess(request, environment, objectiveGraphSchema, graph);
  }

  match = matchPath(
    pathname,
    /^\/api\/v1\/workspaces\/([^/]+)\/objectives\/([^/]+)\/reasoning-results$/u,
  );
  if (match && request.method === "PUT") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const objectiveId = requireUuid(match[2], "objectiveId");
    const input = parseInput(
      setReasoningResultInputSchema,
      withRouteIdentifier(
        withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
        "objective_id",
        objectiveId,
      ),
    );
    const result = await service.setReasoningResult(input);
    return sendSuccess(request, environment, setReasoningResultResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/context$/u);
  if (match && request.method === "GET") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(getContextInputSchema, {
      objective_id: url.searchParams.get("objective_id") ?? undefined,
      scope: url.searchParams.get("scope") ?? undefined,
      workspace_id: workspaceId,
    });
    const context = await service.getContext(input);
    return sendSuccess(request, environment, getContextResultSchema, context);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/context\/text$/u);
  if (match && request.method === "POST") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(
      createContextTextInputSchema,
      withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
    );
    const item = await service.createTextContext(input);
    return sendSuccess(request, environment, createContextItemResultSchema, item, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/context\/link$/u);
  if (match && request.method === "POST") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(
      createContextLinkInputSchema,
      withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
    );
    const item = await service.createLinkContext(input);
    return sendSuccess(request, environment, createContextItemResultSchema, item, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/context\/file$/u);
  if (match && request.method === "POST") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const body = await objectBody(request);
    assertUploadSize(body);
    const input = parseInput(
      createContextUploadInputSchema,
      withRouteIdentifier(body, "workspace_id", workspaceId),
    ) as RecordInput & CreateContextUploadInput;
    const { contextId, fileName } = enforceFileMetadata(input, user.id, workspaceId);
    await service.getWorkspace(workspaceId);
    await service.verifyContextFile(input.storage_path, input.size_bytes, input.mime_type);
    const fileContextInput: CreateFileContextInput = {
      context_id: contextId,
      file_name: fileName,
      kind: input.kind,
      idempotency_key: input.idempotency_key,
      metadata: input.metadata,
      mime_type: input.mime_type,
      size_bytes: input.size_bytes,
      storage_path: input.storage_path,
      title: input.title,
      workspace_id: workspaceId,
      scope: input.scope,
      ...(input.body_markdown === undefined ? {} : { body_markdown: input.body_markdown }),
      ...(input.objective_id === undefined ? {} : { objective_id: input.objective_id }),
      ...contextActor(input),
    };
    const item = await service.createFileContext(fileContextInput);
    return sendSuccess(request, environment, createContextItemResultSchema, item, 201);
  }

  match = matchPath(
    pathname,
    /^\/api\/v1\/workspaces\/([^/]+)\/context\/([^/]+)\/download$/u,
  );
  if (match && request.method === "GET") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const contextId = requireUuid(match[2], "contextId");
    const signed = await service.getDownloadUrl(workspaceId, contextId);
    return sendSuccess(request, environment, signedContextDownloadResultSchema, signed);
  }

  match = matchPath(
    pathname,
    /^\/api\/v1\/workspaces\/([^/]+)\/objectives\/([^/]+)\/strategies$/u,
  );
  if (match) {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const objectiveId = requireUuid(match[2], "objectiveId");
    if (request.method === "GET") {
      parseInput(listStrategiesInputSchema, { objective_id: objectiveId, workspace_id: workspaceId });
      const result = await service.listStrategies(workspaceId, objectiveId);
      return sendSuccess(request, environment, listStrategiesResultSchema, result);
    }
    if (request.method === "POST") {
      const input = parseInput(
        createStrategyInputSchema,
        withRouteIdentifier(
          withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
          "objective_id",
          objectiveId,
        ),
      );
      const result = await service.createStrategy(input);
      return sendSuccess(request, environment, createStrategyResultSchema, result, 201);
    }
  }

  match = matchPath(pathname, /^\/api\/v1\/branches\/([^/]+)\/steps$/u);
  if (match && request.method === "POST") {
    const branchId = requireUuid(match[1], "branchId");
    const input = parseInput(
      createStepInputSchema,
      withRouteIdentifier(await objectBody(request), "branch_id", branchId),
    );
    const result = await service.createStep(input);
    return sendSuccess(request, environment, createStepResultSchema, result, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/step-dependencies$/u);
  if (match && request.method === "POST") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(
      createStepDependencyInputSchema,
      withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
    );
    const result = await service.createStepDependency(input);
    return sendSuccess(request, environment, createStepDependencyResultSchema, result, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/steps\/([^/]+)$/u);
  if (match && request.method === "PATCH") {
    const stepId = requireUuid(match[1], "stepId");
    const input = parseInput(
      updateStepInputSchema,
      withRouteIdentifier(await objectBody(request), "step_id", stepId),
    );
    const result = await service.updateStep(input);
    return sendSuccess(request, environment, updateStepResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/steps\/([^/]+)\/branch$/u);
  if (match && request.method === "POST") {
    const stepId = requireUuid(match[1], "stepId");
    const input = parseInput(
      branchFromStepInputSchema,
      withRouteIdentifier(await objectBody(request), "step_id", stepId),
    );
    const result = await service.branchFromStep(input);
    return sendSuccess(request, environment, branchFromStepResultSchema, result, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/steps\/([^/]+)\/assumptions$/u);
  if (match && request.method === "POST") {
    const stepId = requireUuid(match[1], "stepId");
    const input = parseInput(
      markAssumptionInputSchema,
      withRouteIdentifier(await objectBody(request), "step_id", stepId),
    );
    const result = await service.markAssumption(input);
    return sendSuccess(request, environment, markAssumptionResultSchema, result, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/steps\/([^/]+)\/dead-end$/u);
  if (match && request.method === "POST") {
    const stepId = requireUuid(match[1], "stepId");
    const input = parseInput(
      markDeadEndInputSchema,
      withRouteIdentifier(await objectBody(request), "step_id", stepId),
    );
    const result = await service.markDeadEnd(input);
    return sendSuccess(request, environment, updateStepResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/branches\/([^/]+)\/end$/u);
  if (match && request.method === "POST") {
    const branchId = requireUuid(match[1], "branchId");
    const input = parseInput(
      markEndInputSchema,
      withRouteIdentifier(await objectBody(request), "branch_id", branchId),
    );
    const result = await service.markEnd(input);
    return sendSuccess(request, environment, markEndResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/decisions$/u);
  if (match && request.method === "POST") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(
      requestHumanDecisionInputSchema,
      withRouteIdentifier(await objectBody(request), "workspace_id", workspaceId),
    );
    const result = await service.requestHumanDecision(input);
    return sendSuccess(request, environment, requestHumanDecisionResultSchema, result, 201);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/decisions\/pending$/u);
  if (match && request.method === "GET") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const result = await service.listPendingDecisions(workspaceId);
    return sendSuccess(request, environment, pendingDecisionsResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/decisions\/([^/]+)\/resolve$/u);
  if (match && request.method === "POST") {
    const decisionId = requireUuid(match[1], "decisionId");
    const input = parseInput(
      resolveHumanDecisionInputSchema,
      withRouteIdentifier(await objectBody(request), "decision_id", decisionId),
    );
    const result = await service.resolveHumanDecision(input);
    return sendSuccess(request, environment, resolveHumanDecisionResultSchema, result);
  }

  match = matchPath(pathname, /^\/api\/v1\/branches\/([^/]+)\/path$/u);
  if (match && request.method === "GET") {
    const branchId = requireUuid(match[1], "branchId");
    const steps = await service.getBranchPath(branchId);
    return sendSuccess(request, environment, branchPathSchema, { branch_id: branchId, steps });
  }

  if (pathname === `${API_PREFIX}/branches/compare` && request.method === "POST") {
    const input = parseInput(compareBranchesInputSchema, await objectBody(request));
    const comparison = await service.compareBranches(input);
    return sendSuccess(request, environment, branchComparisonSchema, comparison);
  }

  match = matchPath(pathname, /^\/api\/v1\/workspaces\/([^/]+)\/steps\/search$/u);
  if (match && request.method === "GET") {
    const workspaceId = requireUuid(match[1], "workspaceId");
    const input = parseInput(findStepsInputSchema, {
      branch_id: url.searchParams.get("branch_id") ?? undefined,
      objective_id: url.searchParams.get("objective_id") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      strategy_id: url.searchParams.get("strategy_id") ?? undefined,
      top_k: queryNumber(url.searchParams.get("top_k")),
      workspace_id: workspaceId,
    });
    const retrieval = recordValue(
      await service.findSteps(input),
      "The retrieval service returned an invalid response.",
    );
    return sendSuccess(request, environment, findStepsResultSchema, {
      embedding_model: retrieval.embedding_model,
      query: input.query,
      results: retrieval.results,
      retrieval_mode: retrieval.retrieval_mode,
      workspace_id: workspaceId,
    });
  }

  match = matchPath(pathname, /^\/api\/v1\/branches\/([^/]+)\/clean-solution$/u);
  if (match && request.method === "GET") {
    const branchId = requireUuid(match[1], "branchId");
    const solution = await service.generateCleanSolution(branchId);
    return sendSuccess(request, environment, cleanSolutionSchema, solution);
  }

  match = matchPath(pathname, /^\/api\/v1\/branches\/([^/]+)\/clean-solution\/snapshots$/u);
  if (match && request.method === "POST") {
    const branchId = requireUuid(match[1], "branchId");
    const input = parseInput(
      saveCleanSolutionInputSchema,
      withRouteIdentifier(await objectBody(request), "branch_id", branchId),
    );
    const result = await service.saveCleanSolution(input);
    return sendSuccess(request, environment, saveCleanSolutionResultSchema, result, 201);
  }

  throw notFound("Route");
}

/**
 * Creates a testable Fetch handler. `index.ts` is the only file that starts
 * the Deno server, which keeps route/auth tests independent of the runtime.
 */
export function createLemmaApiHandler(options: LemmaApiHandlerOptions): (request: Request) => Promise<Response> {
  const environment = normalizeEnvironment(options.environment);
  const clientFactory = options.createClient ?? createClient;
  const authenticate = options.authenticate ?? createSupabaseAuthenticator(environment, clientFactory);
  const createGraphService: GraphServiceFactory =
    options.createGraphService ??
    ((user) =>
      new SupabaseGraphService(
        user.supabase,
        options.embedText,
        (error) =>
          options.logError?.({
            event: "query_embedding_failed",
            error: embeddingErrorDiagnostic(error),
          }),
      ));

  return async (request) => {
    const url = new URL(request.url);
    const normalizedPathname = normalizeGatewayPath(url.pathname);
    const routeUrl =
      normalizedPathname === url.pathname
        ? url
        : new URL(`${url.origin}${normalizedPathname}${url.search}`);

    if (request.method === "OPTIONS") {
      return preflightResponse(request, environment);
    }

    try {
      if (routeUrl.pathname === `${API_PREFIX}/health`) {
        if (request.method === "GET") {
          return jsonResponse(request, environment, 200, {
            data: { service: "lemma-api", status: "ok" },
            ok: true,
          });
        }
        throw notFound("Route");
      }

      const authorization = request.headers.get("authorization") ?? "";
      const match = /^Bearer\s+(.+)$/iu.exec(authorization);
      if (!match?.[1]) {
        throw new ApiError("UNAUTHORIZED", "Authentication is required.", 401);
      }

      const user = await authenticate(match[1]);
      return await routeRequest(request, environment, {
        service: createGraphService(user),
        user,
      }, routeUrl);
    } catch (error) {
      const mapped = asApiError(error);
      if (mapped.statusCode >= 500) {
        options.logError?.({
          api_error_code: mapped.code,
          error: errorDiagnostic(error),
        });
      }
      return sendError(request, environment, mapped);
    }
  };
}
