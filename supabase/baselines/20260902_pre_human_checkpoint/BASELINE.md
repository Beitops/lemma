# Pre-human-checkpoint Supabase baseline

Captured at `2026-09-02T00:08:58Z`, before applying the human checkpoint migration or deploying a new Edge Function version.

- Project: `Lemma` (`ijzftzbhoreyeavoduid`), `eu-west-2`, PostgreSQL `17.6.1.166`.
- Remote migration head: `20260901125010_slow_embedding_worker_cron`.
- The deployed `lemma-api` v4 and `embed-steps` v3 source bundles matched the repository at commit `fc0262e572ae763a57dd7c2715f757a0571794ad` byte-for-byte.
- `supabase/database.types.ts` matched the generated production types semantically; the only difference was function declaration ordering and a trailing newline.
- All application tables in `public` and `private` had RLS enabled at capture time.
- No user rows, authentication records, Storage objects, secrets, or credentials are included in this committed baseline.

The schema is reproducible from the migrations listed in `migration-manifest.txt`; the deployed functions are recoverable from the referenced Git commit. The retry fix existed locally as `20260901233720_fix_embedding_retry_visibility_timeout.sql` but had not yet reached production when this baseline was captured. It was subsequently applied and renamed to the production migration version `20260902003934_fix_embedding_retry_visibility_timeout.sql`.

Private logical dumps must go under `supabase/.backups/`, which is intentionally ignored by Git.
