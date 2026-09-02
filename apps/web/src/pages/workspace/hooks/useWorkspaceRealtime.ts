import {
  activityEventSchema,
  uuidSchema,
  type ActivityEvent,
} from "@lemma/contracts";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../lib/supabase";

/** The connection state that can be surfaced without exposing transport details. */
export type WorkspaceRealtimeStatus = "connecting" | "live" | "degraded" | "offline";

export type WorkspaceRealtimeReconcileReason = "subscribed" | "online" | "visible" | "retry";

/**
 * A canonical-state invalidation. Consumers must refetch through the normal API
 * instead of attempting to patch graph state from a Realtime payload.
 */
export interface WorkspaceRealtimeInvalidation {
  activityEvents: readonly ActivityEvent[];
  reconcile: boolean;
  reasons: readonly WorkspaceRealtimeReconcileReason[];
  signal: AbortSignal;
}

interface ActivityEventsInsertFilter {
  event: "INSERT";
  filter: string;
  schema: "public";
  table: "activity_events";
}

interface ActivityEventsInsertPayload {
  new: unknown;
}

export type WorkspaceRealtimeSubscribeStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR";

/**
 * The deliberately small client surface this hook needs. Keeping it structural
 * lets the production singleton and focused tests share the same behavior.
 */
export interface WorkspaceRealtimeChannel {
  on(
    type: "postgres_changes",
    filter: ActivityEventsInsertFilter,
    callback: (payload: ActivityEventsInsertPayload) => void,
  ): WorkspaceRealtimeChannel;
  subscribe(
    callback?: (status: WorkspaceRealtimeSubscribeStatus, error?: Error) => void,
  ): WorkspaceRealtimeChannel;
}

export interface WorkspaceRealtimeClient {
  channel(name: string): WorkspaceRealtimeChannel;
  removeChannel(channel: WorkspaceRealtimeChannel): Promise<unknown>;
}

export interface UseWorkspaceRealtimeOptions {
  /** Injectable solely for tests; production uses the authenticated browser singleton. */
  client?: WorkspaceRealtimeClient;
  /** Kept bounded so a busy agent run cannot indefinitely postpone reconciliation. */
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onInvalidate: (invalidation: WorkspaceRealtimeInvalidation) => Promise<void> | void;
  workspaceId: string | null;
}

export interface UseWorkspaceRealtimeResult {
  status: WorkspaceRealtimeStatus;
}

const DEFAULT_DEBOUNCE_MS = 200;
const MAX_DEBOUNCE_MS = 1_000;
const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

const defaultClient = supabase as unknown as WorkspaceRealtimeClient;

function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function normalizedDebounce(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DEBOUNCE_MS;
  return Math.min(MAX_DEBOUNCE_MS, Math.max(0, Math.floor(value)));
}

/**
 * Subscribe to the workspace's immutable activity stream and turn notifications
 * into serialized canonical-state refetches. The activity event is intentionally
 * never applied as a partial graph update: one database mutation can affect many
 * graph records, while the ordinary API is the source of truth for the UI.
 */
export function useWorkspaceRealtime({
  client,
  debounceMs,
  onError,
  onInvalidate,
  workspaceId,
}: UseWorkspaceRealtimeOptions): UseWorkspaceRealtimeResult {
  const [status, setStatus] = useState<WorkspaceRealtimeStatus>(() => (
    workspaceId === null || !isBrowserOnline() ? "offline" : "connecting"
  ));
  const onInvalidateRef = useRef(onInvalidate);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const realtimeClient = client ?? defaultClient;
  const debounceDelay = normalizedDebounce(debounceMs);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    let running = false;
    let runAgain = false;
    let channelSubscribed = false;
    let channel: WorkspaceRealtimeChannel | undefined;
    let channelGeneration = 0;
    let channelReconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let channelReconnectAttempt = 0;
    let invalidationController: AbortController | undefined;
    const queuedEvents = new Map<string, ActivityEvent>();
    const reconcileReasons = new Set<WorkspaceRealtimeReconcileReason>();
    const parsedWorkspaceId = workspaceId === null ? null : uuidSchema.safeParse(workspaceId);

    const isCurrent = () => active;
    const setCurrentStatus = (nextStatus: WorkspaceRealtimeStatus) => {
      if (isCurrent()) setStatus(nextStatus);
    };
    const reportError = (error: unknown) => {
      if (!isCurrent()) return;
      try {
        onErrorRef.current?.(error);
      } catch {
        // Error reporting must never destabilize the subscription or its refetch loop.
      }
    };

    const clearRetryTimer = () => {
      if (retryTimer === undefined) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const clearChannelReconnectTimer = () => {
      if (channelReconnectTimer === undefined) return;
      clearTimeout(channelReconnectTimer);
      channelReconnectTimer = undefined;
    };

    const scheduleRetry = () => {
      if (!isCurrent() || !isBrowserOnline() || retryTimer !== undefined) return;
      const retryDelay = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * (2 ** retryAttempt));
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!isCurrent()) return;
        if (!isBrowserOnline()) {
          setCurrentStatus("offline");
          return;
        }
        void runInvalidation();
      }, retryDelay);
    };

    const runInvalidation = async () => {
      if (!isCurrent()) return;
      if (running) {
        runAgain = true;
        return;
      }

      running = true;
      try {
        do {
          runAgain = false;
          const activityEvents = [...queuedEvents.values()];
          const reasons = [...reconcileReasons.values()];
          const reconcile = reasons.length > 0;
          queuedEvents.clear();
          reconcileReasons.clear();

          if (activityEvents.length === 0 && !reconcile) break;

          const controller = new AbortController();
          invalidationController = controller;
          try {
            await onInvalidateRef.current({
              activityEvents,
              reconcile,
              reasons,
              signal: controller.signal,
            });
            if (isCurrent()) {
              clearRetryTimer();
              retryAttempt = 0;
              if (channelSubscribed && isBrowserOnline()) setCurrentStatus("live");
            }
          } catch (error) {
            if (isCurrent()) {
              reconcileReasons.add("retry");
              setCurrentStatus(isBrowserOnline() ? "degraded" : "offline");
              reportError(error);
              scheduleRetry();
            }
          } finally {
            if (invalidationController === controller) invalidationController = undefined;
          }
        } while (isCurrent() && runAgain);
      } finally {
        running = false;
      }
    };

    const scheduleInvalidation = (immediate: boolean) => {
      if (!isCurrent()) return;
      if (!isBrowserOnline()) {
        setCurrentStatus("offline");
        return;
      }
      if (running) {
        runAgain = true;
        return;
      }
      if (timer !== undefined) {
        if (!immediate) return;
        clearTimeout(timer);
        timer = undefined;
      }

      timer = setTimeout(() => {
        timer = undefined;
        void runInvalidation();
      }, immediate ? 0 : debounceDelay);
    };

    const requestReconciliation = (reason: WorkspaceRealtimeReconcileReason) => {
      if (reason !== "retry") clearRetryTimer();
      reconcileReasons.add(reason);
      scheduleInvalidation(true);
    };

    if (parsedWorkspaceId === null) {
      setCurrentStatus("offline");
      return () => {
        active = false;
      };
    }
    if (!parsedWorkspaceId.success) {
      setCurrentStatus("degraded");
      return () => {
        active = false;
      };
    }

    const activeWorkspaceId = parsedWorkspaceId.data;
    setCurrentStatus(isBrowserOnline() ? "connecting" : "offline");

    const removeRealtimeChannel = (target: WorkspaceRealtimeChannel) => {
      if (channel === target) channel = undefined;
      void realtimeClient.removeChannel(target).catch(() => undefined);
    };

    function scheduleChannelReconnect() {
      if (
        !isCurrent()
        || !isBrowserOnline()
        || channel !== undefined
        || channelReconnectTimer !== undefined
      ) return;
      const reconnectDelay = Math.min(
        MAX_RETRY_MS,
        INITIAL_RETRY_MS * (2 ** channelReconnectAttempt),
      );
      channelReconnectAttempt += 1;
      channelReconnectTimer = setTimeout(() => {
        channelReconnectTimer = undefined;
        connectChannel();
      }, reconnectDelay);
    }

    function connectChannel() {
      if (!isCurrent() || !isBrowserOnline() || channel !== undefined) return;
      clearChannelReconnectTimer();
      setCurrentStatus("connecting");
      const generation = ++channelGeneration;
      let nextChannel: WorkspaceRealtimeChannel | undefined;
      try {
        // A unique topic avoids reusing a channel whose asynchronous teardown is
        // still in progress during StrictMode remounts or rapid workspace changes.
        nextChannel = realtimeClient.channel(
          `lemma:workspace:${activeWorkspaceId}:activity:${crypto.randomUUID()}`,
        );
        nextChannel = nextChannel.on(
          "postgres_changes",
          {
            event: "INSERT",
            filter: `workspace_id=eq.${activeWorkspaceId}`,
            schema: "public",
            table: "activity_events",
          },
          (payload) => {
            if (!isCurrent() || generation !== channelGeneration) return;
            const event = activityEventSchema.safeParse(payload?.new);
            if (!event.success || event.data.workspace_id !== activeWorkspaceId) return;

            queuedEvents.set(event.data.id, event.data);
            scheduleInvalidation(false);
          },
        );

        channel = nextChannel;
        let terminal = false;
        nextChannel.subscribe((subscribeStatus, error) => {
          if (!isCurrent() || generation !== channelGeneration || terminal) return;
          switch (subscribeStatus) {
            case "SUBSCRIBED":
              channelSubscribed = true;
              channelReconnectAttempt = 0;
              clearChannelReconnectTimer();
              setCurrentStatus("live");
              requestReconciliation("subscribed");
              break;
            case "CHANNEL_ERROR":
            case "TIMED_OUT":
            case "CLOSED": {
              terminal = true;
              channelSubscribed = false;
              channelGeneration += 1;
              setCurrentStatus(isBrowserOnline() ? "degraded" : "offline");
              if (subscribeStatus !== "CLOSED") {
                reportError(error ?? new Error(`Realtime subscription ${subscribeStatus.toLowerCase()}.`));
              }
              removeRealtimeChannel(nextChannel as WorkspaceRealtimeChannel);
              scheduleChannelReconnect();
              break;
            }
          }
        });
      } catch (error) {
        channelGeneration += 1;
        channelSubscribed = false;
        if (nextChannel !== undefined) removeRealtimeChannel(nextChannel);
        setCurrentStatus(isBrowserOnline() ? "degraded" : "offline");
        reportError(error);
        scheduleChannelReconnect();
      }
    }

    const handleOnline = () => {
      if (!isCurrent()) return;
      setCurrentStatus("connecting");
      requestReconciliation("online");
      if (channel === undefined) connectChannel();
    };
    const handleOffline = () => {
      if (!isCurrent()) return;
      channelSubscribed = false;
      clearRetryTimer();
      clearChannelReconnectTimer();
      retryAttempt = 0;
      reconcileReasons.delete("retry");
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      setCurrentStatus("offline");
    };
    const handleVisibilityChange = () => {
      if (!isCurrent() || typeof document === "undefined" || document.visibilityState !== "visible") {
        return;
      }
      requestReconciliation("visible");
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    connectChannel();

    return () => {
      active = false;
      channelGeneration += 1;
      if (timer !== undefined) clearTimeout(timer);
      clearRetryTimer();
      clearChannelReconnectTimer();
      invalidationController?.abort();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (channel !== undefined) {
        removeRealtimeChannel(channel);
      }
    };
  }, [debounceDelay, realtimeClient, workspaceId]);

  return { status };
}
