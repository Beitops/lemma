import {
  branchComparisonSchema,
  branchFromStepResultSchema,
  cleanSolutionSchema,
  createContextItemResultSchema,
  createContextUploadInputSchema,
  createObjectiveResultSchema,
  createStepDependencyResultSchema,
  createStepResultSchema,
  createStrategyResultSchema,
  createWorkspaceResultSchema,
  findStepsInputSchema,
  findStepsResultSchema,
  getContextResultSchema,
  listObjectivesResultSchema,
  listStrategiesResultSchema,
  markAssumptionResultSchema,
  markEndResultSchema,
  objectiveGraphSchema,
  objectiveSchema,
  pendingDecisionsResultSchema,
  requestHumanDecisionResultSchema,
  resolveHumanDecisionResultSchema,
  saveCleanSolutionResultSchema,
  setReasoningResultResultSchema,
  signedContextDownloadResultSchema,
  updateObjectiveResultSchema,
  updateStepResultSchema,
  updateWorkspaceResultSchema,
  workspaceListResultSchema,
  workspaceOverviewSchema,
  type ApiErrorPayload,
  type BranchFromStepInput,
  type CompareBranchesInput,
  type CreateContextLinkInput,
  type CreateContextTextInput,
  type CreateContextUploadInput,
  type CreateObjectiveInput,
  type CreateStepDependencyInput,
  type CreateStepInput,
  type CreateStrategyInput,
  type CreateWorkspaceInput,
  type ContextWriteScope,
  type FindStepsRequest,
  type GetContextInput,
  type MarkAssumptionInput,
  type MarkDeadEndInput,
  type MarkEndInput,
  type RequestHumanDecisionInput,
  type ResolveHumanDecisionInput,
  type SaveCleanSolutionInput,
  type SetReasoningResultInput,
  type UpdateStepInput,
  type UpdateObjectiveInput,
  type UpdateWorkspaceInput,
} from "@lemma/contracts";
import * as tus from "tus-js-client";
import { config } from "./config";
import { createStorageClient, supabase } from "./supabase";

type RuntimeSchema<T> = { parse(value: unknown): T };
type SchemaOutput<TSchema extends RuntimeSchema<unknown>> = ReturnType<TSchema["parse"]>;

export class ApiClientError extends Error {
  public readonly code: string;
  public readonly details: ApiErrorPayload["details"] | undefined;
  public readonly status: number;

  public constructor(payload: ApiErrorPayload, status: number) {
    super(payload.message);
    this.name = "ApiClientError";
    this.code = payload.code;
    this.details = payload.details;
    this.status = status;
  }
}

interface RequestOptions {
  body?: BodyInit;
  method?: "GET" | "PATCH" | "POST" | "PUT";
  signal?: AbortSignal;
}

const CONTEXT_STORAGE_BUCKET = "workspace-context";
const CONTEXT_STORAGE_FILE_NAME = "context";
const CONTEXT_STORAGE_FINGERPRINT_KEY = "lemma_context_fingerprint";
export const MAX_CONTEXT_FILE_BYTES = 50 * 1024 * 1024;
export const STANDARD_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const RESUMABLE_UPLOAD_CHUNK_BYTES = 6 * 1024 * 1024;

const CONTEXT_FILE_KIND_BY_MIME_TYPE = new Map<string, "image" | "pdf">([
  ["application/pdf", "pdf"],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
]);

interface ContextUploadFields {
  author_agent_name?: string;
  author_type: "agent" | "human";
  body_markdown?: string;
  file: File;
  idempotency_key: string;
  metadata?: Record<string, unknown>;
  objective_id?: string;
  scope: ContextWriteScope;
  title: string;
}

type ContextStorageReference = {
  contextId: string;
  storagePath: string;
};

function isErrorEnvelope(value: unknown): value is { error: ApiErrorPayload; ok: false } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null &&
    "code" in value.error &&
    "message" in value.error
  );
}

function readData(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== true || !("data" in value)) {
    throw new Error("The Lemma API returned an invalid response envelope.");
  }
  return value.data;
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortError(): DOMException {
  return new DOMException("The upload was cancelled.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: BufferSource): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

async function sha256Text(value: string): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(value));
}

function uuidFromDigest(digest: Uint8Array): string {
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * One idempotency key maps to one immutable Storage object within a workspace.
 * The hash is namespaced with the workspace, so the same key in different
 * workspaces cannot resolve to the same context UUID or object path.
 */
export async function deriveContextStorageReference(
  userId: string,
  workspaceId: string,
  idempotencyKey: string,
): Promise<ContextStorageReference> {
  const digest = await sha256Text(`lemma-context-storage\u0000${workspaceId}\u0000${idempotencyKey}`);
  const contextId = uuidFromDigest(digest);
  return {
    contextId,
    storagePath: `${userId}/${workspaceId}/${contextId}/${CONTEXT_STORAGE_FILE_NAME}`,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function contextUploadFingerprint(
  input: CreateContextUploadInput,
  file: File,
): Promise<string> {
  const fileHash = bytesToHex(await sha256(await file.arrayBuffer()));
  const logicalPayload = canonicalJson({
    author_agent_name: input.author_agent_name ?? null,
    author_type: input.author_type,
    body_markdown: input.body_markdown ?? null,
    file_sha256: fileHash,
    kind: input.kind,
    metadata: input.metadata,
    mime_type: input.mime_type,
    objective_id: input.objective_id ?? null,
    original_file_name: file.name,
    scope: input.scope,
    size_bytes: input.size_bytes,
    title: input.title,
  });
  return bytesToHex(await sha256Text(logicalPayload));
}

function idempotencyConflict(message: string): ApiClientError {
  return new ApiClientError({ code: "IDEMPOTENCY_CONFLICT", message }, 409);
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function storedFingerprint(metadata: unknown): string | undefined {
  const topLevel = nestedRecord(metadata);
  if (!topLevel) return undefined;
  const candidates = [
    topLevel,
    nestedRecord(topLevel.user_metadata),
    nestedRecord(topLevel.userMetadata),
  ];
  for (const candidate of candidates) {
    const value = candidate?.[CONTEXT_STORAGE_FINGERPRINT_KEY];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function storedNumber(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function storedMimeType(metadata: Record<string, unknown>): string | undefined {
  const mimetype = metadata.mimetype;
  if (typeof mimetype === "string") return mimetype;
  const contentType = metadata.contentType;
  return typeof contentType === "string" ? contentType : undefined;
}

async function hasVerifiedExistingUpload(
  accessToken: string,
  storagePath: string,
  file: File,
  fingerprint: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const separator = storagePath.lastIndexOf("/");
  const folder = storagePath.slice(0, separator);
  const fileName = storagePath.slice(separator + 1);
  const storageResult = await createStorageClient(accessToken, signal)
    .storage
    .from(CONTEXT_STORAGE_BUCKET)
    .list(folder, { limit: 100, search: fileName });
  if (storageResult.error) throw storageResult.error;

  const existing = storageResult.data?.find((entry) => entry.name === fileName);
  if (!existing) return false;

  const metadata = nestedRecord(existing.metadata);
  if (
    !metadata ||
    storedFingerprint(metadata) !== fingerprint ||
    storedNumber(metadata, "size") !== file.size ||
    storedMimeType(metadata) !== file.type
  ) {
    throw idempotencyConflict(
      "This idempotency key is already associated with a different uploaded context payload.",
    );
  }

  return true;
}

/** Keep Storage object names predictable and safe without exposing directory traversal. */
export function safeFileName(fileName: string | undefined): string {
  const normalized = (fileName ?? "upload")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]/gu, "_")
    .replace(/^\.+/u, "")
    .slice(0, 180);

  return normalized.length > 0 ? normalized : "upload";
}

/** Prefer the Storage-specific hostname for hosted Supabase projects and retain custom/local origins. */
export function resumableUploadEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  const hostedSuffix = ".supabase.co";
  const isHostedProject = url.protocol === "https:" && url.hostname.endsWith(hostedSuffix);
  const isStorageHost = url.hostname.endsWith(".storage.supabase.co");

  if (isHostedProject && !isStorageHost) {
    const projectRef = url.hostname.slice(0, -hostedSuffix.length);
    if (projectRef) {
      return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    }
  }

  return `${url.origin}/storage/v1/upload/resumable`;
}

function contextFileKind(file: File): "image" | "pdf" {
  const kind = CONTEXT_FILE_KIND_BY_MIME_TYPE.get(file.type);
  if (!kind) {
    throw new ApiClientError(
      {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Only PDF, PNG, JPEG, and WebP files are supported.",
      },
      415,
    );
  }
  return kind;
}

function validateContextFile(file: File): "image" | "pdf" {
  const kind = contextFileKind(file);
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_CONTEXT_FILE_BYTES) {
    throw new ApiClientError(
      {
        code: "PAYLOAD_TOO_LARGE",
        message: "Files must be 50 MB or smaller.",
      },
      413,
    );
  }
  return kind;
}

function uploadWithTus(
  file: File,
  storagePath: string,
  accessToken: string,
  contextFingerprint: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    let cancel = () => undefined;
    const complete = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      reject(error);
    };

    const upload = new tus.Upload(file, {
      chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES,
      endpoint: resumableUploadEndpoint(config.supabaseUrl),
      fingerprint: async () =>
        `lemma-context:${storagePath}:${contextFingerprint}`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: config.supabasePublishableKey,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: CONTEXT_STORAGE_BUCKET,
        contentType: file.type,
        metadata: JSON.stringify({ [CONTEXT_STORAGE_FINGERPRINT_KEY]: contextFingerprint }),
        objectName: storagePath,
      },
      onError: fail,
      onSuccess: complete,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1_000, 3_000, 5_000],
      storeFingerprintForResuming: true,
      uploadDataDuringCreation: true,
    });

    cancel = () => {
      if (settled) return;
      void upload.abort().catch(() => undefined);
      fail(abortError());
    };

    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }

    void upload.findPreviousUploads()
      .then((previousUploads) => {
        if (settled) return;
        const [previousUpload] = previousUploads;
        if (previousUpload) {
          upload.resumeFromPreviousUpload(previousUpload);
        }
        if (!settled) upload.start();
      })
      .catch(fail);
  });
}

export class LemmaApi {
  public constructor(private readonly accessToken: () => string | null) {}

  private token(): string {
    const token = this.accessToken();
    if (!token) throw new ApiClientError({ code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue." }, 401);
    return token;
  }

  private async request<T>(path: string, schema: RuntimeSchema<T>, options: RequestOptions = {}): Promise<T> {
    const token = this.token();

    const headers = new Headers({
      apikey: config.supabasePublishableKey,
      Authorization: `Bearer ${token}`,
    });
    if (typeof options.body === "string") headers.set("Content-Type", "application/json");

    const response = await fetch(`${config.apiUrl}${path}`, {
      headers,
      method: options.method ?? "GET",
      ...(options.body === undefined ? {} : { body: options.body }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The Lemma API returned a response that could not be read.");
    }

    if (!response.ok || isErrorEnvelope(payload)) {
      if (isErrorEnvelope(payload)) throw new ApiClientError(payload.error, response.status);
      throw new Error(`The Lemma API request failed with status ${response.status}.`);
    }

    return schema.parse(readData(payload));
  }

  public listWorkspaces(signal?: AbortSignal) {
    return this.request("/workspaces", workspaceListResultSchema, signal ? { signal } : {});
  }

  public getWorkspaceOverview(workspaceId: string, signal?: AbortSignal) {
    return this.request(`/workspaces/${workspaceId}`, workspaceOverviewSchema, signal ? { signal } : {});
  }

  public listObjectives(workspaceId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/objectives`,
      listObjectivesResultSchema,
      signal ? { signal } : {},
    );
  }

  public getObjective(workspaceId: string, objectiveId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}`,
      objectiveSchema,
      signal ? { signal } : {},
    );
  }

  public getObjectiveGraph(workspaceId: string, objectiveId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}/graph`,
      objectiveGraphSchema,
      signal ? { signal } : {},
    );
  }

  public createWorkspace(input: CreateWorkspaceInput, signal?: AbortSignal) {
    return this.request(
      "/workspaces",
      createWorkspaceResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public updateWorkspace(workspaceId: string, input: Omit<UpdateWorkspaceInput, "workspace_id">, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}`,
      updateWorkspaceResultSchema,
      { body: jsonBody(input), method: "PATCH", ...(signal ? { signal } : {}) },
    );
  }

  public createObjective(
    workspaceId: string,
    input: Omit<CreateObjectiveInput, "workspace_id">,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/workspaces/${workspaceId}/objectives`,
      createObjectiveResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public updateObjective(
    workspaceId: string,
    objectiveId: string,
    input: Omit<UpdateObjectiveInput, "objective_id" | "workspace_id">,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}`,
      updateObjectiveResultSchema,
      { body: jsonBody(input), method: "PATCH", ...(signal ? { signal } : {}) },
    );
  }

  public getContext(
    workspaceId: string,
    input: Omit<GetContextInput, "workspace_id">,
    signal?: AbortSignal,
  ) {
    const parameters = new URLSearchParams({ scope: input.scope });
    if (input.objective_id) parameters.set("objective_id", input.objective_id);
    return this.request(
      `/workspaces/${workspaceId}/context?${parameters.toString()}`,
      getContextResultSchema,
      signal ? { signal } : {},
    );
  }

  public createTextContext(workspaceId: string, input: Omit<CreateContextTextInput, "workspace_id">, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/context/text`,
      createContextItemResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public createLinkContext(workspaceId: string, input: Omit<CreateContextLinkInput, "workspace_id">, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/context/link`,
      createContextItemResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public async uploadContext(workspaceId: string, fields: ContextUploadFields, signal?: AbortSignal) {
    throwIfAborted(signal);
    const kind = validateContextFile(fields.file);
    const accessToken = this.token();
    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    const session = sessionResult.data.session;
    if (!session) {
      throw new ApiClientError({ code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue." }, 401);
    }

    throwIfAborted(signal);
    const storageReference = await deriveContextStorageReference(
      session.user.id,
      workspaceId,
      fields.idempotency_key,
    );
    const metadata = {
      ...(fields.metadata ?? {}),
      original_file_name: fields.file.name,
    };

    const input = createContextUploadInputSchema.parse({
      author_type: fields.author_type,
      idempotency_key: fields.idempotency_key,
      kind,
      metadata,
      objective_id: fields.objective_id,
      mime_type: fields.file.type,
      scope: fields.scope,
      size_bytes: fields.file.size,
      storage_bucket: CONTEXT_STORAGE_BUCKET,
      storage_path: storageReference.storagePath,
      title: fields.title,
      workspace_id: workspaceId,
      ...(fields.author_agent_name ? { author_agent_name: fields.author_agent_name } : {}),
      ...(fields.body_markdown ? { body_markdown: fields.body_markdown } : {}),
    });

    throwIfAborted(signal);
    const fingerprint = await contextUploadFingerprint(input, fields.file);
    throwIfAborted(signal);
    let objectCreatedThisAttempt = false;
    try {
      const alreadyUploaded = await hasVerifiedExistingUpload(
        accessToken,
        storageReference.storagePath,
        fields.file,
        fingerprint,
        signal,
      );
      if (!alreadyUploaded) {
        if (fields.file.size <= STANDARD_UPLOAD_MAX_BYTES) {
          const storageResult = await createStorageClient(accessToken, signal)
            .storage
            .from(CONTEXT_STORAGE_BUCKET)
            .upload(storageReference.storagePath, fields.file, {
              contentType: fields.file.type,
              metadata: { [CONTEXT_STORAGE_FINGERPRINT_KEY]: fingerprint },
              upsert: false,
            });
          if (storageResult.error) {
            if (!await hasVerifiedExistingUpload(
              accessToken,
              storageReference.storagePath,
              fields.file,
              fingerprint,
              signal,
            )) {
              throw storageResult.error;
            }
          } else {
            objectCreatedThisAttempt = true;
          }
        } else {
          try {
            await uploadWithTus(
              fields.file,
              storageReference.storagePath,
              accessToken,
              fingerprint,
              signal,
            );
            objectCreatedThisAttempt = true;
          } catch (error) {
            if (!await hasVerifiedExistingUpload(
              accessToken,
              storageReference.storagePath,
              fields.file,
              fingerprint,
              signal,
            )) {
              throw error;
            }
          }
        }
      }

      throwIfAborted(signal);
      const context = await this.request(
        `/workspaces/${workspaceId}/context/file`,
        createContextItemResultSchema,
        { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
      );
      if (
        context.id !== storageReference.contextId ||
        context.storage_path !== storageReference.storagePath
      ) {
        throw idempotencyConflict(
          "The API returned a context item that does not match this upload idempotency key.",
        );
      }
      return context;
    } catch (error) {
      if (objectCreatedThisAttempt && error instanceof ApiClientError) {
        try {
          const cleanupResult = await createStorageClient(accessToken)
            .storage
            .from(CONTEXT_STORAGE_BUCKET)
            .remove([storageReference.storagePath]);
          if (cleanupResult.error) throw cleanupResult.error;
        } catch {
          // Preserve the metadata-finalization error; the object cleanup is best effort.
        }
      }
      throw error;
    }
  }

  public getContextDownload(workspaceId: string, contextItemId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/context/${contextItemId}/download`,
      signedContextDownloadResultSchema,
      signal ? { signal } : {},
    );
  }

  public listStrategies(workspaceId: string, objectiveId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}/strategies`,
      listStrategiesResultSchema,
      signal ? { signal } : {},
    );
  }

  public createStrategy(
    workspaceId: string,
    objectiveId: string,
    input: Omit<CreateStrategyInput, "objective_id" | "workspace_id">,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}/strategies`,
      createStrategyResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public createStep(branchId: string, input: Omit<CreateStepInput, "branch_id">, signal?: AbortSignal) {
    return this.request(
      `/branches/${branchId}/steps`,
      createStepResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public createStepDependency(
    workspaceId: string,
    input: Omit<CreateStepDependencyInput, "workspace_id">,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/workspaces/${workspaceId}/step-dependencies`,
      createStepDependencyResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public updateStep(stepId: string, input: Omit<UpdateStepInput, "step_id">, signal?: AbortSignal) {
    return this.request(
      `/steps/${stepId}`,
      updateStepResultSchema,
      { body: jsonBody(input), method: "PATCH", ...(signal ? { signal } : {}) },
    );
  }

  public branchFromStep(stepId: string, input: Omit<BranchFromStepInput, "step_id">, signal?: AbortSignal) {
    return this.request(
      `/steps/${stepId}/branch`,
      branchFromStepResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public markAssumption(stepId: string, input: Omit<MarkAssumptionInput, "step_id">, signal?: AbortSignal) {
    return this.request(
      `/steps/${stepId}/assumptions`,
      markAssumptionResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public markDeadEnd(stepId: string, input: Omit<MarkDeadEndInput, "step_id">, signal?: AbortSignal) {
    return this.request(
      `/steps/${stepId}/dead-end`,
      updateStepResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public markEnd(branchId: string, input: Omit<MarkEndInput, "branch_id">, signal?: AbortSignal) {
    return this.request(
      `/branches/${branchId}/end`,
      markEndResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public setReasoningResult(
    workspaceId: string,
    objectiveId: string,
    input: Omit<SetReasoningResultInput, "objective_id" | "workspace_id">,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/workspaces/${workspaceId}/objectives/${objectiveId}/reasoning-results`,
      setReasoningResultResultSchema,
      { body: jsonBody(input), method: "PUT", ...(signal ? { signal } : {}) },
    );
  }

  public requestDecision(workspaceId: string, input: Omit<RequestHumanDecisionInput, "workspace_id">, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/decisions`,
      requestHumanDecisionResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public listPendingDecisions(workspaceId: string, signal?: AbortSignal) {
    return this.request(
      `/workspaces/${workspaceId}/decisions/pending`,
      pendingDecisionsResultSchema,
      signal ? { signal } : {},
    );
  }

  public resolveDecision(decisionId: string, input: Omit<ResolveHumanDecisionInput, "decision_id">, signal?: AbortSignal) {
    return this.request(
      `/decisions/${decisionId}/resolve`,
      resolveHumanDecisionResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public compareBranches(input: CompareBranchesInput, signal?: AbortSignal) {
    return this.request(
      "/branches/compare",
      branchComparisonSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }

  public findSteps(input: FindStepsRequest, signal?: AbortSignal) {
    const parsedInput = findStepsInputSchema.parse(input);
    const parameters = new URLSearchParams({ query: parsedInput.query });
    if (parsedInput.objective_id) parameters.set("objective_id", parsedInput.objective_id);
    if (parsedInput.strategy_id) parameters.set("strategy_id", parsedInput.strategy_id);
    if (parsedInput.branch_id) parameters.set("branch_id", parsedInput.branch_id);
    if (parsedInput.status) parameters.set("status", parsedInput.status);
    parameters.set("top_k", String(parsedInput.top_k));
    return this.request(
      `/workspaces/${parsedInput.workspace_id}/steps/search?${parameters.toString()}`,
      findStepsResultSchema,
      signal ? { signal } : {},
    );
  }

  public generateCleanSolution(branchId: string, signal?: AbortSignal) {
    return this.request(`/branches/${branchId}/clean-solution`, cleanSolutionSchema, signal ? { signal } : {});
  }

  public saveCleanSolution(branchId: string, input: Omit<SaveCleanSolutionInput, "branch_id">, signal?: AbortSignal) {
    return this.request(
      `/branches/${branchId}/clean-solution/snapshots`,
      saveCleanSolutionResultSchema,
      { body: jsonBody(input), method: "POST", ...(signal ? { signal } : {}) },
    );
  }
}

export type WorkspaceListResponse = SchemaOutput<typeof workspaceListResultSchema>;
