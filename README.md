# Lemma

Lemma is an IDE-like reasoning workspace where humans and AI agents work on the same inspectable mathematical graph. The visual workspace is the human interface, WebMCP is the agent interface, and both use the same authenticated Supabase Edge API and Postgres reasoning graph.

## MVP capabilities

- Email/password registration and sign-in with Supabase Auth.
- A searchable library of empty workspace shells that can contain multiple independent objectives.
- Workspace-general and objective-specific text, link, private PDF, and private image context.
- Objective-scoped strategies with lineage-preserving branches and Markdown + TeX reasoning steps.
- Optimistic revisions, idempotent graph mutations, authorship, provenance, activity, assumptions, explicit dependency/source inspection, atomic step creation with known prerequisites, and non-destructive dead ends.
- Human intervention and decision resolution that remain visible to agents.
- Structural branch comparison and clean-solution projection without deleting history.
- Atomic branch/strategy completion plus editable successful, unsuccessful, or inconclusive results per strategy or branch.
- Workspace-scoped hybrid step retrieval, optionally narrowed to one objective, backed by Postgres full-text search and pgvector.
- Authenticated Supabase Realtime invalidation with canonical API reconciliation, reconnect recovery, and a manual-refresh fallback.
- Twenty-two top-level imperative WebMCP tools with shared Zod schemas, per-tab agent provenance, cancellation, safe cleanup, and immediate UI refresh/highlighting.

## Architecture

```text
apps/
  web/          React 19 + Vite client with declarative React Router routes
packages/
  contracts/    Canonical Zod schemas, inferred types, API and WebMCP contracts
supabase/
  functions/    Authenticated `lemma-api` Edge Function
  migrations/   Relational graph, RLS, RPCs, search, and additive fixes
  tests/        Database invariant and security fixtures
```

All graph writes go through the versioned `/api/v1` routes in `lemma-api`. Each request carries the user's access token and the function creates a caller-scoped Supabase client, so RLS remains authoritative. The function never uses a service-role key. Transactional graph invariants remain in the existing Postgres RPCs rather than being reimplemented in the Edge runtime.

The browser uses Supabase directly for authentication and private Storage uploads. Files of 6 MiB or less use a standard immutable upload; larger files use resumable TUS uploads in 6 MiB chunks. The Edge API then validates and records the uploaded object's metadata. Upload identity and path are stable across retries; if metadata finalization fails after a newly-created upload, the browser attempts to remove the orphaned object.

The web client keeps reusable UI in `src/components`, while `src/pages/auth`, `src/pages/dashboard`, and `src/pages/workspace` own each page's components, hooks, tests, and page-specific graph helpers. Cross-cutting hooks and clients remain in `src/hooks` and `src/lib`.

Routing uses React Router only in declarative library mode (`BrowserRouter`, `Routes`, and `Route`), without framework loaders, actions, or `RouterProvider`. The route surface is `/`, `/workspaces/:workspaceId`, and `/workspaces/:workspaceId/objectives/:objectiveId`; unknown authenticated routes return to the dashboard. Authentication remains above the route switch so signing in from a valid deep link opens that workspace directly.

## Local setup

Requirements: Node.js 22 or newer, pnpm 11, and the Supabase CLI. Docker is also required when running the local Supabase stack or database tests.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Fill `.env.local` with the browser-safe Supabase project URL and publishable key. `VITE_API_URL` is optional; by default the client derives `https://<project>.supabase.co/functions/v1/lemma-api/api/v1`. If this checkout still has the former `http://localhost:8787/api/v1` override, remove it or replace it with the Edge URL. The local web origin can be either `http://localhost:5173` or `http://127.0.0.1:5173`.

For a fully local stack, set `VITE_SUPABASE_URL=http://127.0.0.1:54321`, copy the publishable key reported by `supabase status` into `VITE_SUPABASE_PUBLISHABLE_KEY`, and set `VITE_API_URL=http://127.0.0.1:54321/functions/v1/lemma-api/api/v1`. Local Edge configuration lives separately so Vite never receives server-only variables:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

The local Edge runtime reaches Supabase through Docker's internal gateway, while browser access tokens name the public local Auth URL as their issuer. `LEMMA_AUTH_ISSUER` records that public issuer explicitly; hosted deployments normally omit it and derive the issuer from `SUPABASE_URL`.

Then run the local stack and function in one terminal:

```bash
supabase start
pnpm edge:serve
```

Run `pnpm dev` in another terminal.

The function reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` supplied by Supabase plus the comma-separated `WEB_ORIGIN` allowlist from `supabase/functions/.env`. Its gateway JWT check is deliberately disabled in `supabase/config.toml`: the handler verifies every non-public Bearer token itself so authentication failures retain Lemma's stable JSON error envelope. Only `/api/v1/health` and CORS preflight are public.

Before deploying the web client, apply the database migrations and deploy the function:

```bash
supabase db push
supabase gen types typescript --linked > supabase/database.types.ts
supabase secrets set 'WEB_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,https://your-web-origin.example'
supabase functions deploy lemma-api --no-verify-jwt --use-api
```

Replace the example production origin before running the secret command. To verify a hosted deployment independently of the browser, send the same preflight request the browser uses:

```bash
curl -i -X OPTIONS 'https://<project-ref>.supabase.co/functions/v1/lemma-api/api/v1/workspaces' \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,apikey,content-type'
```

The expected response is `204` and includes `Access-Control-Allow-Origin: http://localhost:5173`. A gateway `404` with `sb-error-code: NOT_FOUND` means the function has not been deployed to that project; a gateway `401` means it was deployed with JWT verification enabled and must be redeployed with `--no-verify-jwt` because Lemma performs the token verification inside the handler.

Storage uploads use the private `workspace-context` bucket and are opened through short-lived signed URLs returned by the Edge API. Deploy in the order shown above so the aggregate graph RPC exists before the new function receives traffic.

## Quality commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:test
```

The database tests require a running local Supabase stack. Application and WebMCP tests do not require an authenticated remote user.

## WebMCP surface

The top-level page imperatively registers:

```text
get_skill
get_workspace
list_objectives
get_objective
create_objective
update_objective
get_context
create_context
list_strategies
create_strategy
create_step
create_step_dependency
update_step
branch_from_step
mark_assumption
mark_dead_end
mark_end
set_reasoning_result
find_steps
compare_branches
request_human_decision
generate_clean_solution
```

Agents should call `get_skill` first in each new session. It returns trusted, versioned instructions for reading and changing Lemma's reasoning graph. Tool inputs are narrow JSON Schemas generated from the same Zod contracts used by the API. Mutations overwrite caller-provided authorship with agent provenance, validate server responses, forward invocation cancellation, refresh the shared graph after a commit, and use one `AbortController` to unregister cleanly.

The Vite development server and Edge API emit `Origin-Agent-Cluster: ?1`, which current WebMCP discovery requires. A production web host must preserve that header, serve `index.html` as the fallback for client-side deep links, and support a browser with WebMCP enabled. Without WebMCP, the application remains fully usable in human mode.

For the multi-agent demo, Realtime subscribes only to owner-authorized `activity_events` inserts for the open workspace. Notifications are validated and coalesced, then the UI refetches the canonical API snapshot instead of guessing which related rows changed. See [docs/realtime-sync.md](docs/realtime-sync.md) for the deployment check, failure behavior, and per-tab `?agent=` aliases.

## Security model

- Every Data API table has RLS and workspace-owner policies.
- The Edge API uses a publishable/anon key plus the caller's verified bearer token, never a privileged service-role key.
- Uploaded files are private, size- and MIME-bounded, stored under user/workspace-scoped immutable paths, and cleaned up when metadata creation fails.
- Markdown is rendered without raw HTML, `dangerouslySetInnerHTML`, `rehype-raw`, or trusted KaTeX commands.
- Structural questions traverse explicit relations; semantic retrieval never invents graph edges.
