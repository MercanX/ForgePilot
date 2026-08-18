# Changelog CommitMind

## 2026-08-17 — Discovery stage catalog ve dependency UI

ForgePilot Discovery stage görünürlüğü AI Factory runtime içindeki `STAGE-EXECUTION-MANIFEST.json` dosyasını okuyan workflow server tarafından sağlanır. Tüm D05–D70 substages UI'da görünür hale getirildi; executable olmayan stage'ler `Not Ready`, eksik HARD dependency'ler `Run requirement`, hazır stage'ler `Start stage` davranışı aldı. Backend execution guard ve manifest cycle validation eklendi.

## 2026-08-18
- Added file-based delivery for large semantic stage outputs to prevent JSON corruption from stream splitting at max-output-token boundaries
- Scoped Claude Code Write permission to the stage-output directory, enabling file writes while maintaining security restrictions
- Implemented seam-repair logic for split assistant messages, handling token re-emission and partial key duplication
- Added stage-output file as authoritative output candidate with stream parsing as fallback for non-compliant runs
- Added comprehensive tests for stream parsing edge cases and scoped Write permission behavior

## 2026-08-17

- Added structural output repair that moves misplaced fields into `$.result` without semantic regeneration
- Implemented contract recovery workflow with no-repository-tools policy for repair passes
- Extended mock cloud to simulate contract repair across all Discovery stages
- Added regression evidence for structural repair and contract recovery scenarios
- Updated provider adapter to conditionally disable repository tools during repair passes

- Separated Startup proactive scan scope from targeted evidence validation, allowing real project-contained evidence paths outside the manifest to be accepted.
- Added deterministic checklist-only auto-repair that downgrades unverifiable CHECKED_OK rows to NOT_INSPECTED_WITH_REASON without altering canonical semantic records.
- Implemented hard failure for unsafe evidence defects tied to findings, strengths, unknowns, or contradictions, preventing silent semantic rewrites.
- Updated all Discovery save jobs (D05-D25) to return auto_repair_count and surface repair activity in workflow completion messages.
- Documented the new evidence authority model and auto-repair behavior in README, discovery execution docs, and a new scan-evidence-autorepair guide.

- Added D25 Backend as an executable Discovery stage with full schema, checklist, and evidence validation.
- Implemented dependency-aware restart invalidation that resets downstream stages when HARD prerequisites are rerun.
- Extended the discovery context builder to aggregate D05, D10, D15, and D20 results for D25 provider execution.
- Updated documentation and manifests to reflect D25 availability and the new dependency invalidation rules.
- Bumped package version to 0.5.6 with updated release notes.

- Added recovery logic for truncated Claude stream-json result events by evaluating assistant-text candidates against the stage output contract.
- Updated provider output parser to select the largest contract-valid root envelope, preventing nested tail objects from winning over complete audit envelopes.
- Enhanced Provider Console to display the larger final assistant payload when Claude's terminal result is truncated.
- Added regression test script `verify-provider-output-parser.cjs` covering truncated result tails, complete assistant events, and direct result parsing.
- Bumped application version to 0.5.5 across desktop, job service, and mock cloud handshake.

- Added D15 Database as an executable Discovery stage with HARD prerequisites on D05 and D10.
- Introduced deterministic evidence validation that verifies all repository evidence paths against the sealed Startup workspace manifest before stage persistence.
- Enforced scope-evidence guard on loaded compiled prompts in the mock workflow server to prevent incompatible runtime packages.
- Updated stage execution manifest to mark D15 as available and restructured dependency relationships across all stages.
- Bumped ForgePilot version to 0.5.3 and updated documentation for stage execution and evidence authority rules.

- Relaxed D10 check ID pattern validation in mock-cloud to accept any regex matching the AR-001 to AR-082 range.
- Updated the verify-execution-protocol schema to use a more precise check ID pattern that restricts IDs to the valid AR-001 through AR-082 range.
- Improved compatibility detection by testing the pattern against sample IDs instead of requiring an exact regex string match.
- Moved Discovery stage catalog authority from project-local manifests to the AI Factory runtime package, published via the workflow server.
- Updated project workflow state to consume server-published stage metadata, removing project-local catalog loading.
- Added support for `FORGEPILOT_DISCOVERY_MANIFEST` environment variable to override the runtime manifest location.
- Clarified runtime versus project state ownership in documentation, separating stage catalog authority from project-specific artifacts.
- Updated AGENTS.md and README to reflect the new server-driven Discovery stage execution model.
