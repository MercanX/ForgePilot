# Discovery Stage Execution

ForgePilot treats the workflow server as the runtime stage-catalog authority. The server loads AI Factory runtime `020-Discovery/STAGE-EXECUTION-MANIFEST.json` and publishes Startup plus all 14 Discovery substages through `/workflows/current`.

## Availability and dependencies

- `implementation_status: available` is necessary but not sufficient: the stage package must exist and the server must expose an execution directive.
- HARD requirements block execution until satisfied.
- SOFT requirements remain supported but do not block execution. The current canonical manifest has no approved SOFT relationships.
- D05, D10 and D15 are executable in the current runtime. D15 requires D05 + D10.

## Evidence authority

The sealed 010-Startup workspace manifest is the deterministic repository-evidence authority for Discovery. D05/D10/D15 save operations validate all nested `evidence[]` entries before writing stage state.

Allowed evidence paths are:

- an exact file in the sealed Startup workspace manifest;
- a repository-relative directory that contains at least one manifest-authorized file;
- one of the virtual authority paths: `@startup/scope`, `@startup/seal`, `@startup/workspace-manifest`, `@discovery/context`.

Absolute paths, path traversal, and repository paths outside the resolved Startup authority are rejected. An excluded child path cannot become valid because a Discovery checklist asks for it.

A provider process finishing is only **AI generation complete**. The stage becomes completed only after schema validation, checklist/canonical validation, evidence-authority validation, successful local persistence, and the terminal workflow directive.
