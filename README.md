# Lemma

Lemma is an IDE-like workspace where humans and AI agents reason over the same inspectable mathematical graph. The visual workspace is the human interface, WebMCP is the agent interface, and neither has a separate copy of the reasoning state.

**Try the app:** [https://lemma-tan.vercel.app/](https://lemma-tan.vercel.app/)

## How to use Lemma

1. Create an account, sign in, and create a workspace from the dashboard.
2. Add one or more mathematical objectives. Each objective can have its own constraints and context, while the workspace can also hold context shared by every objective.
3. Create strategies for an objective. Every strategy starts with a root branch.
4. Develop the reasoning as Markdown + TeX steps. Steps can have explicit dependencies, assumptions, sources, authorship, and status.
5. Interrupt the reasoning at any point: revise a step, branch from an earlier step, add a human idea, request a decision, or mark a path as a dead end without deleting it.
6. Compare branches, record the outcome of a strategy or branch, and generate a clean solution from the selected path while preserving the complete graph history.

The central workflow is **interrupt, branch, continue**: a human changes direction midway through a solution and an agent reads the updated workspace through WebMCP, then continues from the new state without overwriting the original path.

Mathematical content uses Markdown with inline TeX such as `$x^2 + y^2$` and display TeX such as `$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$`.

## Reasoning model

The persisted reasoning graph is the source of truth. A clean solution is only a projection of one selected branch.

| Entity | Role |
| --- | --- |
| **Workspace** | Top-level container for related mathematical work, shared context, and multiple objectives. |
| **Objective** | A precise problem or desired result, with its own constraints, context, and strategies. |
| **Context item** | Supporting text, note, link, image, PDF, or paper shared by the workspace or scoped to one objective. |
| **Strategy** | A high-level approach to an objective. An objective can keep several strategies in parallel. |
| **Branch** | One path through a strategy. It stores its parent and exact fork point so alternatives remain inspectable. |
| **Step** | A single reasoning move written in Markdown + TeX, with explicit branch membership, author, status, and revision history. |
| **Step dependency** | A directed relation between a prerequisite step and a dependent step in the same objective. |
| **Assumption** | A first-class statement that can be proposed, accepted, challenged, rejected, or discharged and linked to the steps that use it. |
| **Source** | Explicit provenance for a step, such as context, a URL, paper, book, or theorem. |
| **Decision** | A human intervention or checkpoint that an agent can request and a human can resolve. |
| **Reasoning result** | A successful, unsuccessful, or inconclusive outcome attached to a strategy or branch. |

## WebMCP tools

The top-level page registers 22 imperative WebMCP tools. Agents should call `get_skill` first in every new session to load Lemma's trusted, versioned operating instructions.

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ get_skill                  get_workspace             list_objectives          │
│ get_objective              create_objective          update_objective         │
│ get_context                create_context            list_strategies          │
│ create_strategy            create_step               create_step_dependency   │
│ update_step                branch_from_step          mark_assumption           │
│ mark_dead_end              mark_end                  set_reasoning_result      │
│ find_steps                 compare_branches          request_human_decision    │
│ generate_clean_solution                                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

All tools use narrow JSON Schemas generated from the same Zod contracts as the application API. Mutations use the signed-in session, record agent provenance, support safe retries, and refresh the same graph shown in the UI. If WebMCP is unavailable, the human interface remains fully usable.

## Stack

- **Frontend:** React 19, Vite, strict TypeScript, React Router, XYFlow, and Dagre.
- **Math rendering:** `react-markdown`, `remark-math`, and KaTeX.
- **Shared contracts:** Zod schemas in `packages/contracts`, reused by the frontend, API, and WebMCP layer.
- **Backend:** Supabase Auth, Postgres, Row Level Security, Storage, Realtime, Edge Functions, and pgvector.
- **Hosting:** Vercel for the web client and Supabase for backend services.

```text
apps/
  web/                    React + Vite client
packages/
  contracts/              Shared Zod, API, and WebMCP contracts
supabase/
  functions/lemma-api/    Authenticated /api/v1 Edge API
  functions/embed-steps/  Asynchronous embedding worker
  migrations/             Relational graph, RLS, RPCs, and retrieval
  tests/                  Database invariant and security fixtures
```

## Backend architecture

`lemma-api` is a thin, versioned Edge Function. It validates requests and responses with the shared Zod schemas, forwards the caller's Supabase session, and delegates multi-record graph mutations to transactional Postgres RPCs. Those RPCs enforce branch lineage, graph invariants, idempotency, and optimistic revisions; RLS keeps every workspace owner-scoped. The browser talks to Supabase directly only for authentication, private uploads, and authorized Realtime invalidation.

Lemma also includes a small RAG-style retrieval layer over reasoning steps. A private search document is updated after relevant graph mutations and queued through PGMQ; `pg_cron` and `pg_net` invoke the `embed-steps` Edge Function asynchronously. For the demo, both stored steps and queries use Supabase Edge Runtime's built-in **`gte-small` embedding model with 384 dimensions** (mean pooling, normalization, and cosine distance). `find_steps` combines pgvector similarity with Postgres full-text search using deterministic reciprocal rank fusion and falls back to lexical search if embedding fails.

The RAG layer is associative memory only: it can find where an idea appeared, but structural questions such as dependencies, assumptions, and branch lineage always traverse the explicit reasoning graph. See [the semantic retrieval notes](docs/semantic-step-retrieval.md) and [the database overview](docs/supabase-database.md) for implementation details.

## Installation

Requirements: Node.js 22 or newer, pnpm 11, and the Supabase CLI. Docker is also required for the local Supabase stack and database tests.

### Run the web app against a configured Supabase project

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Set the browser-safe project URL and publishable key in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

`VITE_API_URL` is optional. By default, the client derives `https://<project>.supabase.co/functions/v1/lemma-api/api/v1` from `VITE_SUPABASE_URL`.

### Run with local Supabase

Create the local Edge Function environment:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Then start the local Supabase services and the public API in one terminal:

```bash
supabase start
pnpm edge:serve
```

Use the values reported by `supabase status` in `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=your-local-publishable-key
VITE_API_URL=http://127.0.0.1:54321/functions/v1/lemma-api/api/v1
```

Run `pnpm dev` in a second terminal. Only `/api/v1/health` and CORS preflight are public; the function validates bearer tokens itself so errors keep Lemma's stable JSON envelope.

### Deploy your own backend

Apply the migrations, generate database types, configure the allowed web origin, and deploy both Edge Functions:

```bash
supabase db push
supabase gen types typescript --linked > supabase/database.types.ts
supabase secrets set 'WEB_ORIGIN=http://localhost:5173,http://127.0.0.1:5173,https://your-web-origin.example'
supabase functions deploy lemma-api --no-verify-jwt --use-api
supabase functions deploy embed-steps --no-verify-jwt --use-api
```

Replace the example origin before setting the secret. The embedding worker additionally needs the environment-specific `lemma_project_url` Vault secret described in [the retrieval runbook](docs/semantic-step-retrieval.md). No service-role key is ever exposed to Vite.

### Verify the project

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:test
```

`pnpm db:test` requires the local Supabase stack to be running.
