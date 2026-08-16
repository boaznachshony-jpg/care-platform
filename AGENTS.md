# CareDesk Agent Coordination Protocol

This file is the mandatory operating contract for every Codex/AI engineering agent working in this repository.

## Source of truth

- `origin/main` is the only authoritative code baseline.
- GitHub Issues define work ownership and scope.
- Pull Requests define delivered change sets and review state.
- `AGENT_STATUS.md` is the coordination dashboard and must be updated whenever ownership, blockers, dependencies, branch, PR, or next action changes.
- Product/legal authority remains in the existing governance and source-of-truth documents; this protocol does not override them.

## Mandatory sync before work

Before starting or resuming any engineering task:

1. `git fetch origin --prune`
2. verify the assigned Issue and its current dependencies
3. verify `AGENT_STATUS.md`
4. synchronize the working branch with the latest `origin/main`
5. if `main` changed in a way that affects the task scope, stop and re-evaluate before editing

Never continue from a stale local context merely because the agent remembers a previous state.

## One task, one owner, one branch, one PR

- One active engineering task must have exactly one owning agent.
- One Issue maps to one primary branch and one primary PR unless the orchestrator explicitly records a split.
- Do not create overlapping implementation branches for the same files or acceptance criteria without an explicit dependency/ownership note in `AGENT_STATUS.md`.
- Agents must not create or delegate additional parallel work streams unless the orchestrator has assigned them.

## Dependency gate

- A dependent task must not begin implementation until its prerequisite is merged to `main`, unless the orchestrator explicitly marks it safe to run in parallel.
- If a prerequisite changes while work is in progress, the dependent agent must resync and rerun all affected tests.

## Before push and before merge

Every agent must:

1. fetch the latest `origin/main`
2. synchronize the branch with `main`
3. resolve conflicts deliberately; never accept conflict resolution blindly
4. rerun the relevant unit/integration/E2E/security checks
5. update `AGENT_STATUS.md` with current commit/PR/status/blocker/next action
6. ensure the PR description links the Issue and states dependencies and validation evidence

A PR is not merge-ready when its branch is knowingly based on a stale `main` that materially affects its scope.

## After merge

The owning agent or orchestrator must:

- verify required CI on `main`
- verify relevant Vercel Web/API deployment status when applicable
- close or update the Issue/DoD
- update `AGENT_STATUS.md`
- release dependent tasks only after the merge and verification gates are satisfied

## Blockers

When blocked, do not silently wait. Record in `AGENT_STATUS.md`:

- blocker type
- exact dependency or failing check
- last known commit/PR
- required decision/action
- whether unrelated work may continue

## Handoff format

Every handoff must state:

- Issue
- branch
- PR
- latest commit
- scope completed
- tests executed and results
- unresolved blockers
- dependencies
- next action

## Safety rules

- Never push secrets, credentials, real PII, or production tokens.
- Do not bypass required CI, RLS, audit, accessibility, security, or legal/compliance guardrails to make a branch green.
- Do not rewrite already-applied migrations.
- Do not force-push shared branches unless the orchestrator explicitly authorizes it.
- Do not merge dependency upgrade PRs into active feature work unless explicitly planned.

## Orchestrator responsibility

The orchestrator is the only role that may intentionally change task ownership, permit overlapping scopes, or approve parallel work across a dependency boundary. All such decisions must be reflected in `AGENT_STATUS.md` before implementation proceeds.
