-- Rule 4: one half of a colliding pair that is not grandfathered.
create table fixture_first (id uuid primary key);
insert into schema_migrations (version) values ('0042_first');
