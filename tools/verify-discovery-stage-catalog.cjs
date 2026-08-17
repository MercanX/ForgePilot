const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

let ts;
try {
  ts = require('typescript');
} catch {
  ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
}

const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests/fixtures/discovery-stage-execution-manifest.json');

const waitForServer = async (url, attempts = 50) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mock cloud did not become ready: ${url}`);
};

(async () => {
  const manifest = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  assert.equal(manifest.stages.length, 14, 'Manifest must expose all 14 Discovery substages.');
  assert.deepEqual(
    manifest.stages.map((stage) => stage.order),
    [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]
  );
  assert.deepEqual(
    manifest.stages.find((stage) => stage.id === '020-d10-architecture').hard,
    ['020-d05-project-overview']
  );
  assert.deepEqual(
    manifest.stages.find((stage) => stage.id === '020-d15-database').hard,
    ['020-d05-project-overview', '020-d10-architecture']
  );

  const workflowStatePath = path.join(repoRoot, 'src/services/jobs/projectWorkflowState.ts');
  const workflowStateSource = await fs.readFile(workflowStatePath, 'utf8');
  assert.doesNotMatch(workflowStateSource, /loadDiscoveryStageCatalog/);
  assert.doesNotMatch(workflowStateSource, /STAGE-EXECUTION-MANIFEST\.json/);
  assert.match(workflowStateSource, /stage\.requirements\.map/);
  assert.match(workflowStateSource, /stage\.availability === "not_ready"/);
  assert.match(workflowStateSource, /Missing required stage:/);

  const jobServicePath = path.join(repoRoot, 'src/services/jobs/jobService.ts');
  const jobServiceSource = await fs.readFile(jobServicePath, 'utf8');
  assert.doesNotMatch(jobServiceSource, /project-local STAGE-EXECUTION-MANIFEST/);
  assert.match(jobServiceSource, /requestedStage\.availability === "not_ready"/);
  assert.match(jobServiceSource, /missingHardRequirements/);

  const mockCloudPath = path.join(repoRoot, 'tools/mock-cloud/mock-cloud.cjs');
  const mockCloudSource = await fs.readFile(mockCloudPath, 'utf8');
  assert.match(mockCloudSource, /FORGEPILOT_DISCOVERY_MANIFEST/);
  assert.match(mockCloudSource, /AI Factory Discovery stage execution manifest/);
  assert.doesNotMatch(mockCloudSource, /id: "030-context"/);
  assert.doesNotMatch(mockCloudSource, /id: "040-implementation"/);
  assert.doesNotMatch(mockCloudSource, /id: "050-validation"/);

  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'forgepilot-ai-factory-runtime-'));
  await fs.writeFile(
    path.join(runtimeRoot, 'STAGE-EXECUTION-MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await fs.mkdir(path.join(runtimeRoot, 'D05-Project-Overview'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'D10-Architecture'), { recursive: true });
  await fs.mkdir(path.join(runtimeRoot, 'D15-Database'), { recursive: true });

  const port = 46000 + Math.floor(Math.random() * 1000);
  const stateFile = path.join(runtimeRoot, 'mock-state.json');
  const child = spawn(process.execPath, [mockCloudPath], {
    env: {
      ...process.env,
      FORGEPILOT_MOCK_CLOUD_PORT: String(port),
      FORGEPILOT_DISCOVERY_MANIFEST: path.join(runtimeRoot, 'STAGE-EXECUTION-MANIFEST.json'),
      FORGEPILOT_MOCK_CLOUD_STATE_FILE: stateFile
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const response = await waitForServer(`http://127.0.0.1:${port}/workflows/current?projectId=catalog-test`);
    const workflow = await response.json();
    assert.equal(workflow.stages.length, 15, 'Workflow must expose Startup plus all 14 Discovery substages.');
    const ids = workflow.stages.map((stage) => stage.id);
    assert.equal(ids.includes('030-context'), false);
    assert.equal(ids.includes('040-implementation'), false);
    assert.equal(ids.includes('050-validation'), false);

    const d05 = workflow.stages.find((stage) => stage.id === '020-d05-project-overview');
    const d10 = workflow.stages.find((stage) => stage.id === '020-d10-architecture');
    const d15 = workflow.stages.find((stage) => stage.id === '020-d15-database');
    assert.equal(d05.availability, 'available');
    assert.equal(d10.availability, 'available');
    assert.equal(d15.availability, 'available');
    assert.deepEqual(d15.requirements.map((r) => r.stageId), ['020-d05-project-overview', '020-d10-architecture']);
    assert.equal(d10.requirements[0].stageId, '020-d05-project-overview');
    assert.equal(d10.requirements[0].type, 'hard');
  } finally {
    child.kill();
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }

  const dashboardPath = path.join(repoRoot, 'src/renderer/src/pages/DashboardPage.tsx');
  const dashboardSource = await fs.readFile(dashboardPath, 'utf8');
  assert.match(dashboardSource, />Requirements</);
  assert.match(dashboardSource, /Run requirement/);
  assert.match(dashboardSource, /Not Ready/);
  assert.match(dashboardSource, /findRunnableRequirementStage/);

  for (const file of [
    'src/shared/schemas/run.ts',
    'src/services/jobs/projectWorkflowState.ts',
    'src/services/jobs/jobService.ts',
    'src/renderer/src/pages/DashboardPage.tsx'
  ]) {
    const fullPath = path.join(repoRoot, file);
    const source = await fs.readFile(fullPath, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: fullPath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX
      },
      reportDiagnostics: true
    });
    const errors = (output.diagnostics || []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    );
    assert.equal(errors.length, 0, `${file} has TypeScript syntax diagnostics.`);
  }

  console.log('Discovery server-owned stage catalog verification: PASS');
  console.log('AI Factory runtime manifest source: PASS');
  console.log('Startup + 14/14 Discovery substages from workflow server: PASS');
  console.log('Legacy 030/040/050 workflow stages absent: PASS');
  console.log('D05/D10/D15 available and D20-D70 Not Ready model: PASS');
  console.log('Renderer/backend requirement guards: PASS');
  console.log('Modified TypeScript/TSX syntax diagnostics: 0');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
