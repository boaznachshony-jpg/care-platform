# Synthetic Seed Strategy

No real personal data may ever populate a development, test, CI, or demo
database (Constitution §16, §25). This is not a style preference — it is
enforced by convention here:

1. **Single source.** All seed data is generated from `@caredesk/testing`'s
   fixture builders (`buildSyntheticTenant`, `buildSyntheticUser`,
   `buildSyntheticEmploymentCase`, and their future Milestone 1 equivalents)
   — never hand-typed rows that could accidentally resemble a real person.
2. **Recognizable as fake.** Every synthetic fixture uses the `example.invalid`
   email domain (RFC 2606 — guaranteed never to resolve) and names prefixed
   "Synthetic"/"Test", so a seeded row is unmistakable in a screenshot, log,
   or support ticket.
3. **No production seeding.** The seed script this strategy describes only
   ever targets a local or CI database — it is not, and will never become,
   a production data-loading tool.

## Milestone 0 status

There is no business schema yet (see `database/migrations/README.md`), so
there is nothing to seed beyond the `schema_migrations` bookkeeping table.
The actual seed script (`database/seed/seed.ts`, using the fixtures above)
is written in Milestone 1 once the identity/tenancy tables exist.
