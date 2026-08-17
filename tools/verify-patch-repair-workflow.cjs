const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const mustContain = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`${label} is missing: ${needle}`);
};
const mustNotContain = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`${label} still contains forbidden legacy behavior: ${needle}`);
};

const execution = read('src', 'services', 'jobs', 'stageExecutionService.ts');
const repairStore = read('src', 'services', 'jobs', 'stageRepairStore.ts');
const dashboard = read('src', 'renderer', 'src', 'pages', 'DashboardPage.tsx');
const jobStore = read('src', 'renderer', 'src', 'stores', 'jobStore.ts');
const preload = read('src', 'preload', 'index.ts');
const ipcJobs = read('src', 'main', 'ipc', 'jobs.ts');
const channels = read('src', 'shared', 'constants', 'channels.ts');
const adapter = read('src', 'main', 'providers', 'claudeCodeAdapter.ts');
const mockCloud = read('tools', 'mock-cloud', 'mock-cloud.cjs');

mustContain(repairStore, 'export const MAX_AUTO_REPAIR_ATTEMPTS = 5;', 'Five-attempt repair policy');
mustContain(repairStore, 'originalOutput: Record<string, unknown>;', 'Immutable original provider-output slot');
mustContain(repairStore, 'workingOutput: Record<string, unknown>;', 'Working repaired-output slot');
mustContain(repairStore, 'validationErrors: string[];', 'Persisted repair validation errors');
mustContain(repairStore, 'pending: RepairPendingDirective;', 'Persisted resumable directive');

mustContain(execution, '"ForgePilot JSON PATCH REPAIR."', 'Patch-only repair prompt');
mustContain(execution, '"This is NOT a new audit. Repository access is forbidden and no repository tools are available."', 'No-rescan repair prompt');
mustContain(execution, 'Preserve every value outside the allowed target paths exactly.', 'Minimal-change repair prompt');
mustContain(execution, 'allowed_target_paths=', 'Repair path allowlist');
mustContain(execution, 'REPAIR_PATCH_SCHEMA', 'Patch response schema');
mustContain(execution, 'applyRepairPatches', 'Patch application guard');
mustContain(execution, 'patchPreservesExistingContainer', 'Container preservation guard');
mustContain(execution, 'isRepairBaseViable', 'Fragment repair-base guard');
mustContain(execution, 'Manual AI Repair was not started because Working JSON is only a fragment', 'Fragment manual-repair stop');
mustContain(execution, 'enforceAuthority', 'Runtime metadata authority guard');
mustContain(execution, 'toolPolicy: "no-repository-tools"', 'No-tools repair invocation');
mustContain(execution, 'Automatic JSON patch repair ${attempt}/${MAX_AUTO_REPAIR_ATTEMPTS}', 'Provider contract 1/5 repair progress');
mustContain(execution, 'Automatic JSON patch repair ${repairNumber}/${MAX_AUTO_REPAIR_ATTEMPTS}', 'Deterministic-save 1/5 repair progress');
mustContain(execution, 'Manual Repair is available', 'Manual repair fallback');
mustContain(execution, 'const importRepairJson = async', 'Existing JSON import without audit rerun');
mustContain(execution, 'provider audit will not run', 'Existing JSON import no-rescan guarantee');
mustContain(execution, 'const manualRepair = async', 'Manual AI repair action');
mustContain(execution, 'const validateRepairJson = async', 'Editable JSON validation action');
mustContain(execution, 'const saveRepair = async', 'Manual repaired-result save action');
mustContain(execution, 'if (record.validationErrors.length > 0)', 'Save gate for known validation errors');

for (const protectedField of ['audit_id', 'workspace_hash', 'substage', 'schema_version']) {
  mustContain(execution, protectedField, `Authority field ${protectedField}`);
}

mustContain(adapter, 'toolPolicy === "no-repository-tools"', 'Claude no-repository-tools policy');
mustContain(adapter, '"Read,Glob,Grep,Edit,Write,Bash,PowerShell,Agent"', 'Repair tool denylist');

for (const channel of ['repairState', 'repairImport', 'repairValidate', 'repairManual', 'repairSave']) {
  mustContain(channels, `${channel}:`, `IPC channel ${channel}`);
  mustContain(ipcJobs, `IPC_CHANNELS.jobs.${channel}`, `IPC handler ${channel}`);
}
for (const bridge of ['repairState:', 'repairImport:', 'repairValidate:', 'repairManual:', 'repairSave:']) {
  mustContain(preload, bridge, `Preload repair bridge ${bridge}`);
}

mustContain(jobStore, 'repairState: StageRepairState | null;', 'Renderer repair state');
mustContain(jobStore, 'importRepairJson:', 'Renderer existing-JSON import action');
mustContain(jobStore, 'validateRepairJson:', 'Renderer Validate action');
mustContain(jobStore, 'manualRepair:', 'Renderer Manual Repair action');
mustContain(jobStore, 'saveRepair:', 'Renderer Save Repair action');

mustContain(dashboard, 'Recover existing JSON', 'Failed-run existing JSON recovery panel');
mustContain(dashboard, 'Prepare existing JSON for repair', 'Existing JSON recovery action');
mustContain(dashboard, 'Validate edited JSON', 'Editable JSON validate button');
mustContain(dashboard, 'Manual Repair with AI', 'Manual AI repair button');
mustContain(dashboard, 'Restore original provider JSON', 'Restore original repair action');
mustContain(dashboard, 'Load full provider JSON', 'Load full provider JSON repair action');
mustContain(dashboard, 'Repair base is incomplete', 'Fragment warning UI');
mustContain(dashboard, 'Save repaired result', 'Repaired-result save button');
mustContain(dashboard, 'Auto repair: {activeRepair.autoAttempts}/{activeRepair.maxAutoAttempts}', 'Repair attempt counter');
mustContain(dashboard, 'disabled={isRunning || !activeRepair.canSave}', 'Save disabled until valid');
mustContain(dashboard, 'Original provider output is preserved', 'UI original-output preservation notice');

mustContain(mockCloud, 'mock-0.5.11-repair-root-guard', 'Updated mock-cloud version');
mustContain(mockCloud, 'provider retry watch + schema-aware root selection + fragment-safe JSON patch/manual repair workflow', 'Updated handshake repair description');
// The legacy helper may remain as dead code for compatibility, but nextDirectiveFor must not schedule it.
const nextDirectiveStart = mockCloud.indexOf('const nextDirectiveFor = (session) => {');
const applyPreviousStart = mockCloud.indexOf('const applyPreviousResult = (session, previous) => {');
if (nextDirectiveStart < 0 || applyPreviousStart < 0) throw new Error('Could not locate mock-cloud directive routing.');
const nextDirectiveBody = mockCloud.slice(nextDirectiveStart, applyPreviousStart);
mustNotContain(nextDirectiveBody, 'contractRepairDirectiveFor', 'Server directive routing');
mustNotContain(nextDirectiveBody, 'DISCOVERY_CONTRACT_REPAIR', 'Server directive routing');

console.log('Patch repair workflow verification passed (5x path-limited patch repair, authority lock, original/working preservation, no-rescan AI repair, Manual Repair, editable Validate, gated Save, and no server-side replacement-audit repair scheduling).');

// Functional regression: compile the real patch helpers and prove that only allowed paths move,
// while ForgePilot authority metadata wins over AI-proposed values.
const Module = require('node:module');
const typescriptPath = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'typescript');
const ts = require(typescriptPath);
const stageSourcePath = path.join(root, 'src', 'services', 'jobs', 'stageExecutionService.ts');
const testSource = `${execution}\nexport { allowedRepairPaths, applyRepairPatches, enforceAuthority };\n`;
const compiled = ts.transpileModule(testSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: stageSourcePath,
  reportDiagnostics: true
});
const syntaxErrors = (compiled.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
if (syntaxErrors.length) throw new Error(`Patch helper transpile failed: ${syntaxErrors.map((x) => x.messageText).join('; ')}`);
const runtimeModule = { exports: {} };
const mockRequire = (id) => {
  if (id === '@shared/constants/providerIds') return { PROVIDER_IDS: { claudeCode: 'claude-code', codex: 'codex' } };
  if (id === '@shared/constants/protocolVersion') return { SUPPORTED_CAPABILITIES: [] };
  if (id === '@shared/schemas/cloud-api' || id === '@shared/schemas/execution') return {};
  if (id === '../api/httpClient') return { createHttpClient: () => { throw new Error('unused'); } };
  if (id === '../tasks/taskExecutionService') return { createTaskExecutionService: () => { throw new Error('unused'); } };
  if (id === './localOperationRegistry') return { createLocalOperationRegistry: () => { throw new Error('unused'); } };
  if (id === './stageExecutionJournal') return { createStageExecutionJournal: () => { throw new Error('unused'); } };
  if (id === './stageRepairStore') return { MAX_AUTO_REPAIR_ATTEMPTS: 5, createStageRepairStore: () => { throw new Error('unused'); } };
  return Module.createRequire(stageSourcePath)(id);
};
new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText)(
  mockRequire, runtimeModule, runtimeModule.exports, stageSourcePath, path.dirname(stageSourcePath)
);
const { allowedRepairPaths, applyRepairPatches, isRepairBaseViable } = runtimeModule.exports;
if (typeof allowedRepairPaths !== 'function' || typeof applyRepairPatches !== 'function' || typeof isRepairBaseViable !== 'function') {
  throw new Error('Real patch helpers could not be loaded for functional verification.');
}
const working = {
  audit_id: 'AUD-002', schema_version: '1.0', substage: 'D05-Project-Overview', workspace_hash: 'sealed-hash',
  result: { summary: 'keep/repair me', findings: [{ id: 'D05-F01', title: 'must stay' }] }
};
const authority = { audit_id: 'AUD-002', schema_version: '1.0', substage: 'D05-Project-Overview', workspace_hash: 'sealed-hash' };
const allowed = allowedRepairPaths(['$.result.summary: required property is missing'], working);
const patched = applyRepairPatches(working, { patches: [
  { op: 'replace', path: '$.result.summary', value: 'fixed summary' },
  { op: 'replace', path: '$.result.findings[0].title', value: 'illegal rewrite' },
  { op: 'replace', path: '$.audit_id', value: 'AI-INVENTED' }
] }, allowed, authority).value;
if (patched.result.summary !== 'fixed summary') throw new Error('Allowed repair path was not patched.');
if (patched.result.findings[0].title !== 'must stay') throw new Error('Patch repair modified an unrelated semantic path.');
if (patched.audit_id !== 'AUD-002') throw new Error('Repair AI overrode ForgePilot audit_id authority.');
console.log('Functional patch guard regression passed (allowed path changed; unrelated semantic path rejected; authority metadata preserved).');

const destructiveBase = {
  audit_id: 'AUD-002', completed_at: '2026-08-18T00:00:00Z', schema_version: '1.0',
  substage: 'D15-Database', workspace_hash: 'sealed-hash',
  result: { summary: 'keep', findings: [{ id: 'DB-F001', title: 'must survive' }] }
};
const destructive = applyRepairPatches(
  destructiveBase,
  { patches: [{ op: 'replace', path: '$.result', value: { summary: 'replacement that drops findings' } }] },
  ['$.result'],
  { audit_id: 'AUD-002', schema_version: '1.0', substage: 'D15-Database', workspace_hash: 'sealed-hash' }
).value;
if (!destructive.result.findings || destructive.result.findings[0].title !== 'must survive') {
  throw new Error('Repair replaced a non-empty result container and discarded existing semantic content.');
}
const moveGuard = applyRepairPatches(
  destructiveBase,
  { patches: [{ op: 'move', from: '$.result.findings[0].title', path: '$.result.summary' }] },
  ['$.result.summary'],
  { audit_id: 'AUD-002', schema_version: '1.0', substage: 'D15-Database', workspace_hash: 'sealed-hash' }
).value;
if (moveGuard.result.summary !== 'keep' || moveGuard.result.findings[0].title !== 'must survive') {
  throw new Error('Repair move consumed an unrelated source path outside the allowlist.');
}
const viabilitySchema = {
  type: 'object', required: ['audit_id', 'completed_at', 'schema_version', 'substage', 'workspace_hash', 'result'],
  properties: { result: { type: 'object', required: ['summary', 'findings', 'checklist', 'handoff'] } }
};
const d15HandoffFragment = {
  recommended_next_substages: [],
  cautions: ['preserved tail'],
  audit_id: 'AUD-002',
  workspace_hash: 'sealed-hash',
  schema_version: '1.0',
  substage: 'D15-Database'
};
if (isRepairBaseViable(d15HandoffFragment, viabilitySchema)) {
  throw new Error('D15 handoff tail + authority fields was incorrectly accepted as an AI repair base.');
}
if (!isRepairBaseViable(destructiveBase, viabilitySchema)) {
  throw new Error('A real envelope with semantic result content was incorrectly rejected as a repair base.');
}
console.log('Fragment/container repair guards passed (no destructive replacement, no unrelated move source, handoff fragment rejected).');

// Functional legacy/current failed-run recovery: importing an already-produced JSON must advance
// only through local preparation, stop at the provider directive, and later save that JSON without
// starting a provider process/repository audit.
const { createStageExecutionService } = runtimeModule.exports;
if (typeof createStageExecutionService !== 'function') throw new Error('Stage execution service export missing.');
let repairRecord = null;
let providerStarts = 0;
let providerResultSubmits = 0;
let localSaveCalls = 0;
let executionIdValue = null;
const fakeRepairStore = {
  clear: async () => { repairRecord = null; },
  get: async () => repairRecord,
  save: async (record) => { repairRecord = JSON.parse(JSON.stringify(record)); },
  toPublicState: async (stageId) => repairRecord ? ({
    available: true,
    autoAttempts: repairRecord.autoAttempts,
    canManualRepair: repairRecord.validationErrors.length > 0 && !!repairRecord.workingOutput.result,
    canSave: repairRecord.validationErrors.length === 0,
    changedPaths: repairRecord.changedPaths,
    manualAttempts: repairRecord.manualAttempts,
    maxAutoAttempts: repairRecord.maxAutoAttempts,
    originalJson: JSON.stringify(repairRecord.originalOutput, null, 2),
    repairBaseWarning: repairRecord.workingOutput.result ? null : 'fragment',
    stageId,
    status: repairRecord.validationErrors.length === 0 ? 'ready_to_save' : 'needs_manual',
    updatedAt: repairRecord.updatedAt,
    validationErrors: repairRecord.validationErrors,
    workingJson: JSON.stringify(repairRecord.workingOutput, null, 2)
  }) : ({
    available: false, autoAttempts: 0, canManualRepair: false, canSave: false, changedPaths: [], manualAttempts: 0,
    maxAutoAttempts: 5, originalJson: null, repairBaseWarning: null, stageId, status: null, updatedAt: null, validationErrors: [], workingJson: null
  })
};
const fakeJournal = {
  clearStage: async () => { executionIdValue = null; },
  getExecutionId: async () => executionIdValue,
  getLocalResult: async () => ({ found: false, output: null }),
  saveLocalResult: async () => {},
  setExecutionId: async (_stageId, id) => { executionIdValue = id; }
};
const fakeLocalOperations = {
  list: () => ['discovery.d05-status', 'discovery.save-d05-result'],
  execute: async (operation, _root, inputs) => {
    if (operation === 'discovery.d05-status') {
      return { audit_id: 'AUD-002', workspace_hash: 'sealed-hash' };
    }
    if (operation === 'discovery.save-d05-result') {
      localSaveCalls += 1;
      if (!inputs || !inputs.result || inputs.result.audit_id !== 'AUD-002') {
        throw new Error('save received wrong repaired JSON');
      }
      return { result: 'PASS', finding_count: 0, unknown_count: 0, checklist_count: 0 };
    }
    throw new Error(`unexpected local operation ${operation}`);
  }
};
const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['audit_id', 'completed_at', 'schema_version', 'substage', 'workspace_hash', 'result'],
  properties: {
    audit_id: { type: 'string' }, completed_at: { type: 'string' },
    schema_version: { type: 'string', const: '1.0' },
    substage: { type: 'string', const: 'D05-Project-Overview' }, workspace_hash: { type: 'string' },
    result: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } }, additionalProperties: true }
  }
};
const EX = '11111111-1111-4111-8111-111111111111';
const STATUS = '22222222-2222-4222-8222-222222222222';
const PROVIDER = '33333333-3333-4333-8333-333333333333';
const SAVE = '44444444-4444-4444-8444-444444444444';
const JOB = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';
const terminal = '77777777-7777-4777-8777-777777777777';
const baseDirective = (id, kind, extra = {}) => ({
  id, kind, messageStarted: 'started', messageCompleted: 'completed', progressStarted: 20, progressCompleted: 80, ...extra
});
const fakeClient = {
  get: async () => { throw new Error('unexpected GET'); },
  post: async (url, body) => {
    if (url === `/jobs/${JOB}/result`) {
      providerResultSubmits += 1;
      return { accepted: true };
    }
    if (url !== '/executions/next') throw new Error(`unexpected POST ${url}`);
    const previous = body.previous;
    if (!previous) {
      return { executionId: EX, stageId: '020-d05-project-overview', directive: baseDirective(STATUS, 'local', {
        operation: 'discovery.d05-status', inputs: {}, saveAs: 'd05Status'
      }) };
    }
    if (previous.directiveId === STATUS) {
      return { executionId: EX, stageId: '020-d05-project-overview', directive: baseDirective(PROVIDER, 'provider', {
        mode: 'semantic', outputSchema, requireOk: false, saveAs: 'd05Audit',
        job: {
          id: JOB, runId: '88888888-8888-4888-8888-888888888888', stageId: '020-d05-project-overview',
          providerId: 'claude-code', status: 'received', startedAt: new Date().toISOString(), finishedAt: null, exitCode: null,
          task: { id: TASK, jobId: JOB, timeoutMs: 1000, instructions: { body: 'should never execute', format: 'plain-text', metadata: {} } }
        }
      }) };
    }
    if (previous.directiveId === PROVIDER) {
      return { executionId: EX, stageId: '020-d05-project-overview', directive: baseDirective(SAVE, 'local', {
        operation: 'discovery.save-d05-result', inputs: {}, saveAs: 'd05Saved', progressStarted: 90, progressCompleted: 95
      }) };
    }
    if (previous.directiveId === SAVE) {
      return { executionId: EX, stageId: '020-d05-project-overview', directive: {
        id: terminal, kind: 'terminal', message: 'completed from imported JSON', outcome: 'completed', progress: 100
      } };
    }
    throw new Error(`unexpected previous ${previous.directiveId}`);
  }
};
const fakeTaskExecutionService = {
  start: async () => { providerStarts += 1; throw new Error('provider must not run during imported-JSON recovery'); }
};
const service = createStageExecutionService({
  createClient: () => fakeClient,
  localOperationRegistry: fakeLocalOperations,
  taskExecutionService: fakeTaskExecutionService,
  createJournal: () => fakeJournal,
  createRepairStore: () => fakeRepairStore
});
const requestBase = {
  project: { id: 'project-1', name: 'fixture', rootPath: '/tmp/fixture' },
  providerId: 'claude-code', model: 'sonnet', serverUrl: 'http://fixture', outputLanguage: 'Turkish',
  timeoutMs: 300000, newRun: false, stageId: '020-d05-project-overview'
};
const importedJson = JSON.stringify({
  audit_id: 'AI-WRONG-ID', completed_at: '2026-08-17T20:00:00Z', schema_version: '1.0',
  substage: 'D05-Project-Overview', workspace_hash: 'AI-WRONG-HASH', result: { summary: 'existing audit result' }
});
(async () => {
  const state = await service.importRepairJson({ ...requestBase, workingJson: importedJson });
  if (!state.available || !state.canSave) throw new Error(`Imported valid JSON did not become save-ready: ${JSON.stringify(state)}`);
  const workingImported = JSON.parse(state.workingJson);
  if (workingImported.audit_id !== 'AUD-002' || workingImported.workspace_hash !== 'sealed-hash') {
    throw new Error('Imported JSON did not receive ForgePilot authority metadata.');
  }
  if (providerStarts !== 0) throw new Error('Import recovery unexpectedly started the provider audit.');
  const saved = await service.saveRepair(requestBase);
  if (saved.stageOutcome.status !== 'completed') throw new Error('Imported repaired JSON did not complete the stage.');
  if (providerStarts !== 0) throw new Error('Saving imported JSON unexpectedly reran the provider audit.');
  if (providerResultSubmits !== 1) throw new Error(`Imported provider result was not registered exactly once (${providerResultSubmits}).`);
  if (localSaveCalls !== 1) throw new Error(`Deterministic stage save did not run exactly once (${localSaveCalls}).`);
  console.log('Existing failed-run JSON recovery regression passed (load existing JSON -> authority lock -> no provider run -> register result -> deterministic save -> terminal completed).');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
