---
description: Review a finished task against its acceptance criteria
argument-hint: <task-id>
---
Review task $ARGUMENTS in `../project-docs/05-delivery/tasks/backend.md`.
- For each acceptance criterion of the linked requirement(s), find the test that covers it (grep the requirement ID). List any criterion without a test.
- Run the test suite and typecheck; report results verbatim.
- Diff `tests/` against the main branch: flag any deleted, skipped or weakened test.
- Check the implementation matches `../project-docs/04-architecture/api-spec.yaml` and `data-model.md`.
- Check en/ar parity for any new user-facing text.
Output: PASS / CHANGES NEEDED with a numbered list. Do not modify code.
