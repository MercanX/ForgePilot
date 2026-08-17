# Discovery Stage Execution

ForgePilot does not hard-code the Discovery dependency graph. The workflow server loads the AI Factory runtime `020-Discovery/STAGE-EXECUTION-MANIFEST.json`, publishes the catalog through `/workflows/current`, and exposes execution directives only for stage packages that are both marked `available` and supported by the server runtime.

Current executable Discovery stages are D05 Project Overview, D10 Architecture, D15 Database, D20 Dependencies / Integrations, and D25 Backend. All 14 Discovery substages remain visible; later packages remain `Not Ready` until implemented.

## Dependency enforcement

HARD requirements block execution. The renderer and backend execution directives use the same server-published requirements. A completed downstream stage is invalidated when one of its HARD prerequisites is restarted, so stale results cannot silently become current again.

For the currently executable graph:

- D05 requires Startup.
- D10 requires D05.
- D15 requires D05 + D10.
- D20 requires D05 + D10.
- D25 requires D05 + D10 + D15 + D20.

D15 and D20 are siblings. Restarting D20 does not invalidate D15, and restarting D15 does not invalidate D20. Either restart invalidates D25. Restarting D10 invalidates D15, D20, and D25; restarting D05 invalidates D10, D15, D20, and D25.

## Evidence authority

Provider JSON is never persisted solely because it parses. D05/D10/D15/D20/D25 outputs are validated against their stage schema, canonical checklist/record IDs, and repository evidence reality. Startup scope defines proactive scan coverage, not evidence authority. A targeted evidence path may be outside the Startup manifest if it is project-relative, resolves inside the selected repository, and exists. Absolute, escaping, outside-workspace, and nonexistent paths reject the save. The approved virtual evidence roots are `@startup/scope`, `@startup/seal`, `@startup/workspace-manifest`, and `@discovery/context`. Safe checklist-only evidence defects can be auto-repaired when no canonical semantic record meaning is changed; unsafe semantic defects still fail.
