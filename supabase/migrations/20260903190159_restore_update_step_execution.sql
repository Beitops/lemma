-- Restore the authenticated mutation surface after the runaway caller was
-- stopped. The matching emergency revoke lives in migration 20260903184016.
grant execute on function public.update_step(
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
) to authenticated;
