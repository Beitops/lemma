-- Emergency containment for a runaway authenticated caller repeatedly invoking
-- update_step with a stale expected revision. Restore this grant only after the
-- caller has been stopped or a durable retry/rate-limit fix has been deployed.
revoke execute on function public.update_step(
  uuid,
  bigint,
  text,
  text,
  text,
  text,
  text[],
  text[],
  text,
  text,
  text
) from authenticated;
