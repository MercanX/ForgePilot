ForgePilot local project state + stage tabs manual fix

Replace/add these files in your ForgePilot project, preserving the same paths:
- src/shared/schemas/run.ts
- src/services/jobs/projectWorkflowState.ts (NEW)
- src/services/jobs/jobService.ts
- src/services/jobs/stageExecutionService.ts
- src/renderer/src/stores/jobStore.ts
- src/renderer/src/pages/DashboardPage.tsx
- src/renderer/src/styles.css

This package intentionally does NOT replace tools/mock-cloud/mock-cloud.cjs, so your prior Startup single-verification edits are preserved.

Project state is stored at:
  <project>/.forgepilot/ai-factory-state.json

The existence of <project>/.ai-factory is treated as the physical AI Factory marker. If .ai-factory is deleted, the saved state is ignored and the UI resets to 010-Startup Ready.

Restarting a completed stage resets that stage and every stage after it.
