# Tasks: agentic-email-processing-system

## Backlog

- [ ] TASK-AEPS-001: Owner-maintained next lane decision for email processing.
  - Current status: `main...origin/main` at `c84c415`; `BUSINESS.md`, `SYSTEM.md`, and `TASKS.md` are untracked; `STATE.json` is tracked and says `next_focus` is owner review/update.
  - Missing queue / standard-file issue: root `TASKS.md` exists but did not name a concrete owner-approved implementation or verification lane.
  - Risk: untracked standard docs can be lost, and implementation agents may invent priorities for AI connectivity, endpoint verification, or email triage behavior.
  - Suggested owner decision: approve this compact queue as the source for the next lane and choose the first executable priority: endpoint verification, AI connectivity readiness, or email triage operations hardening.
  - Future implementation agent allowed files: `TASKS.md` only unless the owner separately approves tracking existing `BUSINESS.md` and `SYSTEM.md`.
  - Future implementation agent forbidden files: runtime source, deploy scripts, package scripts, environment files, secrets, DB/object storage, and live service operations.
  - Validation checks: `git status --short --branch`; `git diff --check -- .`; `npm test`; if endpoint scope is approved, `npm run test:endpoints`.
  - Merge order: land this queue/tracking decision before assigning any email-processing implementation worker.

## Completed

- [x] 2026-06-21 Added `BUSINESS.md`, `SYSTEM.md`, and `TASKS.md` to restore agent-doc quartet coverage.
