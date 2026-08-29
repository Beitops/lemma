# Pre-multi-objective database baseline

This directory is an immutable copy of every migration applied to the linked Supabase project immediately before the multi-objective change.

- Project: `ijzftzbhoreyeavoduid` (`Lemma`)
- Remote catalog captured at: `2026-08-31T18:42:23.015725+00:00`
- Application data intentionally not retained, except for the reusable problem statements in `docs/legacy-problems.md`.
- Private Storage was inventoried immediately before cutover: `workspace-context` contained `0` objects (`0` bytes), so deleting the beta workspaces cannot orphan legacy uploads.
- The linked Supabase CLI was not authenticated, so verification used the Supabase MCP migration history and PostgreSQL catalogs rather than `supabase db dump`.

## Applied migration history

The remote migration ledger and the copied files both contain exactly these versions:

| Version | Name | SHA-256 of copied SQL |
| --- | --- | --- |
| `20260829185844` | `initial_reasoning_graph` | `c20063d8f3dd1bfd2906c7fec1660c9e805c4fe7048d989d78449aa931ceb4f9` |
| `20260829190008` | `harden_security_and_foreign_key_indexes` | `d62326ee38041d8f958606608656d7581ac9c31d7a5c48715813b633f5a274cc` |
| `20260829190233` | `fix_activity_actor_fallback` | `8c327914612f8f18fd7c6ab5bf0a5ca9014db6a7fea110b0e64550838f1fca08` |
| `20260830170110` | `find_steps_workspace_scope` | `e48754e7a2bd33b8864b95bc40650faf03c78ddb1d2337084acabdba1b0fc156` |
| `20260830175702` | `english_clean_solution` | `22c679e771495191cfc810a973d343e8b9271a472256f440eb281e71fe93b692` |
| `20260831102307` | `workspace_completion_results` | `8464c6876d3aa3d636e0942aa730ea0e72d148418b5d3ddb36a55a07ba6db8ac` |
| `20260831102502` | `index_workspace_results_author` | `113ee534d4f72ecd0f166f3a8fa64b04f2552f599b1845ac5916f9b8ab6fd12e` |
| `20260831152948` | `workspace_graph_rpc` | `d14f015315040da3d857cfa7d2762cedf19d8376a6d786214eb6c26da0dd4c1e` |

`diff -rq` between this directory's SQL files and `supabase/migrations` was empty at capture time.

## Remote schema fingerprint

These ordered SHA-256 fingerprints make later drift checks possible without retaining application data.

| Catalog object | Count | SHA-256 |
| --- | ---: | --- |
| Tables and RLS flags | 17 | `ca9f153c601961dd90a3e850167ffac76a594952ac13844e7b749318963b94d2` |
| Columns | 217 | `94fca810feee01749f4644e870b94578a4fc4c35568ed891c39ca62a94ab3485` |
| Constraints | 176 | `710242b34001e24ad242bc9cdee77feac679bd83b45d368d83b840ca0ede0783` |
| Indexes | 104 | `5fbae16eb7a13f8f59dcdda8f483ad95abfc61463f2aebf738334168ec76d475` |
| RLS policies | 45 | `b7a9efc1a5492be2dcf521259bfeb8375d33b017e821df5a104a80b937bca2da` |
| Functions | 37 | `e088bf3779294595b70b9bb3fb8204d3dede7bb25de571debd4f34fa981f6e1d` |
| Non-internal triggers | 56 | `486c208789a271449c38d629e3de2dda242a526f280e460bd2168d98e2a13174` |

Tables present: `private.mutation_receipts`, `private.step_search_documents`, `public.activity_events`, `public.assumptions`, `public.branches`, `public.clean_solution_snapshots`, `public.context_items`, `public.decisions`, `public.sources`, `public.step_assumptions`, `public.step_dependencies`, `public.step_revisions`, `public.step_sources`, `public.steps`, `public.strategies`, `public.workspace_results`, and `public.workspaces`.

## Recovery boundary

Replaying these eight migrations against a fresh Supabase database reconstructs the pre-change schema. The discarded beta graph data is not recoverable from this baseline; only the three exported problem statements and their input context are retained.
