# Agent Operations

## roles

- Readiness scanner: classifies work as ready now, dependency-gated, blocked, complete, or owner-input required
- Worker agent: handles one bounded implementation goal with explicit scope
- Worker monitor: checks active work, blockers, and shared-file conflicts
- Integration validator: checks acceptance criteria, validation evidence, and current-task regressions

## before work

Before implementation, confirm:

- the active goal matches repository intent
- required reading is complete
- task/state traceability is present
- blockers and owner decisions are explicit
- validation commands are known and narrow

## parallel work

Keep parallel workstreams separate by file ownership and validation owner. Shared-file edits require one integration owner and an explicit merge order.

## validation debt

Use `docs/orchestrator/VALIDATION_DEBT.md` to record known out-of-scope validation failures. Validation debt does not replace current-task evidence or acceptance checks.

## handoff

Every handoff must include the active goal, current blockers, validation results, and the next concrete action.

## project-specific operations

- Follow the allowed/forbidden file scoping already recorded in TASKS.md TASK-AEPS-001 for any implementation work beyond this documentation bootstrap
- Validation checks referenced in TASKS.md: `git status --short --branch`, `git diff --check -- .`, `npm test`, and `npm run test:endpoints` when endpoint scope is approved
