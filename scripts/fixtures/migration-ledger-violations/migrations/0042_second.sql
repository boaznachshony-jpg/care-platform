-- Rule 4: the other half. Ordering between the two is decided by 'f' sorting
-- before 's', which is not a decision anybody made.
create table fixture_second (id uuid primary key);
insert into schema_migrations (version) values ('0042_second');
