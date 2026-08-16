ForgePilot 0.5.1 — D10 Architecture stage

This package extends the working 0.5.0 D05 runtime without changing the established Startup/D05 semantics.

Discovery execution stages now include:
- 020-D05-Project-Overview
- 020-D10-Architecture

Rules:
- 020-Discovery is not an executable container stage.
- D10 is started manually by the user.
- D10 requires a completed D05 result for the same sealed Startup workspace.
- ForgePilot never auto-runs D05 when D10 is requested.
- Restarting D10 resets only D10 artifacts/state.
- Restarting D05 resets only D05 artifacts/state; it does not automatically erase D10.
- The project-local audit artifacts are the readiness source of truth, not mock-cloud process memory.

D10 provider execution:
- Uses the D10 compiled prompt and JSON schema from AI Factory.
- Uses Settings -> AI Output Language for human-readable JSON values only.
- Uses Settings -> Provider Stage Timeout (default 90 minutes).
- Claude Code remains read-only with Read/Glob/Grep allowed and Edit/Write/Bash blocked.

D10 local persistence:
  <project>/.ai-factory/020-Discovery/audits/<AUD-ID>/stages/D10-Architecture.json

Shared audit state is updated in PROJECT_PROFILE.json, FINDINGS.json, AUDIT_COVERAGE.json and AUDIT_META.json.
