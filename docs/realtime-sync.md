# Supabase Realtime workspace sync

Lemma uses `public.activity_events` as a bounded invalidation stream. Every committed graph mutation already records one or more immutable activity rows in the same transaction, so the browser can listen to one table and then refetch the normal, authorized API snapshot.

```text
graph RPC commits
  -> activity_events INSERT
  -> authenticated Realtime subscription (workspace_id filter)
  -> validated + debounced invalidation
  -> canonical lemma-api refetch
  -> React graph update without changing the user's selection
```

The migration `20260902113737_activity_events_realtime_assumption_revision.sql` adds only `public.activity_events` to the `supabase_realtime` publication. The existing owner-only SELECT policy remains the authorization boundary. Mutable graph tables are not published, the client never receives a service-role key, and Realtime payloads are never treated as canonical graph state.

Supabase recommends Broadcast for larger-scale database subscriptions. Postgres Changes is intentional here: the challenge demo has five same-owner tabs, the activity stream already exists transactionally, and this avoids a second trigger/topic authorization system. Reassess Broadcast before expanding to multi-user collaboration or sustained high write/subscriber counts.

## Delivery and concurrency behavior

- INSERT events are filtered server-side by `workspace_id` and validated again with the shared Zod `activityEventSchema`.
- A 200 ms fixed debounce window coalesces transaction bursts. Duplicate event IDs are ignored.
- Only one canonical refresh runs at a time. Events received during it cause one trailing refresh, so updates are not lost and requests cannot pile up.
- A failed canonical refresh enters `degraded` state and retries a full reconciliation with bounded exponential backoff; an online, visible, or resubscribed transition retries immediately.
- Each hook mount uses a unique channel topic, avoiding reuse while Supabase is still tearing down an earlier StrictMode or navigation subscription.
- A terminal channel error, timeout, or close removes that channel and creates a fresh uniquely named subscription with bounded backoff; cleanup cancels the pending recreation.
- `SUBSCRIBED`, browser-online, and visible-tab transitions force reconciliation because Postgres Changes is a live stream, not a replay log.
- The selected strategy, branch, and step remain stable when they still exist. Remote events never navigate or display an agent-action toast in another tab.
- The manual refresh button remains available. The top bar reports `live`, `connecting`, `degraded`, or `offline` state.
- Overview, pending-decision, graph, and sidebar requests have stale-response guards so an older request cannot overwrite a newer snapshot.
- Objective, step, new-step, assumption, and result dialogs retain the revision present when they opened. If Realtime reveals a newer revision, Lemma preserves the local draft, shows a conflict, and disables saving until the dialog is reopened.
- `mark_assumption` now verifies `expected_step_revision` under the same database row lock as the mutation, closing the former API-preflight race.

## Deployment verification

Use an expand/deploy/contract rollout so neither a still-running Edge instance nor the new client sees a missing RPC signature:

1. Apply `20260902113737_activity_events_realtime_assumption_revision.sql`. It adds the revision-checked RPC and temporarily retains the former signature as a safe wrapper.
2. Deploy the updated `lemma-api` Edge Function, which sends `expected_step_revision`.
3. Deploy the web bundle.
4. After old Edge instances have drained and the rollout is verified, create a later contract migration that revokes and drops only `public.mark_assumption(uuid,text,text,text,text,text,text,text,text)`.

The compatibility wrapper prevents RPC-not-found downtime and still performs its own locked revision check, but an old Edge instance cannot pass the revision captured by the browser. Keep the interval between steps 1 and 2 short; full stale-draft protection is active once the updated `lemma-api` is serving requests.

Do not include that contract migration in the same database rollout as the expand migration. Then verify publication membership with a read-only query:

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename = 'activity_events';
```

The query should return exactly `public.activity_events`. A signed-in owner should see `Live sync on` after opening a workspace. A different account must not receive that workspace's events because the existing RLS policy checks workspace ownership.

## Five-agent demo setup

Use the same authenticated account in five tabs and assign a presentation-only WebMCP provenance label through the URL:

```text
?agent=Algebra%20Agent%201
?agent=Geometry%20Agent%202
?agent=Invariant%20Agent%203
?agent=Contradiction%20Agent%204
?agent=Combinatorics%20Agent%205
```

A valid alias is normalized, limited to 48 characters, and stored in `sessionStorage`, so it survives client-side navigation and reloads. Some browsers clone that storage when a tab is duplicated; the explicit `?agent=` value wins and assigns the intended alias in each demo tab. It does not affect authentication, RLS, or permissions.

For the demo, give each agent a different strategy ID but keep every tab on the same workspace/objective view. As agents append steps, all tabs reconcile automatically and the five strategy paths progress without pressing refresh.
