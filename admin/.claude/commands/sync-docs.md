---
description: After a task, update status, plan, changelog and traceability
argument-hint: <task-id>
---
For task $ARGUMENTS: set status to `done` (only if /review-task passed) in `../project-docs/05-delivery/tasks/admin.md`; add a dated line to `../project-docs/05-delivery/changelog.md`; update `implementation-plan.md` if a milestone changed; run `node ../scripts/traceability.mjs` and report any flags.
