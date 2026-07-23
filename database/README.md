# Database (Milestone 0 scaffold)

- `docker-compose.yml` — local PostgreSQL 17 for development. Requires
  Docker; not available in every environment (in particular, it could not be
  started or verified in the environment this scaffold was built in — treat
  it as unverified until run locally at least once).
- `migrations/` — naming convention and the one Milestone 0 baseline
  migration. No business schema yet — see `docs/architecture/database-blueprint.md`
  §11 (schema readiness gate) and ADR-002.
- `rls-test-harness-design.md` — the shape future RLS tests will follow,
  written before any RLS policy exists so the tests and the policies are
  designed together.
- `seed/` — synthetic-only seed strategy; no seed script yet, nothing to
  seed until Milestone 1 creates real tables.

## Local setup (requires Docker)

```bash
docker compose -f database/docker-compose.yml up -d
docker compose -f database/docker-compose.yml ps  # wait for "healthy"
psql "$DATABASE_URL" -f database/migrations/0001_baseline.sql
```
