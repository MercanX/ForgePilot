ForgePilot 0.5.7 — Startup scan/evidence separation + checklist auto-repair + D25 Backend

This package preserves the D25-ready runtime and Claude final-output parser fix, separates Startup proactive scan scope from targeted evidence lookup, and adds deterministic safe checklist-only auto-repair before persistence.

Executable Discovery stages:
- 020-D05-Project-Overview
- 020-D10-Architecture
- 020-D15-Database
- 020-D20-Dependencies-Integrations
- 020-D25-Backend

Dependency rules:
- D25 requires completed D05 + D10 + D15 + D20 results for the same sealed Startup workspace.
- D15 and D20 are siblings; both require D05 + D10.
- Restart invalidation follows HARD dependencies: restarting D15 or D20 invalidates D25; restarting D10 invalidates D15 + D20 + D25; restarting D05 invalidates D10 + D15 + D20 + D25.
- D30 remains Not Ready.

D25 provider execution:
- Uses D25-Backend/prompt/backend.compiled.prompt.md.
- Uses D25-Backend/contracts/backend-output.schema.json.
- Executes semantic task D25_BACKEND.
- Requires exactly BE-001..BE-134 checklist dispositions.
- Validates canonical BE-F### / BE-S### / BE-U### / BE-C### records.

D25 local persistence:
  <project>/.ai-factory/020-Discovery/audits/<AUD-ID>/stages/D25-Backend.json

Discovery evidence authority:
- D05/D10/D15/D20/D25 repository evidence must resolve to the sealed 010-Startup workspace manifest or an approved virtual authority path.
- Excluded/unapproved paths are rejected before persistence and do not complete the stage.
- Provider generation and deterministic stage completion remain separate Activity states.

Workflow catalog:
- The workflow server reads the authoritative AI Factory STAGE-EXECUTION-MANIFEST.json.
- Stage dependency relationships are not hard-coded into the renderer.

Claude final-output parser recovery (preserved from 0.5.5):
- Large Claude stream-json runs may emit a truncated tail in the terminal type=result event while the preceding final assistant event contains the complete JSON document.
- ForgePilot evaluates both provider result and assistant-text candidates against the stage output contract and selects the complete contract-valid root envelope.
- Nested tail objects such as { recommended_next_substages, cautions } cannot win over a valid D05/D10/D15/D20/D25 audit envelope.
- Provider Console Final Raw Output prefers the larger final assistant payload when Claude's terminal result is truncated.
