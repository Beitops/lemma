import { waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storageList = vi.fn();
  const storageUpload = vi.fn();
  const storageRemove = vi.fn();
  const storageFrom = vi.fn(() => ({ list: storageList, remove: storageRemove, upload: storageUpload }));
  const createStorageClient = vi.fn(() => ({ storage: { from: storageFrom } }));
  const getSession = vi.fn();
  const tusUploads: Array<{ file: unknown; options: Record<string, unknown>; upload: unknown }> = [];
  let onTusStart: ((upload: { options: Record<string, unknown> }) => void) | undefined;
  let previousUploads: unknown[] = [];

  class Upload {
    public readonly abort = vi.fn(async () => undefined);
    public readonly findPreviousUploads = vi.fn(async () => previousUploads);
    public readonly options: Record<string, unknown>;
    public readonly resumeFromPreviousUpload = vi.fn();

    public constructor(file: unknown, options: Record<string, unknown>) {
      this.options = options;
      tusUploads.push({ file, options, upload: this });
    }

    public start(): void {
      onTusStart?.(this);
    }
  }

  return {
    Upload,
    createStorageClient,
    getSession,
    setOnTusStart(value: ((upload: { options: Record<string, unknown> }) => void) | undefined) {
      onTusStart = value;
    },
    setPreviousUploads(value: unknown[]) {
      previousUploads = value;
    },
    storageList,
    storageFrom,
    storageRemove,
    storageUpload,
    tusUploads,
  };
});

vi.mock("./supabase", () => ({
  createStorageClient: mocks.createStorageClient,
  supabase: { auth: { getSession: mocks.getSession } },
}));

vi.mock("tus-js-client", () => ({ Upload: mocks.Upload }));

import {
  LemmaApi,
  MAX_CONTEXT_FILE_BYTES,
  RESUMABLE_UPLOAD_CHUNK_BYTES,
  STANDARD_UPLOAD_MAX_BYTES,
  deriveContextStorageReference,
  resumableUploadEndpoint,
  safeFileName,
} from "./api";
import { config } from "./config";

const ACCESS_TOKEN = "header.payload.signature";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const CONTEXT_ID = "33333333-3333-4333-8333-333333333333";
const IDEMPOTENCY_KEY = "55555555-5555-4555-8555-555555555555";
const OBJECTIVE_ID = "66666666-6666-4666-8666-666666666666";
const STRATEGY_ID = "77777777-7777-4777-8777-777777777777";
const BRANCH_ID = "88888888-8888-4888-8888-888888888888";
const DECISION_ID = "99999999-9999-4999-8999-999999999999";

function successfulContextResponse(request?: RequestInit) {
  const body = typeof request?.body === "string"
    ? JSON.parse(request.body) as { storage_path?: unknown }
    : {};
  const storagePath = typeof body.storage_path === "string" ? body.storage_path : undefined;
  const contextId = storagePath?.split("/")[2] ?? CONTEXT_ID;
  return new Response(JSON.stringify({
    data: contextItem({
      id: contextId,
      ...(storagePath === undefined ? {} : { storage_path: storagePath }),
    }),
    ok: true,
  }), { status: 201 });
}

function contextFile(
  size: number,
  type = "application/pdf",
  name = "Proof sketch.pdf",
  byte = 0,
): File {
  return new File([new Uint8Array(size).fill(byte)], name, { type });
}

function contextFields(file: File) {
  return {
    author_type: "human" as const,
    file,
    idempotency_key: IDEMPOTENCY_KEY,
    metadata: { origin: "dialog" },
    scope: "workspace" as const,
    title: "Proof context",
  };
}

const TIMESTAMP = "2026-08-31T00:00:00.000Z";

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, ok: true }), { status });
}

function workspace() {
  return {
    created_at: TIMESTAMP,
    id: WORKSPACE_ID,
    owner_id: USER_ID,
    revision: 1,
    status: "active",
    title: "Proofs",
    updated_at: TIMESTAMP,
  };
}

function objective() {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    constraints_markdown: "",
    created_at: TIMESTAMP,
    id: OBJECTIVE_ID,
    objective_markdown: "Prove the claim.",
    revision: 1,
    status: "active",
    title: "Main claim",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
  };
}

function pendingDecision() {
  return {
    ancestry: {
      branch_id: BRANCH_ID,
      objective_id: OBJECTIVE_ID,
      step_id: null,
      strategy_id: STRATEGY_ID,
    },
    decision: {
      branch_id: BRANCH_ID,
      created_at: TIMESTAMP,
      id: DECISION_ID,
      kind: "human_decision",
      objective_id: null,
      question_markdown: "Should we switch strategies?",
      requested_by_agent_name: "Lemma Agent",
      requested_by_type: "agent",
      requested_by_user_id: USER_ID,
      resolution_markdown: null,
      resolution_outcome: null,
      resolved_at: null,
      resolved_by_user_id: null,
      revision: 3,
      status: "pending",
      step_id: null,
      strategy_id: null,
      updated_at: TIMESTAMP,
      workspace_id: WORKSPACE_ID,
    },
  };
}

function contextItem(overrides: Record<string, unknown> = {}) {
  return {
    author_agent_name: null,
    author_type: "human",
    author_user_id: USER_ID,
    body_markdown: null,
    created_at: TIMESTAMP,
    id: CONTEXT_ID,
    kind: "pdf",
    metadata: { origin: "dialog" },
    mime_type: "application/pdf",
    objective_id: null,
    processing_status: "ready",
    revision: 1,
    size_bytes: 1_024,
    source_url: null,
    storage_bucket: "workspace-context",
    storage_path: `${USER_ID}/${WORKSPACE_ID}/legacy-context/Proof_sketch.pdf`,
    title: "Proof context",
    updated_at: TIMESTAMP,
    workspace_id: WORKSPACE_ID,
    ...overrides,
  };
}

async function storageReference(workspaceId = WORKSPACE_ID, idempotencyKey = IDEMPOTENCY_KEY) {
  return deriveContextStorageReference(USER_ID, workspaceId, idempotencyKey);
}

function api(): LemmaApi {
  return new LemmaApi(() => ACCESS_TOKEN);
}

beforeEach(() => {
  mocks.createStorageClient.mockClear();
  mocks.getSession.mockReset();
  mocks.storageList.mockReset();
  mocks.storageFrom.mockClear();
  mocks.storageRemove.mockReset();
  mocks.storageUpload.mockReset();
  mocks.tusUploads.splice(0);
  mocks.setPreviousUploads([]);
  mocks.setOnTusStart((upload) => {
    const onSuccess = upload.options.onSuccess;
    if (typeof onSuccess === "function") onSuccess();
  });

  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: USER_ID } } },
    error: null,
  });
  mocks.storageList.mockResolvedValue({ data: [], error: null });
  mocks.storageUpload.mockResolvedValue({ data: { fullPath: "unused", id: "unused", path: "unused" }, error: null });
  mocks.storageRemove.mockResolvedValue({ data: [], error: null });
  vi.stubGlobal("crypto", { randomUUID: () => "unused", subtle: webcrypto.subtle });
  vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, request?: RequestInit) => successfulContextResponse(request)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LemmaApi Edge requests", () => {
  it("sends both the caller JWT and publishable key to the Edge API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      data: { workspaces: [] },
      ok: true,
    })));
    await api().listWorkspaces();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(`${config.apiUrl}/workspaces`, expect.objectContaining({ method: "GET" }));
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(options.headers);
    expect(headers.get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers.get("apikey")).toBe(config.supabasePublishableKey);
  });

  it("uses explicit objective and context scopes on multi-objective routes", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(success({
        general_context_items: [],
        objectives: [{ ...objective(), branch_count: 0, step_count: 0, strategy_count: 0 }],
        workspace: workspace(),
      }))
      .mockResolvedValueOnce(success({ objective_id: OBJECTIVE_ID, objective_revision: 1, workspace_id: WORKSPACE_ID }, 201))
      .mockResolvedValueOnce(success({
        effective_context_items: [],
        general_context_items: [],
        objective_context_items: [],
        objective_id: OBJECTIVE_ID,
        workspace_id: WORKSPACE_ID,
      }))
      .mockResolvedValueOnce(success({
        objective_id: OBJECTIVE_ID,
        root_branch_id: "77777777-7777-4777-8777-777777777777",
        root_branch_revision: 1,
        strategy_id: "88888888-8888-4888-8888-888888888888",
        strategy_revision: 1,
        workspace_id: WORKSPACE_ID,
      }, 201))
      .mockResolvedValueOnce(success({
        author_agent_name: null,
        author_type: "human",
        author_user_id: USER_ID,
        branch_id: null,
        created_at: TIMESTAMP,
        id: "99999999-9999-4999-8999-999999999999",
        objective_id: OBJECTIVE_ID,
        outcome_status: "inconclusive",
        result_markdown: "Need another lemma.",
        revision: 1,
        strategy_id: "88888888-8888-4888-8888-888888888888",
        target_id: "88888888-8888-4888-8888-888888888888",
        target_revision: 1,
        target_type: "strategy",
        updated_at: TIMESTAMP,
        workspace_id: WORKSPACE_ID,
      }));

    const client = api();
    await client.getWorkspaceOverview(WORKSPACE_ID);
    await client.createObjective(WORKSPACE_ID, {
      author_type: "human",
      constraints_markdown: "",
      idempotency_key: "objective-create-001",
      objective_markdown: "Prove the claim.",
      title: "Main claim",
    });
    await client.getContext(WORKSPACE_ID, { objective_id: OBJECTIVE_ID, scope: "effective" });
    await client.createStrategy(WORKSPACE_ID, OBJECTIVE_ID, {
      author_type: "human",
      description_markdown: "",
      idempotency_key: "strategy-create-001",
      root_branch_name: "Main",
      title: "Direct proof",
    });
    await client.setReasoningResult(WORKSPACE_ID, OBJECTIVE_ID, {
      author_type: "human",
      expected_result_revision: null,
      expected_target_revision: 1,
      idempotency_key: "result-create-001",
      outcome_status: "inconclusive",
      result_markdown: "Need another lemma.",
      target_id: "88888888-8888-4888-8888-888888888888",
      target_type: "strategy",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}`,
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/objectives`,
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/context?scope=effective&objective_id=${OBJECTIVE_ID}`,
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/objectives/${OBJECTIVE_ID}/strategies`,
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/objectives/${OBJECTIVE_ID}/reasoning-results`,
    ]);

    const createObjectiveOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(createObjectiveOptions.body as string)).toMatchObject({
      objective_markdown: "Prove the claim.",
      title: "Main claim",
    });
    const resultOptions = fetchMock.mock.calls[4]?.[1] as RequestInit;
    expect(JSON.parse(resultOptions.body as string)).toMatchObject({
      target_type: "strategy",
      outcome_status: "inconclusive",
    });
  });

  it("serializes every retrieval filter and validates server-owned retrieval metadata", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(success({
        embedding_model: "gte-small:384:mean-pool-normalized:v1",
        query: "Cauchy-Schwarz",
        results: [],
        retrieval_mode: "hybrid",
        workspace_id: WORKSPACE_ID,
      }))
      .mockResolvedValueOnce(success({
        embedding_model: null,
        query: "continuity assumption",
        results: [],
        retrieval_mode: "lexical_fallback",
        workspace_id: WORKSPACE_ID,
      }));

    const client = api();
    await expect(client.findSteps({
      branch_id: BRANCH_ID,
      objective_id: OBJECTIVE_ID,
      query: "Cauchy-Schwarz",
      status: "active",
      strategy_id: STRATEGY_ID,
      top_k: 7,
      workspace_id: WORKSPACE_ID,
    })).resolves.toMatchObject({
      embedding_model: "gte-small:384:mean-pool-normalized:v1",
      retrieval_mode: "hybrid",
    });
    await expect(client.findSteps({
      query: "continuity assumption",
      workspace_id: WORKSPACE_ID,
    })).resolves.toMatchObject({
      embedding_model: null,
      retrieval_mode: "lexical_fallback",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/steps/search?query=Cauchy-Schwarz&objective_id=${OBJECTIVE_ID}&strategy_id=${STRATEGY_ID}&branch_id=${BRANCH_ID}&status=active&top_k=7`,
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/steps/search?query=continuity+assumption&top_k=10`,
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });

  it("loads the workspace decision inbox and resolves with a typed human outcome", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(success({
        decisions: [pendingDecision()],
        workspace_id: WORKSPACE_ID,
      }))
      .mockResolvedValueOnce(success({
        decision_id: DECISION_ID,
        decision_revision: 4,
        resolution_outcome: "redirected",
        resolved_at: TIMESTAMP,
        status: "resolved",
      }));

    const client = api();
    await expect(client.listPendingDecisions(WORKSPACE_ID)).resolves.toMatchObject({
      decisions: [{ ancestry: { branch_id: BRANCH_ID }, decision: { id: DECISION_ID } }],
      workspace_id: WORKSPACE_ID,
    });
    await expect(client.resolveDecision(DECISION_ID, {
      expected_decision_revision: 3,
      idempotency_key: "decision-resolve-001",
      resolution_markdown: "Try the invariant route instead.",
      resolution_outcome: "redirected",
    })).resolves.toMatchObject({
      decision_id: DECISION_ID,
      resolution_outcome: "redirected",
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/decisions/pending`,
      `${config.apiUrl}/decisions/${DECISION_ID}/resolve`,
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET" });
    const resolveOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(resolveOptions.body as string)).toEqual({
      expected_decision_revision: 3,
      idempotency_key: "decision-resolve-001",
      resolution_markdown: "Try the invariant route instead.",
      resolution_outcome: "redirected",
    });
  });
});

describe("LemmaApi direct context upload", () => {
  it("uploads small files through Storage, then finalizes the same API endpoint with JSON", async () => {
    const file = contextFile(1_024, "application/pdf", "Proof sketch.pdf");
    const reference = await storageReference();

    await expect(api().uploadContext(WORKSPACE_ID, contextFields(file))).resolves.toMatchObject({
      id: reference.contextId,
      objective_id: null,
      revision: 1,
      workspace_id: WORKSPACE_ID,
    });

    const storagePath = reference.storagePath;
    expect(mocks.storageFrom).toHaveBeenCalledWith("workspace-context");
    expect(mocks.storageList).toHaveBeenCalledWith(
      `${USER_ID}/${WORKSPACE_ID}/${reference.contextId}`,
      { limit: 100, search: "context" },
    );
    expect(mocks.storageUpload).toHaveBeenCalledWith(
      storagePath,
      file,
      expect.objectContaining({
        contentType: "application/pdf",
        metadata: { lemma_context_fingerprint: expect.any(String) },
        upsert: false,
      }),
    );
    expect(mocks.createStorageClient).toHaveBeenCalledWith(ACCESS_TOKEN, undefined);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      `${config.apiUrl}/workspaces/${WORKSPACE_ID}/context/file`,
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(request.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(request.body as string)).toEqual({
      author_type: "human",
      idempotency_key: IDEMPOTENCY_KEY,
      kind: "pdf",
      metadata: {
        origin: "dialog",
        original_file_name: "Proof sketch.pdf",
      },
      mime_type: "application/pdf",
      scope: "workspace",
      size_bytes: 1_024,
      storage_bucket: "workspace-context",
      storage_path: storagePath,
      title: "Proof context",
      workspace_id: WORKSPACE_ID,
    });
  });

  it("uses a direct-host TUS upload with six-mebibyte chunks for larger files", async () => {
    const file = contextFile(STANDARD_UPLOAD_MAX_BYTES + 1, "image/png", "diagram.png");
    const reference = await storageReference();

    await api().uploadContext(WORKSPACE_ID, contextFields(file));

    const storagePath = reference.storagePath;
    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(mocks.tusUploads).toHaveLength(1);
    const options = mocks.tusUploads[0]?.options;
    const fingerprint = options?.fingerprint as (() => Promise<string>) | undefined;
    expect(options).toMatchObject({
      chunkSize: RESUMABLE_UPLOAD_CHUNK_BYTES,
      endpoint: resumableUploadEndpoint(config.supabaseUrl),
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        apikey: config.supabasePublishableKey,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "workspace-context",
        contentType: "image/png",
        metadata: expect.stringMatching(/^\{"lemma_context_fingerprint":"[a-f0-9]{64}"\}$/u),
        objectName: storagePath,
      },
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: true,
      uploadDataDuringCreation: true,
    });
    const tusMetadata = options?.metadata as { metadata?: string } | undefined;
    const fingerprintMetadata = tusMetadata?.metadata === undefined
      ? undefined
      : JSON.parse(tusMetadata.metadata) as { lemma_context_fingerprint?: unknown };
    expect(fingerprintMetadata?.lemma_context_fingerprint).toEqual(expect.any(String));
    await expect(fingerprint?.()).resolves.toBe(
      `lemma-context:${storagePath}:${fingerprintMetadata?.lemma_context_fingerprint}`,
    );
  });

  it("resumes a prior TUS upload for the same immutable object path", async () => {
    const previousUpload = { uploadUrl: "https://project.storage.supabase.co/resumable/previous" };
    mocks.setPreviousUploads([previousUpload]);

    await api().uploadContext(
      WORKSPACE_ID,
      contextFields(contextFile(STANDARD_UPLOAD_MAX_BYTES + 1, "image/png", "diagram.png")),
    );

    const upload = mocks.tusUploads[0]?.upload as {
      findPreviousUploads: ReturnType<typeof vi.fn>;
      resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
    };
    expect(upload.findPreviousUploads).toHaveBeenCalledOnce();
    expect(upload.resumeFromPreviousUpload).toHaveBeenCalledWith(previousUpload);
  });

  it("aborts an in-flight TUS upload without finalizing metadata", async () => {
    mocks.setOnTusStart(undefined);
    const controller = new AbortController();
    const file = contextFile(STANDARD_UPLOAD_MAX_BYTES + 1, "image/webp", "branch.webp");
    const uploadPromise = api().uploadContext(WORKSPACE_ID, contextFields(file), controller.signal);

    await waitFor(() => expect(mocks.tusUploads).toHaveLength(1));
    controller.abort();

    await expect(uploadPromise).rejects.toMatchObject({ name: "AbortError" });
    const upload = mocks.tusUploads[0]?.upload as { abort: ReturnType<typeof vi.fn> };
    expect(upload.abort).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes the uploaded object if metadata finalization fails and preserves that error", async () => {
    const finalizationError = new Response(JSON.stringify({
      error: { code: "REVISION_CONFLICT", message: "The graph changed." },
      ok: false,
    }), { status: 409 });
    vi.stubGlobal("fetch", vi.fn(async () => finalizationError));
    mocks.storageRemove.mockResolvedValue({ data: null, error: new Error("Storage cleanup failed") });
    const file = contextFile(1_024, "image/jpeg", "proof.jpg");
    const reference = await storageReference();

    await expect(api().uploadContext(WORKSPACE_ID, contextFields(file))).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      message: "The graph changed.",
    });

    expect(mocks.storageRemove).toHaveBeenCalledWith([
      reference.storagePath,
    ]);
    expect(mocks.createStorageClient).toHaveBeenLastCalledWith(ACCESS_TOKEN);
  });

  it("reuses a verified immutable object on retry and never removes that preexisting object", async () => {
    const file = contextFile(1_024, "image/png", "diagram.png");
    await api().uploadContext(WORKSPACE_ID, contextFields(file));

    const initialUpload = mocks.storageUpload.mock.calls[0]?.[2] as {
      metadata?: { lemma_context_fingerprint?: unknown };
    } | undefined;
    const fingerprint = initialUpload?.metadata?.lemma_context_fingerprint;
    expect(fingerprint).toEqual(expect.any(String));

    mocks.storageUpload.mockClear();
    mocks.storageRemove.mockClear();
    mocks.storageList.mockResolvedValue({
      data: [{
        metadata: {
          mimetype: file.type,
          size: file.size,
          user_metadata: { lemma_context_fingerprint: fingerprint },
        },
        name: "context",
      }],
      error: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: { code: "REVISION_CONFLICT", message: "The graph changed." },
      ok: false,
    }), { status: 409 })));

    await expect(api().uploadContext(WORKSPACE_ID, contextFields(file))).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });

    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(mocks.storageRemove).not.toHaveBeenCalled();
  });

  it("rejects a different payload reused with the same idempotency key before Storage can overwrite it", async () => {
    const originalFile = contextFile(1_024, "image/png", "diagram.png", 0);
    await api().uploadContext(WORKSPACE_ID, contextFields(originalFile));

    const initialUpload = mocks.storageUpload.mock.calls[0]?.[2] as {
      metadata?: { lemma_context_fingerprint?: unknown };
    } | undefined;
    const fingerprint = initialUpload?.metadata?.lemma_context_fingerprint;
    expect(fingerprint).toEqual(expect.any(String));

    mocks.storageUpload.mockClear();
    vi.mocked(fetch).mockClear();
    mocks.storageList.mockResolvedValue({
      data: [{
        metadata: {
          mimetype: originalFile.type,
          size: originalFile.size,
          user_metadata: { lemma_context_fingerprint: fingerprint },
        },
        name: "context",
      }],
      error: null,
    });
    const changedFile = contextFile(1_024, "image/png", "diagram.png", 1);

    await expect(api().uploadContext(WORKSPACE_ID, contextFields(changedFile))).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });

    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects unsupported media and oversized files before touching Storage", async () => {
    await expect(api().uploadContext(WORKSPACE_ID, contextFields(contextFile(1, "text/plain", "notes.txt"))))
      .rejects
      .toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE", status: 415 });
    await expect(api().uploadContext(
      WORKSPACE_ID,
      contextFields({ name: "large.pdf", size: MAX_CONTEXT_FILE_BYTES + 1, type: "application/pdf" } as File),
    )).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", status: 413 });

    expect(mocks.storageUpload).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("context upload path helpers", () => {
  it("derives a stable context UUID and path that are namespaced by workspace", async () => {
    const first = await storageReference();
    const retry = await storageReference();
    const otherWorkspace = await storageReference(
      "77777777-7777-4777-8777-777777777777",
    );

    expect(retry).toEqual(first);
    expect(first.contextId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(first.storagePath).toBe(`${USER_ID}/${WORKSPACE_ID}/${first.contextId}/context`);
    expect(otherWorkspace.contextId).not.toBe(first.contextId);
    expect(otherWorkspace.storagePath).not.toBe(first.storagePath);
  });

  it("sanitizes file names and uses a direct Storage host for hosted projects", () => {
    expect(safeFileName("../../café proof?.pdf")).toBe("_.._cafe__proof_.pdf");
    expect(resumableUploadEndpoint("https://project-ref.supabase.co/")).toBe(
      "https://project-ref.storage.supabase.co/storage/v1/upload/resumable",
    );
    expect(resumableUploadEndpoint("http://127.0.0.1:54321")).toBe(
      "http://127.0.0.1:54321/storage/v1/upload/resumable",
    );
  });
});
