import type { ActivityEvent } from "@lemma/contracts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type WorkspaceRealtimeChannel,
  type WorkspaceRealtimeClient,
  type WorkspaceRealtimeSubscribeStatus,
  useWorkspaceRealtime,
} from "./useWorkspaceRealtime";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_ID_A = "40000000-0000-4000-8000-000000000001";
const EVENT_ID_B = "40000000-0000-4000-8000-000000000002";
const EVENT_ID_C = "40000000-0000-4000-8000-000000000003";
const ENTITY_ID = "50000000-0000-4000-8000-000000000001";
const TIMESTAMP = "2026-09-02T10:00:00.000Z";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let reject: Deferred<T>["reject"] = () => undefined;
  let resolve: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function activityEvent(id: string, workspaceId = WORKSPACE_ID): ActivityEvent {
  return {
    actor_agent_name: "Proof agent",
    actor_type: "agent",
    actor_user_id: null,
    created_at: TIMESTAMP,
    details: {},
    entity_id: ENTITY_ID,
    entity_revision: 1,
    entity_type: "steps",
    event_type: "created",
    id,
    objective_id: null,
    workspace_id: workspaceId,
  };
}

function createRealtimeHarness() {
  const channels: WorkspaceRealtimeChannel[] = [];
  const eventCallbacks: Array<((payload: { new: unknown }) => void) | undefined> = [];
  const statusCallbacks: Array<(
    (status: WorkspaceRealtimeSubscribeStatus, error?: Error) => void
  ) | undefined> = [];
  const on = vi.fn();
  const subscribe = vi.fn();
  const removeChannel = vi.fn(async () => undefined);
  const client: WorkspaceRealtimeClient = {
    channel: vi.fn(() => {
      const channelIndex = channels.length;
      const channel: WorkspaceRealtimeChannel = {
        on(type, filter, callback) {
          on(type, filter, callback);
          eventCallbacks[channelIndex] = callback;
          return channel;
        },
        subscribe(callback) {
          subscribe(callback);
          statusCallbacks[channelIndex] = callback;
          return channel;
        },
      };
      channels.push(channel);
      return channel;
    }),
    removeChannel,
  };

  return {
    get channel() {
      const channel = channels[0];
      if (!channel) throw new Error("Expected the harness to have created a channel.");
      return channel;
    },
    client,
    emit(event: unknown, channelIndex = channels.length - 1) {
      eventCallbacks[channelIndex]?.({ new: event });
    },
    on,
    removeChannel,
    sendStatus(status: WorkspaceRealtimeSubscribeStatus, error?: Error, channelIndex = channels.length - 1) {
      statusCallbacks[channelIndex]?.(status, error);
    },
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

afterEach(() => {
  cleanup();
  setOnline(true);
  setVisibility("visible");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useWorkspaceRealtime", () => {
  it("subscribes only to the workspace activity INSERT stream and reconciles after subscribing", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    const { result } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    expect(realtime.client.channel).toHaveBeenCalledWith(expect.stringMatching(
      new RegExp(`^lemma:workspace:${WORKSPACE_ID}:activity:[0-9a-f-]+$`),
    ));
    expect(realtime.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "INSERT",
        filter: `workspace_id=eq.${WORKSPACE_ID}`,
        schema: "public",
        table: "activity_events",
      },
      expect.any(Function),
    );
    expect(result.current.status).toBe("connecting");

    act(() => {
      realtime.sendStatus("SUBSCRIBED");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe("live");
    expect(onInvalidate).toHaveBeenCalledWith({
      activityEvents: [],
      reconcile: true,
      reasons: ["subscribed"],
      signal: expect.any(AbortSignal),
    });
  });

  it("validates, scopes, deduplicates, and batches activity events before invalidating", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => {
      realtime.emit({ id: "not-a-row" });
      realtime.emit(activityEvent(EVENT_ID_A, OTHER_WORKSPACE_ID));
      realtime.emit(activityEvent(EVENT_ID_A));
      realtime.emit(activityEvent(EVENT_ID_A));
      realtime.emit(activityEvent(EVENT_ID_B));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith({
      activityEvents: [activityEvent(EVENT_ID_A), activityEvent(EVENT_ID_B)],
      reconcile: false,
      reasons: [],
      signal: expect.any(AbortSignal),
    });
  });

  it("runs at most one canonical refresh at a time and drains later events in a trailing run", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const firstRefresh = deferred<void>();
    const onInvalidate = vi
      .fn<() => Promise<void> | void>()
      .mockImplementationOnce(() => firstRefresh.promise);
    renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => {
      realtime.emit(activityEvent(EVENT_ID_A));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [activityEvent(EVENT_ID_A)],
      reconcile: false,
      reasons: [],
      signal: expect.any(AbortSignal),
    });

    act(() => {
      realtime.emit(activityEvent(EVENT_ID_B));
      realtime.emit(activityEvent(EVENT_ID_C));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstRefresh.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [activityEvent(EVENT_ID_B), activityEvent(EVENT_ID_C)],
      reconcile: false,
      reasons: [],
      signal: expect.any(AbortSignal),
    });
  });

  it("reconciles after reconnect, browser online, and visibility regain while reporting connection state", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    const { result } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => {
      realtime.sendStatus("CHANNEL_ERROR", new Error("socket dropped"));
    });
    expect(result.current.status).toBe("degraded");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);

    act(() => {
      realtime.sendStatus("SUBSCRIBED");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("live");

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current.status).toBe("connecting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      setVisibility("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onInvalidate.mock.calls.map(([invalidation]) => invalidation.reasons)).toEqual([
      ["subscribed"],
      ["online"],
      ["visible"],
    ]);
  });

  it("recreates a terminal channel with backoff and reconciles after resubscribing", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    const { result } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));
    const firstTopic = vi.mocked(realtime.client.channel).mock.calls[0]?.[0];

    act(() => realtime.sendStatus("CLOSED"));
    expect(result.current.status).toBe("degraded");
    expect(realtime.removeChannel).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(realtime.client.channel).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);
    expect(vi.mocked(realtime.client.channel).mock.calls[1]?.[0]).not.toBe(firstTopic);
    expect(result.current.status).toBe("connecting");

    act(() => realtime.sendStatus("SUBSCRIBED"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("live");
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [],
      reconcile: true,
      reasons: ["subscribed"],
      signal: expect.any(AbortSignal),
    });
  });

  it("ignores late events and statuses from a channel that has been replaced", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    const { result } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => realtime.sendStatus("CLOSED", undefined, 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => realtime.sendStatus("SUBSCRIBED", undefined, 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("live");
    onInvalidate.mockClear();

    act(() => {
      realtime.emit(activityEvent(EVENT_ID_A), 0);
      realtime.sendStatus("CHANNEL_ERROR", new Error("late old-channel error"), 0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.status).toBe("live");
    expect(realtime.client.channel).toHaveBeenCalledTimes(2);
    expect(onInvalidate).not.toHaveBeenCalled();

    act(() => realtime.emit(activityEvent(EVENT_ID_B), 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(onInvalidate).toHaveBeenCalledOnce();
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [activityEvent(EVENT_ID_B)],
      reconcile: false,
      reasons: [],
      signal: expect.any(AbortSignal),
    });
  });

  it("cancels a scheduled channel recreation on cleanup", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const { unmount } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate: vi.fn(),
      workspaceId: WORKSPACE_ID,
    }));

    act(() => realtime.sendStatus("TIMED_OUT"));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(realtime.client.channel).toHaveBeenCalledTimes(1);
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("retries a failed canonical reconciliation with bounded backoff", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary API failure"))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => realtime.sendStatus("SUBSCRIBED"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.status).toBe("degraded");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [],
      reconcile: true,
      reasons: ["subscribed"],
      signal: expect.any(AbortSignal),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenLastCalledWith({
      activityEvents: [],
      reconcile: true,
      reasons: ["retry"],
      signal: expect.any(AbortSignal),
    });
    expect(result.current.status).toBe("live");
  });

  it("uses a fresh topic when remounting before asynchronous channel removal finishes", () => {
    const removal = deferred<void>();
    const retainedTopics = new Set<string>();
    const channelTopics = new Map<WorkspaceRealtimeChannel, string>();
    const client: WorkspaceRealtimeClient = {
      channel: vi.fn((name: string) => {
        if (retainedTopics.has(name)) throw new Error(`channel ${name} is still tearing down`);
        const channel: WorkspaceRealtimeChannel = {
          on: vi.fn(() => channel),
          subscribe: vi.fn(() => channel),
        };
        retainedTopics.add(name);
        channelTopics.set(channel, name);
        return channel;
      }),
      removeChannel: vi.fn(async (channel: WorkspaceRealtimeChannel) => {
        await removal.promise;
        const name = channelTopics.get(channel);
        if (name) retainedTopics.delete(name);
      }),
    };

    const first = renderHook(() => useWorkspaceRealtime({
      client,
      onInvalidate: vi.fn(),
      workspaceId: WORKSPACE_ID,
    }));
    first.unmount();

    const second = renderHook(() => useWorkspaceRealtime({
      client,
      onInvalidate: vi.fn(),
      workspaceId: WORKSPACE_ID,
    }));

    const topicCalls = vi.mocked(client.channel).mock.calls.map(([name]) => name);
    expect(topicCalls).toHaveLength(2);
    expect(topicCalls[1]).not.toBe(topicCalls[0]);
    expect(second.result.current.status).toBe("connecting");

    second.unmount();
    removal.resolve();
  });

  it("cancels pending work and removes the exact channel on cleanup", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const onInvalidate = vi.fn();
    const { unmount } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => {
      realtime.emit(activityEvent(EVENT_ID_A));
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      realtime.emit(activityEvent(EVENT_ID_B));
    });

    expect(onInvalidate).not.toHaveBeenCalled();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });

  it("aborts an in-flight canonical refresh when the workspace subscription unmounts", async () => {
    vi.useFakeTimers();
    const realtime = createRealtimeHarness();
    const refresh = deferred<void>();
    let refreshSignal: AbortSignal | undefined;
    const onInvalidate = vi.fn((invalidation: { signal: AbortSignal }) => {
      refreshSignal = invalidation.signal;
      return refresh.promise;
    });
    const { unmount } = renderHook(() => useWorkspaceRealtime({
      client: realtime.client,
      onInvalidate,
      workspaceId: WORKSPACE_ID,
    }));

    act(() => realtime.emit(activityEvent(EVENT_ID_A)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(refreshSignal?.aborted).toBe(false);

    unmount();

    expect(refreshSignal?.aborted).toBe(true);
    refresh.resolve();
  });
});
