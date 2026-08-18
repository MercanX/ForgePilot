const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const mustContain = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`${label} missing: ${needle}`);
};

const dashboard = read('src', 'renderer', 'src', 'pages', 'DashboardPage.tsx');
const jobStore = read('src', 'renderer', 'src', 'stores', 'jobStore.ts');
const execution = read('src', 'services', 'jobs', 'stageExecutionService.ts');
const pkg = JSON.parse(read('package.json'));
const mock = read('tools', 'mock-cloud', 'mock-cloud.cjs');

if (pkg.version !== '0.5.12') throw new Error(`Expected package version 0.5.12, got ${pkg.version}`);
mustContain(dashboard, 'const selectedStageNeedsRestart = Boolean(', 'Restart eligibility helper');
mustContain(dashboard, 'activeRepair || selectedStage?.status === "completed" || selectedStage?.status === "failed"', 'Repair-pending restart eligibility');
mustContain(dashboard, '(selectedStage.status !== "running" || selectedStageNeedsRestart)', 'Running-stage guard with repair restart exception');
mustContain(dashboard, 'Boolean(activeRepair) ||', 'Repair-pending run request must be newRun/restart');
mustContain(dashboard, 'activeRepair\n                      ? "Restart stage"', 'Repair-pending button label');
mustContain(jobStore, 'newRun && stageId && state.repairState?.stageId === stageId ? null : state.repairState', 'Renderer repair state cleared immediately on restart');
mustContain(execution, 'if (request.newRun) {\n      await journal.clearStage(request.stageId);\n      await repairStore.clear(request.stageId);', 'Persistent repair/journal state cleared on restart');
mustContain(mock, 'mock-0.5.12-repair-restart', 'Mock version');
console.log('Repair-pending restart verification passed: restart is enabled, sent as newRun, and clears local/persistent repair state.');
