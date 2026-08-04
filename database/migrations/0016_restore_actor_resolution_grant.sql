-- Migration 0015 removes the implicit PUBLIC/anon/authenticated EXECUTE grant
-- from every public function. Keep actor resolution available only to the
-- server-side least-privilege role; the browser must never call it directly.

grant execute on function resolve_caredesk_actor(text) to caredesk_app;

insert into schema_migrations (version)
values ('0016_restore_actor_resolution_grant');
