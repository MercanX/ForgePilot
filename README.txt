ForgePilot 0.5.3 — D15 Database + Discovery scope-evidence guard

This package extends the working D05/D10 Discovery runtime with D15 Database.

Executable Discovery stages:
- 020-D05-Project-Overview
- 020-D10-Architecture
- 020-D15-Database

Rules:
- D15 requires completed D05 + D10 results for the same sealed Startup workspace.
- Stage dependencies come from the AI Factory runtime STAGE-EXECUTION-MANIFEST.json.
- Restarting D15 resets only D15 artifacts/state.
- The project-local audit artifacts are the readiness source of truth.

D15 provider execution:
- Uses D15-Database/prompt/database.compiled.prompt.md.
- Uses D15-Database/contracts/database-output.schema.json.
- Uses Settings -> AI Output Language for human-readable JSON values.
- Claude Code remains read-only for repository exploration; mutating database commands are not part of D15.

D15 local persistence:
  <project>/.ai-factory/020-Discovery/audits/<AUD-ID>/stages/D15-Database.json

Shared audit state is updated in PROJECT_PROFILE.json, FINDINGS.json, AUDIT_COVERAGE.json and AUDIT_META.json.

Evidence authority:
- D05/D10/D15 repository evidence must resolve to the sealed Startup workspace manifest or an approved virtual authority path.
- Unauthorized/excluded evidence fails deterministic local validation and is not persisted as a completed stage.
- Provider generation completion is reported separately from deterministic stage validation.
