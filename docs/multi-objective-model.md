# Multi-objective workspace model

This document records the product and data boundaries introduced by the multi-objective beta cutover.

## Aggregate shape

```text
Workspace
├── general ContextItems
└── Objectives
    ├── objective-specific ContextItems
    └── Strategies
        ├── optional Strategy Result
        └── Branches
            ├── optional Branch Result
            └── Steps
```

A workspace is an empty shell when it is created. Objectives, context, and strategies are added explicitly afterwards. Only one objective board is rendered at a time, but retrieval can reuse steps from every objective in the same workspace.

## Context scopes

- `context_items.objective_id IS NULL` means general workspace context.
- A non-null `objective_id` means context specific to that objective.
- The effective context for a board is general context plus that objective's specific context.
- Context scope is structural provenance and is immutable after creation. A future promote/copy operation should preserve the source instead of silently moving it.

## Structural graph scope

- Each strategy belongs to exactly one objective and workspace.
- Branches and steps derive their objective from their strategy; `objective_id` is not duplicated on them as a second source of truth.
- Explicit step dependencies and branch comparisons cannot cross objective boundaries.
- Associative step retrieval is deliberately different: it always requires `workspace_id` and searches every objective by default. `objective_id` is only an optional narrowing filter.

## Results

An objective has no singleton final result. Results attach to reasoning targets:

- at most one editable summary result per strategy;
- at most one editable result per branch;
- each result records `successful`, `unsuccessful`, or `inconclusive` independently of the branch/strategy lifecycle state;
- clean-solution generation remains a projection of a selected branch and does not replace graph history.

The schema retains enough objective/strategy/branch provenance to add a user-selected primary result later without changing the target model. Primary-result selection is intentionally deferred.

## UI and agent access

- `/workspaces/:workspaceId` loads the workspace shell and objective summaries.
- `/workspaces/:workspaceId/objectives/:objectiveId` identifies the active board.
- The sidebar renders objectives with nested strategies. Selecting a strategy first activates its objective.
- Context creation requires an explicit general or objective scope.
- WebMCP teaches the hierarchy through `get_skill` and exposes objective discovery/creation, scoped context, objective strategies, workspace-wide retrieval, and target-specific results.

## Cutover and recovery

The beta cutover may remove the existing workspace graphs. Before it runs:

- the reusable problem statements and input context are stored in `docs/legacy-problems.md`;
- the complete pre-change migration chain is copied under `supabase/baselines/20260831_pre_multi_objective_migrations`;
- the remote migration ledger and catalog fingerprint are recorded in that baseline.

The discarded solutions, branches, steps, and results are intentionally not recoverable as application data.

## Deliberately deferred product choices

- selecting one strategy/branch result as an objective's primary result;
- custom ordering of objectives beyond the deterministic creation order;
- whether completing every relevant strategy should automatically complete an objective;
- an explicit promote/copy workflow between objective-specific and general context;
- richer rendering of cross-objective references discovered through retrieval;
- semantic embeddings, which were already unpopulated before this change and are not modified by this cutover.
