-- Rule 3: records somebody else's version. Reads as compliant, re-applies on
-- every run, and permanently hides 0040 from the runner.
create table fixture_transposed (id uuid primary key);
insert into schema_migrations (version) values ('0040_unrecorded');
