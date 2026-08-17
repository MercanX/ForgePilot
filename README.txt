ForgePilot 0.5.4 — D20 Dependencies / Integrations + Discovery scope-evidence guard

This package extends the working D05/D10/D15 Discovery runtime with D20 Dependencies / Integrations.

Executable Discovery stages:
- 020-D05-Project-Overview
- 020-D10-Architecture
- 020-D15-Database
- 020-D20-Dependencies-Integrations

Dependency rules:
- D20 requires completed D05 + D10 results for the same sealed Startup workspace.
- D25 remains Not Ready and, when implemented, requires D05 + D10 + D15 + D20.
- Restarting D20 resets only D20 artifacts/state.

D20 provider execution:
- Uses D20-Dependencies-Integrations/prompt/dependencies-integrations.compiled.prompt.md.
- Uses D20-Dependencies-Integrations/contracts/dependencies-integrations-output.schema.json.
- Executes semantic task D20_DEPENDENCIES_INTEGRATIONS.
- Requires exactly DI-001..DI-102 checklist dispositions.

D20 local persistence:
  <project>/.ai-factory/020-Discovery/audits/<AUD-ID>/stages/D20-Dependencies-Integrations.json

Discovery evidence authority:
- D05/D10/D15/D20 repository evidence must resolve to the sealed 010-Startup workspace manifest or an approved virtual authority path.
- Excluded/unapproved paths are rejected before persistence and do not complete the stage.
- Provider generation and deterministic stage completion remain separate Activity states.

The workflow server reads the authoritative AI Factory STAGE-EXECUTION-MANIFEST.json; stage dependency relationships are not hard-coded into the renderer.
