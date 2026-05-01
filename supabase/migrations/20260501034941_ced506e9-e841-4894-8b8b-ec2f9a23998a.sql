-- Move pgvector out of public
create schema if not exists extensions;
alter extension vector set schema extensions;

-- Restrict execute on security-definer helpers
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.match_chunks(extensions.vector, int, uuid, text) from public, anon;
grant execute on function public.match_chunks(extensions.vector, int, uuid, text) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;