# AGENTS.md

## Mission

Build an IDE-like collaborative workspace for mathematical reasoning between humans and AI agents. The product is not an AI tutor or a LaTeX whiteboard. It is a shared, inspectable reasoning environment in which both interfaces operate on the same semantic graph:

- the visual workspace is the human interface;
- WebMCP is the agent interface;
- the reasoning graph is the source of truth for both.

The product brief lives in `projectContext.md`. Keep implementation and product decisions consistent with it.

## MVP outcome

Optimize for the challenge demo's central moment: a human interrupts a solution, branches from an earlier step or adds a new idea, and the agent reads the changed state and continues without destroying the original path.

Prioritize objective and context capture, strategies, structured steps, visual branching, backward navigation, human interventions, WebMCP tools, scoped step retrieval, branch comparison, and clean-solution generation.

Do not expand the MVP into multi-user collaboration, an advanced computer algebra system, sophisticated OCR, or a full real-time collaborative editor unless explicitly requested.

## Repository architecture

Use a TypeScript monorepo with this target shape:

```text
apps/
  web/          React + Vite client
packages/
  contracts/    shared Zod schemas, inferred types, and API/WebMCP contracts
supabase/
  functions/    authenticated Edge API and server-side integrations
  migrations/   database migrations
  seed.sql       minimal reproducible demo data, when needed
```

Use `pnpm` workspaces unless the repository adopts another package manager before scaffolding. Keep the lockfile committed and pin dependency versions when installing them.

TypeScript must run in strict mode. Use Zod as the canonical runtime schema system and infer TypeScript transport types from the shared schemas in `packages/contracts`. Do not duplicate transport types manually between the frontend, API, and WebMCP layer.

## Technology decisions

- Web: React, Vite, and TypeScript.
- API: Supabase Edge Functions and TypeScript. Keep the `lemma-api` router thin and place transactional graph mutations in Postgres RPCs.
- Data: Supabase Postgres for relational state, Supabase Storage for uploaded context files, and `pgvector` in the same Postgres database for embeddings.
- Agent interface: WebMCP registered imperatively from the top-level page.
- Mathematical content: Markdown with embedded TeX math, rendered with `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, and `katex`.
- Validation and contracts: Zod for environment variables, domain inputs, API requests/responses, and WebMCP inputs/results. Generate JSON Schema from the canonical Zod schemas where Edge Functions or WebMCP requires it.
- WebMCP types: use the `webmcp-types` development package rather than maintaining broad browser API declarations by hand.

Before adding or upgrading WebMCP or Supabase code, recheck their current documentation: both are evolving quickly.

## Domain model and invariants

Treat the graph as persisted domain data, not as a projection of a Markdown or LaTeX document.

Core entities are `Workspace`, `Objective`, `ContextItem`, `Strategy`, `Branch`, `Step`, `ReasoningResult`, `Assumption`, `Source`, and `Decision`. Dependencies and citations are explicit relations, not links inferred from prose.

Preserve these invariants:

- A workspace starts empty and can contain multiple objectives.
- Every objective belongs to exactly one workspace.
- Context is either general to its workspace or specific to one objective in that workspace.
- Every strategy belongs to exactly one objective and therefore exactly one workspace.
- Every branch belongs to exactly one strategy.
- Every step belongs to one strategy and one branch.
- A step dependency may only target a step in the same objective. Cross-branch dependencies are allowed when explicit and valid.
- Branches retain `parent_branch_id` and `forked_from_step_id` lineage.
- Dead ends are status changes, never destructive deletes.
- Replacing or revising a step preserves history through a revision or supersession relation.
- Human and agent contributions record their author type and timestamp.
- Assumptions are first-class data so dependent conclusions can be queried deterministically.
- Generating a clean solution is a projection of a selected branch, not a mutation that discards graph history.
- A strategy and each of its branches may have their own result, including successful, unsuccessful, or inconclusive outcomes. An objective does not have one implicit final result.
- Semantic retrieval never answers structural dependency questions; traverse explicit graph relations for those.

Use UUIDs for externally visible identifiers. Use database transactions for mutations that create or change multiple related records. Add an optimistic revision/version field to mutable aggregate state so stale human and agent writes fail clearly instead of silently overwriting one another.

## Content and LaTeX rendering

Use Markdown plus TeX math as the canonical authoring format for step prose. Prefer one `body_markdown` field per step, with optional structured summary/title fields, rather than separate prose and LaTeX fields that can drift out of sync.

Author syntax:

- inline math: `$x^2 + y^2$`;
- display math: `$$x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}$$`;
- Markdown for paragraphs, lists, links, code, and emphasis.

Render in React through `react-markdown` with `remark-gfm`, `remark-math`, and `rehype-katex`, and import `katex/dist/katex.min.css` through the application bundle. KaTeX is the MVP default because it renders quickly, works well for interactive rerenders, produces accessible HTML/MathML, and fits naturally into the unified Markdown pipeline.

Do not store rendered HTML. Do not use `dangerouslySetInnerHTML`, `rehype-raw`, or user-authored raw HTML in the MVP. Keep KaTeX `trust` disabled and show a readable inline error/fallback for invalid TeX instead of crashing a full reasoning view.

Choose MathJax only when a documented, required TeX feature is unsupported by KaTeX. If that happens, add a focused compatibility fixture and record the reason for the switch; do not run both renderers for ordinary content.

Keep mathematical semantics outside Markdown: dependencies, assumptions, theorem tags, concepts, sources, authorship, status, and branch membership remain typed fields or relations.

## API boundaries

Expose versioned routes under `/api/v1` from the `lemma-api` Supabase Edge Function. Validate every request and response against the shared Zod schemas. Return stable machine-readable error codes in addition to human-readable messages.

The browser UI and WebMCP tools must invoke the same application services and authorization rules. Never maintain a separate agent-only mutation path.

Frontend code may use Supabase directly for authentication, authorized realtime subscriptions, and immutable uploads to the private context bucket. Route graph writes and upload-metadata finalization through `lemma-api` so graph invariants, transactions, audit events, and embedding updates have one implementation. Pass the Supabase access token to the function and use a caller-scoped database client so RLS remains effective. Reserve privileged server credentials for isolated jobs that genuinely require them.

Keep domain/application logic independent of Edge `Request` objects, React state, and WebMCP browser objects.

## WebMCP rules

WebMCP is a primary product surface. Register tools in a top-level client module using `document.modelContext.registerTool` after feature detection. The current ChatGPT browser does not discover declarative form tools or tools registered inside iframes, so do not rely on either for the challenge MVP.

Provide a small, composable tool surface based on existing product actions. Initial tools should cover:

```text
get_workspace
get_context
list_objectives
get_objective
create_objective
update_objective
list_strategies
create_strategy
create_step
update_step
branch_from_step
mark_assumption
mark_dead_end
find_steps
compare_branches
request_human_decision
generate_clean_solution
set_reasoning_result
```

For every tool:

- use narrow JSON Schema inputs with explicit identifiers and bounds;
- state side effects plainly in the description;
- mark `readOnlyHint` only when the operation is genuinely read-only;
- reuse the current signed-in session and normal backend authorization;
- validate again on the server; browser schemas are not a security boundary;
- return enough structured data to verify the result, including affected IDs and current revision;
- make mutation retries safe with an idempotency key where duplicate execution would matter;
- unregister or replace tools cleanly when page/workspace scope changes;
- degrade gracefully when `document.modelContext` is unavailable.

Treat tool inputs and tool-returned content as untrusted. WebMCP must not expose secrets, privileged Supabase keys, raw SQL, or an authorization bypass. Agent changes should become visible in the same UI state that a human sees, including provenance and activity feedback.

## Supabase and retrieval

Manage schema changes only through files in `supabase/migrations`. Enable the vector extension without pinning an extension version. Enable RLS on every table exposed through the Data API, and write ownership policies for each operation; `TO authenticated` alone is not authorization.

Never expose a Supabase secret/service-role key in Vite client code. Only publish browser-safe configuration. Use server-side environment validation and never commit secrets.

Model the graph relationally. A reasonable starting schema includes:

- `workspaces`, `objectives`, `context_items`, `strategies`, `branches`, `steps`, and `reasoning_results`;
- `step_dependencies` for directed graph edges;
- `assumptions` and `step_assumptions`;
- `sources` and `step_sources`;
- `decisions` or intervention/audit events.

Index each step using derived searchable text plus metadata and an embedding. Store the embedding model identifier/version, and make the vector dimension match the selected embedding model. Re-embed when the indexable representation or model changes.

Implement `find_steps` as hybrid retrieval:

1. require `workspace_id` and authorize it;
2. optionally filter by `objective_id`, `strategy_id`, `branch_id`, and `status` while remaining workspace-wide by default;
3. combine Postgres full-text search with pgvector similarity;
4. fuse rankings deterministically, such as reciprocal rank fusion;
5. return step IDs, objective provenance, snippets, metadata, and scores, not invented graph relations.

Add ordinary B-tree indexes for scope filters, a GIN index for full-text search, and an HNSW vector index once the dataset warrants it. The vector index operator class must match the query distance operator. Keep retrieval limits bounded.

## UX expectations

The graph and the selected branch must remain legible at demo speed. A human should be able to see where a branch began, who authored each step, which assumptions and sources it uses, and whether it is active, superseded, or a dead end.

After an agent mutation, update or refetch the shared state immediately and focus/highlight the affected node. Preserve both branches during comparisons. Make clean-solution output visibly derived from a selected branch.

Math rendering failures must be localized to the invalid expression. Interactive graph controls need keyboard access, text labels, and non-color status cues.

## Quality bar

Tests should cover graph invariants, branching without history loss, optimistic concurrency, authorization/RLS, hybrid-search scoping, WebMCP schema/handler behavior, and Markdown/TeX rendering fixtures.

After the repository is scaffolded, keep working scripts for:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the smallest relevant checks during iteration and the full suite before handing off a completed feature. Test WebMCP in the ChatGPT in-app browser as part of release/demo verification; ordinary browser unit tests alone do not verify site-tool discovery.

Favor a coherent, reliable challenge demo over speculative infrastructure. Keep changes small enough to review, preserve unrelated user work, and document any intentional departure from these decisions.
