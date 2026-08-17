# D05/D10 Contract Compatibility Patch

ForgePilot now consumes D05 Project Overview and D10 Architecture provider outputs as full stage envelopes.

## Runtime rules

- `audit_id` must match the active local audit.
- root `substage` and `result.substage` must match the stage being saved.
- `workspace_hash` must match the sealed 010-Startup workspace.
- `schema_version` must be `1.0`.
- `completed_at` must be an ISO 8601 date-time with a timezone.
- checklist, findings, evidence and profile extraction operate on the inner `result` object.
- the stage document is persisted once; the provider envelope is not nested under a second `result` envelope.

The local JSON Schema validator also enforces `const` and `format: date-time`, which are used by the aligned D05/D10 schemas.

## Verification

Run:

```bash
pnpm test:contract-compat
pnpm test:protocol
pnpm typecheck
pnpm test
```

`test:contract-compat` directly extracts and executes the relevant helper/validator declarations from the production TypeScript source, so it detects regressions in the actual runtime implementation rather than testing a duplicate implementation.
