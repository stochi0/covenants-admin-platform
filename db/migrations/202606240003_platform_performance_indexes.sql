create index if not exists users_active_clerk_user_id_idx
  on public.users (clerk_user_id)
  where deleted_at is null;
