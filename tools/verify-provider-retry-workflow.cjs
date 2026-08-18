const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const mustContain = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`${label} is missing: ${needle}`);
};

const execution = read('src', 'services', 'jobs', 'stageExecutionService.ts');
const jobService = read('src', 'services', 'jobs', 'jobService.ts');
const channels = read('src', 'shared', 'constants', 'channels.ts');
const ipc = read('src', 'shared', 'schemas', 'ipc.ts');
const ipcJobs = read('src', 'main', 'ipc', 'jobs.ts');
const preload = read('src', 'preload', 'index.ts');
const jobStore = read('src', 'renderer', 'src', 'stores', 'jobStore.ts');
const dashboard = read('src', 'renderer', 'src', 'pages', 'DashboardPage.tsx');
const mockCloud = read('tools', 'mock-cloud', 'mock-cloud.cjs');

mustContain(execution, 'PROVIDER_FAST_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000]', 'Fast retry schedule');
mustContain(execution, 'PROVIDER_WATCH_RETRY_INTERVAL_MS = 300_000', 'Five-minute provider watch');
mustContain(execution, 'isRetryableProviderFailure(result, outputChunks)', 'Retryable provider failure gate');
mustContain(execution, 'Provider is still unavailable after ${providerRetryDelaysMs.length} fast retries', 'Indefinite watch transition');
mustContain(execution, 'will retry every ${formatRetryDelay(providerWatchIntervalMs)} until the provider returns', 'Indefinite retry policy');
mustContain(execution, 'const retryProviderNow = (', 'Manual provider retry trigger');
mustContain(execution, 'provider-retry-wait:', 'Provider waiting progress state');
mustContain(execution, 'provider-retry-attempt:', 'Provider retry attempt progress state');
mustContain(execution, 'provider-retry-recovered:', 'Provider recovery progress state');

mustContain(channels, 'retryProviderNow: "jobs:retry-provider-now"', 'Retry IPC channel');
mustContain(ipc, 'providerRetryNowRequestSchema', 'Retry IPC request schema');
mustContain(ipcJobs, 'IPC_CHANNELS.jobs.retryProviderNow', 'Retry IPC handler');
mustContain(preload, 'retryProviderNow:', 'Retry preload bridge');
mustContain(jobService, 'stageExecutionService.retryProviderNow(projectId, stageId)', 'Job-service retry bridge');
mustContain(jobStore, 'providerRetryWaiting: boolean;', 'Renderer retry waiting state');
mustContain(jobStore, 'retryProviderNow: async (projectId, stageId)', 'Renderer manual retry action');
mustContain(dashboard, 'Retry provider now', 'Dashboard manual retry button');
mustContain(dashboard, 'Waiting for provider', 'Dashboard provider waiting state');
mustContain(mockCloud, 'mock-0.5.12-repair-restart', 'Updated mock-cloud version');

const tsPath = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'typescript');
const ts = require(tsPath);
const modified = [
  'src/services/jobs/stageExecutionService.ts',
  'src/services/jobs/jobService.ts',
  'src/main/ipc/jobs.ts',
  'src/preload/index.ts',
  'src/shared/schemas/ipc.ts',
  'src/shared/constants/channels.ts',
  'src/renderer/src/stores/jobStore.ts',
  'src/renderer/src/pages/DashboardPage.tsx'
];
for (const file of modified) {
  const source = read(...file.split('/'));
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true
    },
    fileName: path.join(root, file),
    reportDiagnostics: true
  });
  const errors = (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(`${file} transpile failed: ${errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  }
}

const stageSourcePath = path.join(root, 'src', 'services', 'jobs', 'stageExecutionService.ts');
const compiledStage = ts.transpileModule(execution, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  fileName: stageSourcePath,
  reportDiagnostics: true
});
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
new Function('require', 'module', 'exports', '__filename', '__dirname', compiledStage.outputText)(
  mockRequire, runtimeModule, runtimeModule.exports, stageSourcePath, path.dirname(stageSourcePath)
);
const {
  createStageExecutionService,
  isRetryableProviderFailure,
  PROVIDER_FAST_RETRY_DELAYS_MS,
  PROVIDER_WATCH_RETRY_INTERVAL_MS
} = runtimeModule.exports;

if (JSON.stringify(PROVIDER_FAST_RETRY_DELAYS_MS) !== JSON.stringify([5000, 15000, 30000, 60000, 120000])) {
  throw new Error('Runtime fast retry schedule mismatch.');
}
if (PROVIDER_WATCH_RETRY_INTERVAL_MS !== 300000) throw new Error('Runtime watch interval mismatch.');
const transientChunks = [{ stream: 'stdout', text: 'API Error: Connection lost mid-response.', timestamp: new Date().toISOString() }];
if (!isRetryableProviderFailure({ status: 'failed', exitCode: 1 }, transientChunks)) {
  throw new Error('Connection-lost provider error was not classified as retryable.');
}
if (isRetryableProviderFailure({ status: 'failed', exitCode: 1 }, [{ stream: 'stderr', text: 'Invalid model name', timestamp: new Date().toISOString() }])) {
  throw new Error('Permanent provider configuration error was incorrectly classified as retryable.');
}

const outputListeners = new Set();
const exitListeners = new Set();
let starts = 0;
const taskService = {
  onOutput(cb) { outputListeners.add(cb); return () => outputListeners.delete(cb); },
  onExit(cb) { exitListeners.add(cb); return () => exitListeners.delete(cb); },
  stop() { return true; },
  dispose() {},
  async start() {
    starts += 1;
    const id = `${String(starts).padStart(8, '0')}-1111-4111-8111-111111111111`;
    const startedAt = new Date().toISOString();
    if (starts === 1) {
      const chunk = {
        stream: 'stdout',
        text: `${JSON.stringify({ type: 'result', is_error: true, result: 'API Error: Connection lost mid-response.' })}\n`,
        timestamp: startedAt
      };
      for (const cb of outputListeners) cb({ taskId: id, providerId: 'claude-code', chunk });
      for (const cb of exitListeners) cb({ taskId: id, providerId: 'claude-code', exitInfo: { exitCode: 1, signal: null, finishedAt: new Date().toISOString() } });
    } else {
      const payload = JSON.stringify({ value: 'recovered' });
      const chunk = {
        stream: 'stdout',
        text: `${JSON.stringify({ type: 'result', is_error: false, result: payload })}\n`,
        timestamp: startedAt
      };
      for (const cb of outputListeners) cb({ taskId: id, providerId: 'claude-code', chunk });
      for (const cb of exitListeners) cb({ taskId: id, providerId: 'claude-code', exitInfo: { exitCode: 0, signal: null, finishedAt: new Date().toISOString() } });
    }
    return { handle: { id, providerId: 'claude-code', processId: 1000 + starts }, startedAt, command: 'claude', args: [] };
  }
};

const EX = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DIR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TERM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let submittedResults = 0;
const task = { id: TASK, jobId: JOB, timeoutMs: 1000, instructions: { body: 'global provider retry test', format: 'plain-text', metadata: {} } };
const job = { id: JOB, runId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', stageId: '020-any-stage', providerId: 'claude-code', status: 'received', task, startedAt: null, finishedAt: null, exitCode: null };
const fakeClient = {
  async get(url) {
    if (url === `/jobs/${JOB}`) return task;
    throw new Error(`unexpected GET ${url}`);
  },
  async post(url, body) {
    if (url === '/executions/next') {
      if (!body.previous) {
        return {
          executionId: EX,
          stageId: '020-any-stage',
          directive: {
            id: DIR,
            kind: 'provider',
            mode: 'semantic',
            messageStarted: 'provider start',
            messageCompleted: 'provider complete',
            progressStarted: 20,
            progressCompleted: 80,
            requireOk: false,
            saveAs: 'result',
            outputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'string' } }, additionalProperties: false },
            job
          }
        };
      }
      if (body.previous.directiveId === DIR && body.previous.status === 'completed') {
        return { executionId: EX, stageId: '020-any-stage', directive: { id: TERM, kind: 'terminal', outcome: 'completed', message: 'done', progress: 100 } };
      }
      throw new Error(`unexpected previous ${JSON.stringify(body.previous)}`);
    }
    if (url === `/jobs/${JOB}/result`) {
      submittedResults += 1;
      if (body.status !== 'completed') throw new Error('Transient failed attempt must not be submitted as final provider result.');
      return { accepted: true, findings: [] };
    }
    if (url === '/findings/sync') return { accepted: true };
    if (url === `/jobs/${JOB}/heartbeat`) return { accepted: true };
    if (url === `/jobs/${JOB}/fail`) throw new Error('Retryable provider failure must not fail the cloud job.');
    throw new Error(`unexpected POST ${url}`);
  }
};
let executionId = null;
const fakeJournal = {
  clearStage: async () => { executionId = null; },
  getExecutionId: async () => executionId,
  setExecutionId: async (_stageId, id) => { executionId = id; },
  getLocalResult: async () => ({ found: false, output: null }),
  saveLocalResult: async () => {}
};
const fakeRepairStore = { clear: async () => {}, get: async () => null, save: async () => {}, toPublicState: async () => ({ available: false, autoAttempts: 0, canManualRepair: false, canSave: false, changedPaths: [], manualAttempts: 0, maxAutoAttempts: 5, originalJson: null, repairBaseWarning: null, stageId: '020-any-stage', status: null, updatedAt: null, validationErrors: [], workingJson: null }) };
const service = createStageExecutionService({
  createClient: () => fakeClient,
  localOperationRegistry: { list: () => [], execute: async () => { throw new Error('unused'); } },
  taskExecutionService: taskService,
  createJournal: () => fakeJournal,
  createRepairStore: () => fakeRepairStore,
  providerRetryDelaysMs: [60000],
  providerWatchIntervalMs: 60000
});

let manualAccepted = false;
(async () => {
  const response = await service.run({
    project: { id: '12345678-1234-4234-8234-123456789abc', name: 'fixture', rootPath: '/tmp/fixture' },
    providerId: 'claude-code',
    model: 'sonnet',
    newRun: true,
    stageId: '020-any-stage',
    serverUrl: 'http://localhost:4317',
    outputLanguage: 'Turkish',
    timeoutMs: 1000
  }, (event) => {
    if (event.stepId.startsWith('provider-retry-wait:')) {
      const retry = service.retryProviderNow('12345678-1234-4234-8234-123456789abc', '020-any-stage');
      manualAccepted = retry.accepted;
    }
  });
  if (!manualAccepted) throw new Error('Manual retry did not wake the active provider wait.');
  if (starts !== 2) throw new Error(`Expected exactly 2 provider processes, got ${starts}.`);
  if (submittedResults !== 1) throw new Error(`Expected only recovered provider result to be submitted, got ${submittedResults}.`);
  if (response.stageOutcome.status !== 'completed') throw new Error('Stage did not complete after provider recovery.');
  console.log('PASS provider retry workflow');
  console.log('- transient connection/API failure: kept stage running');
  console.log('- manual Retry provider now: woke retry wait immediately');
  console.log('- transient failed attempt: not submitted as final result');
  console.log('- recovered provider attempt: continued same stage to completion');
  console.log('- policy is generic in executeProvider: applies to every provider-backed stage');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
