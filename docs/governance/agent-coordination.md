# Agent Coordination Governance

## Purpose

Provide a durable coordination model for concurrent Codex/AI engineering work so every agent operates from the current repository state, dependencies are explicit, overlapping scopes are visible, and stale branches cannot silently reach merge.

## Operating model

1. `origin/main` is the authoritative technical baseline.
2. GitHub Issues define scope and ownership.
3. Pull Requests define delivered changes and validation evidence.
4. `AGENT_STATUS.md` records the live orchestration state.
5. `AGENTS.md` contains mandatory instructions consumed by repository-aware agents.
6. The existing required CI aggregate includes an agent-coordination guard.

## CI enforcement

The coordination guard verifies that:

- `AGENTS.md` exists and contains the coordination protocol.
- `AGENT_STATUS.md` exists and contains the required dashboard schema/status values.
- for pull requests, the PR head is based on the latest `origin/main`; otherwise the guard fails and instructs the agent to synchronize before merge.

Because the guard is part of the existing `Migration and architecture guardrails` job, failure propagates into the already-required `Format, lint, typecheck, test, build` quality gate.

## Orchestrator workflow

Before assigning work:

- create or identify the GitHub Issue;
- record the owner, branch, dependencies and parallel-safety decision in `AGENT_STATUS.md`;
- only then release the task to an agent.

After merge:

- verify CI and applicable Vercel deployments;
- update Issue/DoD;
- update the dashboard;
- release dependent tasks.

## Failure handling

A coordination failure is a delivery blocker, not a warning. Agents must not bypass it by deleting dashboard rows, weakening the CI guard, force-pushing shared history, or merging through an alternate path.

## Limits

This mechanism coordinates repository-visible work. A local agent session that has not yet fetched/pushed cannot be observed centrally. Therefore every agent is required to synchronize at start/resume and publish its work state through GitHub before handoff.
