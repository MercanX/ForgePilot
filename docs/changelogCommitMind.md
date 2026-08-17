# Changelog CommitMind

## 2026-08-17 — Discovery stage catalog ve dependency UI

ForgePilot Discovery stage görünürlüğü AI Factory runtime içindeki `STAGE-EXECUTION-MANIFEST.json` dosyasını okuyan workflow server tarafından sağlanır. Tüm D05–D70 substages UI'da görünür hale getirildi; executable olmayan stage'ler `Not Ready`, eksik HARD dependency'ler `Run requirement`, hazır stage'ler `Start stage` davranışı aldı. Backend execution guard ve manifest cycle validation eklendi.

## 2026-08-17

- Relaxed D10 check ID pattern validation in mock-cloud to accept any regex matching the AR-001 to AR-082 range.
- Updated the verify-execution-protocol schema to use a more precise check ID pattern that restricts IDs to the valid AR-001 through AR-082 range.
- Improved compatibility detection by testing the pattern against sample IDs instead of requiring an exact regex string match.
- Moved Discovery stage catalog authority from project-local manifests to the AI Factory runtime package, published via the workflow server.
- Updated project workflow state to consume server-published stage metadata, removing project-local catalog loading.
- Added support for `FORGEPILOT_DISCOVERY_MANIFEST` environment variable to override the runtime manifest location.
- Clarified runtime versus project state ownership in documentation, separating stage catalog authority from project-specific artifacts.
- Updated AGENTS.md and README to reflect the new server-driven Discovery stage execution model.
