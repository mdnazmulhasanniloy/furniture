---
description: Pick and plan the next todo task for this repo
argument-hint: [task-id optional]
---
Open `../project-docs/05-delivery/tasks/admin.md`. If $ARGUMENTS names a task, use it; otherwise pick the first `todo` task whose dependencies are all `done` (check other task files for cross-repo deps).
1. Set its status to `in-progress`.
2. Read ONLY the docs listed under "Docs" plus the PRD sections for its requirement IDs.
3. If anything is unclear or contradicts the docs, add a row to `../project-docs/05-delivery/blockers.md` (status `blocked`), set the task to `blocked`, and stop.
4. Otherwise present a plan: files to create/change, spec/data-model changes needed first, and the test list (one test per acceptance criterion, named with the requirement ID). Wait for approval before writing code.
