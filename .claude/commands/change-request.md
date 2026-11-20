---
description: Process a client change request (docs before code)
argument-hint: <short description>
---
Change request: $ARGUMENTS
1. Add dated notes to `project-docs/01-discovery/client-notes-YYYY-MM-DD.md`.
2. Propose edits to PRD, design, api-spec.yaml and data-model.md; draft a new ADR in `04-architecture/adr/`.
3. Stop for team + client confirmation.
4. After confirmation, create/flag tasks, run `node scripts/traceability.mjs`, update changelog. No code in this command.
