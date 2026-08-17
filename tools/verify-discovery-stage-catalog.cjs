const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src/services/discovery/discoveryStageCatalogService.ts');
const fixturePath = path.join(repoRoot, 'tests/fixtures/discovery-stage-execution-manifest.json');

const transpileToCommonJs = (source, fileName) => {
  const output = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true
    },
    reportDiagnostics: true
  });
  const errors = (output.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `TypeScript parse diagnostics: ${errors.map((d) => d.messageText).join('; ')}`);
  return output.outputText;
};

const loadCatalogModule = async (tempRoot) => {
  const source = await fsp.readFile(sourcePath, 'utf8');
  const compiled = transpileToCommonJs(source, sourcePath);
  const modulePath = path.join(tempRoot, 'discoveryStageCatalogService.cjs');
  await fsp.writeFile(modulePath, compiled, 'utf8');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
};

const makeProject = async (manifest) => {
  const projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'forgepilot-stage-catalog-'));
  const discoveryRoot = path.join(projectRoot, '.ai-factory', '020-Discovery');
  await fsp.mkdir(discoveryRoot, { recursive: true });
  await fsp.writeFile(
    path.join(discoveryRoot, 'STAGE-EXECUTION-MANIFEST.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await fsp.mkdir(path.join(discoveryRoot, 'D05-Project-Overview'), { recursive: true });
  await fsp.mkdir(path.join(discoveryRoot, 'D10-Architecture'), { recursive: true });
  return projectRoot;
};

(async () => {
  const manifest = JSON.parse(await fsp.readFile(fixturePath, 'utf8'));
  assert.equal(manifest.stages.length, 14, 'Manifest must expose all 14 Discovery substages.');
  assert.deepEqual(
    manifest.stages.map((stage) => stage.order),
    [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70]
  );

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'forgepilot-stage-catalog-module-'));
  const { loadDiscoveryStageCatalog } = await loadCatalogModule(tempRoot);
  const projectRoot = await makeProject(manifest);
  const catalog = await loadDiscoveryStageCatalog(projectRoot);

  assert.equal(catalog.length, 14);
  assert.equal(catalog.find((stage) => stage.substage === 'D05-Project-Overview').available, true);
  assert.equal(catalog.find((stage) => stage.substage === 'D10-Architecture').available, true);
  assert.equal(catalog.find((stage) => stage.substage === 'D15-Database').available, false);
  assert.equal(catalog.find((stage) => stage.substage === 'D70-Final-Discovery-Report').available, false);

  const d10 = catalog.find((stage) => stage.substage === 'D10-Architecture');
  assert.deepEqual(d10.hard, ['020-d05-project-overview']);

  await fsp.rm(path.join(projectRoot, '.ai-factory', '020-Discovery', 'D10-Architecture'), { recursive: true, force: true });
  const missingPackageCatalog = await loadDiscoveryStageCatalog(projectRoot);
  const missingD10 = missingPackageCatalog.find((stage) => stage.substage === 'D10-Architecture');
  assert.equal(missingD10.available, false);
  assert.match(missingD10.availability_message, /not installed/i);

  const cycleManifest = structuredClone(manifest);
  cycleManifest.stages.find((stage) => stage.id === '020-d05-project-overview').hard = ['020-d10-architecture'];
  const cycleProject = await makeProject(cycleManifest);
  await assert.rejects(() => loadDiscoveryStageCatalog(cycleProject), /cycle/i);

  const runSchemaSource = await fsp.readFile(path.join(repoRoot, 'src/shared/schemas/run.ts'), 'utf8');
  assert.match(runSchemaSource, /stageAvailabilitySchema/);
  assert.match(runSchemaSource, /stageRequirementSchema/);
  assert.match(runSchemaSource, /availabilityMessage/);
  assert.match(runSchemaSource, /requirements:/);

  const workflowStateSource = await fsp.readFile(path.join(repoRoot, 'src/services/jobs/projectWorkflowState.ts'), 'utf8');
  assert.match(workflowStateSource, /loadDiscoveryStageCatalog/);
  assert.match(workflowStateSource, /Missing required stage:/);
  assert.match(workflowStateSource, /workflow server does not expose an execution directive yet/);

  // Execute the real mergeWorkflow implementation with controlled runtime stubs.
  const integrationRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'forgepilot-workflow-merge-'));
  const jobsDir = path.join(integrationRoot, 'src/services/jobs');
  const discoveryDir = path.join(integrationRoot, 'src/services/discovery');
  const startupDir = path.join(integrationRoot, 'src/services/startup');
  await Promise.all([fsp.mkdir(jobsDir, { recursive: true }), fsp.mkdir(discoveryDir, { recursive: true }), fsp.mkdir(startupDir, { recursive: true })]);
  await fsp.writeFile(
    path.join(jobsDir, 'projectWorkflowState.js'),
    transpileToCommonJs(workflowStateSource, 'projectWorkflowState.ts'),
    'utf8'
  );
  await fsp.writeFile(
    path.join(discoveryDir, 'discoveryStageCatalogService.js'),
    `exports.loadDiscoveryStageCatalog = async () => global.__forgepilotStageTest.catalog;\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(discoveryDir, 'discoverySubstageService.js'),
    `exports.runD05StatusJob = async () => ({ state: global.__forgepilotStageTest.d05 ? 'completed' : 'ready' });\nexports.runD10StatusJob = async () => ({ state: global.__forgepilotStageTest.d10 ? 'completed' : 'ready' });\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(startupDir, 'startupJobService.js'),
    `exports.runScopeStatusJob = async () => ({ sealed: global.__forgepilotStageTest.startup });\n`,
    'utf8'
  );

  const mergeProject = await fsp.mkdtemp(path.join(os.tmpdir(), 'forgepilot-merge-project-'));
  await fsp.mkdir(path.join(mergeProject, '.ai-factory'), { recursive: true });
  const fixtureCatalog = manifest.stages.map((stage) => ({
    ...stage,
    package_present: stage.implementation_status === 'available',
    available: stage.implementation_status === 'available',
    availability_message: stage.implementation_status === 'available' ? null : 'Stage package is defined but not implemented yet.'
  }));
  const cloudStages = [
    { id: '010-startup', name: '010-Startup', status: 'ready', progress: 0, currentAgent: 'Startup Agent', currentOperation: 'Ready', availability: 'available', availabilityMessage: null, description: null, requirements: [], activity: [], report: null },
    { id: '020-d05-project-overview', name: '020-D05-Project-Overview', status: 'ready', progress: 0, currentAgent: 'D05 Agent', currentOperation: 'Ready', availability: 'available', availabilityMessage: null, description: null, requirements: [], activity: [], report: null },
    { id: '020-d10-architecture', name: '020-D10-Architecture', status: 'waiting', progress: 0, currentAgent: null, currentOperation: null, availability: 'available', availabilityMessage: null, description: null, requirements: [], activity: [], report: null },
    { id: '030-context', name: '030-Context', status: 'waiting', progress: 0, currentAgent: null, currentOperation: null, availability: 'available', availabilityMessage: null, description: null, requirements: [], activity: [], report: null }
  ];
  global.__forgepilotStageTest = { catalog: fixtureCatalog, startup: true, d05: false, d10: false };
  const workflowModule = require(path.join(jobsDir, 'projectWorkflowState.js'));
  let merged = await workflowModule.createProjectWorkflowState(mergeProject).mergeWorkflow({ workflowId: 'wf', workflowVersion: '1', stages: cloudStages });
  assert.equal(merged.stages.filter((stage) => stage.id.startsWith('020-d')).length, 14, 'mergeWorkflow must expose all 14 Discovery substages.');
  assert.equal(merged.stages.find((stage) => stage.id === '020-d05-project-overview').status, 'ready');
  const mergedD10 = merged.stages.find((stage) => stage.id === '020-d10-architecture');
  assert.equal(mergedD10.status, 'waiting');
  assert.equal(mergedD10.requirements[0].status, 'missing');
  assert.equal(merged.stages.find((stage) => stage.id === '020-d15-database').availability, 'not_ready');

  global.__forgepilotStageTest.d05 = true;
  merged = await workflowModule.createProjectWorkflowState(mergeProject).mergeWorkflow({ workflowId: 'wf', workflowVersion: '1', stages: cloudStages });
  assert.equal(merged.stages.find((stage) => stage.id === '020-d10-architecture').status, 'ready');
  assert.equal(merged.stages.find((stage) => stage.id === '020-d10-architecture').requirements[0].status, 'satisfied');

  const jobServiceSource = await fsp.readFile(path.join(repoRoot, 'src/services/jobs/jobService.ts'), 'utf8');
  assert.match(jobServiceSource, /requestedStage\.availability === "not_ready"/);
  assert.match(jobServiceSource, /missingHardRequirements/);

  const dashboardSource = await fsp.readFile(path.join(repoRoot, 'src/renderer/src/pages/DashboardPage.tsx'), 'utf8');
  assert.match(dashboardSource, />Requirements</);
  assert.match(dashboardSource, /Run requirement/);
  assert.match(dashboardSource, /Not Ready/);
  assert.match(dashboardSource, /findRunnableRequirementStage/);

  for (const file of [
    'src/shared/schemas/run.ts',
    'src/services/discovery/discoveryStageCatalogService.ts',
    'src/services/jobs/projectWorkflowState.ts',
    'src/services/jobs/jobService.ts',
    'src/renderer/src/pages/DashboardPage.tsx'
  ]) {
    const fullPath = path.join(repoRoot, file);
    const source = await fsp.readFile(fullPath, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: fullPath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX
      },
      reportDiagnostics: true
    });
    const errors = (output.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, `${file} has TypeScript syntax diagnostics.`);
  }

  await fsp.rm(projectRoot, { recursive: true, force: true });
  await fsp.rm(cycleProject, { recursive: true, force: true });
  await fsp.rm(tempRoot, { recursive: true, force: true });
  await fsp.rm(integrationRoot, { recursive: true, force: true });
  await fsp.rm(mergeProject, { recursive: true, force: true });

  console.log('Discovery stage catalog verification: PASS');
  console.log('14/14 substages visible in manifest.');
  console.log('D05/D10 package availability checks: PASS');
  console.log('Not-ready stage handling: PASS');
  console.log('HARD dependency cycle rejection: PASS');
  console.log('UI requirement/not-ready hooks: PASS');
  console.log('Workflow catalog merge/readiness: PASS');
  console.log('Backend execution guards: PASS');
  console.log('Modified TypeScript/TSX syntax diagnostics: 0');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
