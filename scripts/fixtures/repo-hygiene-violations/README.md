# repo-hygiene-violations fixture

A synthetic repository state in which **all four** rules enforced by
`scripts/check-repo-hygiene.mjs` are broken. It exists so the guard can be
watched failing, on demand, without touching the real repository.

```
node scripts/check-repo-hygiene.mjs
# -> passes (real repo)

pnpm lint:hygiene:demo-failure
# -> exits 1 with one violation per rule
```

| File | Breaks |
|---|---|
| `tracked-files.txt` | rule 1 (archived directory tracked, including `netlify-deploy/`), rule 2 (`- Copy` file tracked) and rule 4 (a root `payslip.pdf`, a `bug db/` screenshot and a zip inside `apps/api/`); it also lists binary documents under `docs/`, `apps/web/public/` and `packages/ui/` that must NOT be reported |
| `pnpm-lock.yaml` + `pnpm-workspace.yaml` | rule 3 — the lock pins `nanoid` and `postcss`, the workspace declares neither, and declares `js-yaml` at a version that disagrees with the lock |

Any file omitted from this directory falls back to the real one, so a fixture
can exercise a single rule in isolation.

Nothing here is real configuration. Do not copy these files to the repo root.
