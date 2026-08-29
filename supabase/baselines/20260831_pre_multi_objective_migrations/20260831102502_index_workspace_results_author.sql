-- Cover the auth.users foreign key used for author lifecycle and provenance lookups.
create index workspace_results_author_user_id_idx
  on public.workspace_results (author_user_id)
  where author_user_id is not null;
