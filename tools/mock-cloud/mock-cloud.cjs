const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");

const PORT = Number(process.env.FORGEPILOT_MOCK_CLOUD_PORT ?? 4317);
const jobs = new Map();
const STARTUP_STAGE_ID = "010-startup";
const DISCOVERY_STAGE_ID = "020-discovery";
const LEGACY_STARTUP_SEAL_STAGE_ID = "010-startup:seal-run";
const LEGACY_DISCOVERY_FINAL_STAGE_ID = "020-discovery:build-context";
const executions = new Map();

// Persisted to disk (not just in-memory) so that stage-completion status
// survives a mock-cloud restart. This process is restarted frequently during
// development; losing this state made already-sealed/already-completed
// stages look "not done" again in the dashboard, inviting redundant reruns.
const STATE_FILE_PATH =
  process.env.FORGEPILOT_MOCK_CLOUD_STATE_FILE ??
  path.join(os.tmpdir(), "forgepilot-mock-cloud-state.json");

const loadPassedStagesByProject = () => {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE_PATH, "utf8"));
    return new Map(
      Object.entries(raw).map(([projectId, stageIds]) => [projectId, new Set(stageIds)])
    );
  } catch {
    return new Map();
  }
};

const passedStagesByProject = loadPassedStagesByProject();

const persistPassedStagesByProject = () => {
  try {
    const serializable = Object.fromEntries(
      [...passedStagesByProject].map(([projectId, stageIds]) => [projectId, [...stageIds]])
    );
    writeFileSync(STATE_FILE_PATH, JSON.stringify(serializable), "utf8");
  } catch {
    // Best-effort persistence; a write failure should not crash the mock server.
  }
};

const getProjectStageSet = (projectId) =>
  (projectId && passedStagesByProject.get(projectId)) || new Set();

const markStagePassed = (projectId, stageId) => {
  if (!projectId || !stageId) {
    return;
  }

  if (!passedStagesByProject.has(projectId)) {
    passedStagesByProject.set(projectId, new Set());
  }

  passedStagesByProject.get(projectId).add(stageId);
  persistPassedStagesByProject();
};
const CHECK_FACTORY_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_CHECK_FACTORY_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\010-check_factory.rules.md";
const READ_CONFIG_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_READ_CONFIG_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\020-read_config.rules.md";
const SELECT_RUN_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_SELECT_RUN_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\030-select_run.rules.md";
const PLACE_INPUTS_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_PLACE_INPUTS_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\040-place_inputs.rules.md";
const CAPTURE_GIT_STATE_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_CAPTURE_GIT_STATE_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\050-capture_git_state.rules.md";
const BUILD_SOURCE_MANIFEST_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_BUILD_SOURCE_MANIFEST_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\060-build_source_manifest.rules.md";
const BUILD_FACTORY_MANIFEST_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_BUILD_FACTORY_MANIFEST_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\070-build_factory_manifest.rules.md";
const SEAL_RUN_RULE_PATH =
  process.env.FORGEPILOT_STARTUP_SEAL_RUN_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\rules\\080-seal_run.rules.md";


const sendJson = (response, statusCode, payload) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(payload)}\n`);
};

const readJson = async (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      resolve(body ? JSON.parse(body) : {});
    });
  });

const readRule = (rulePath) => readFileSync(rulePath, "utf8");

const getLastJsonObject = (outputChunks) => {
  const lines = (outputChunks ?? [])
    .map((chunk) => chunk.text)
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const jsonLine = [...lines].reverse().find((line) => line.startsWith("{") && line.endsWith("}"));

  if (!jsonLine) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonLine);

    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

const buildStages = (projectId) => {
  const passed = getProjectStageSet(projectId);
  const startupCompleted = passed.has(STARTUP_STAGE_ID) || passed.has(LEGACY_STARTUP_SEAL_STAGE_ID);
  const discoveryCompleted =
    passed.has(DISCOVERY_STAGE_ID) || passed.has(LEGACY_DISCOVERY_FINAL_STAGE_ID);

  return [
    {
      id: STARTUP_STAGE_ID,
      name: "010-Startup",
      status: startupCompleted ? "completed" : "ready",
      progress: startupCompleted ? 100 : 0,
      currentAgent: "Startup Agent",
      currentOperation: startupCompleted ? "Run sealed." : "Waiting for execution directive"
    },
    {
      id: DISCOVERY_STAGE_ID,
      name: "020-Discovery",
      status: discoveryCompleted ? "completed" : startupCompleted ? "ready" : "waiting",
      progress: discoveryCompleted ? 100 : 0,
      currentAgent: startupCompleted ? "Discovery Agent" : null,
      currentOperation: discoveryCompleted
        ? "Discovery jobs completed."
        : startupCompleted
          ? "Waiting for execution directive"
          : null
    },
    {
      id: "030-context",
      name: "030-Context",
      status: "waiting",
      progress: 0,
      currentAgent: null,
      currentOperation: null
    },
    {
      id: "040-implementation",
      name: "040-Implementation",
      status: "waiting",
      progress: 0,
      currentAgent: null,
      currentOperation: null
    },
    {
      id: "050-validation",
      name: "050-Validation",
      status: "waiting",
      progress: 0,
      currentAgent: null,
      currentOperation: null
    }
  ];
};

const createStartupPrompt = (requestBody) => {
  const checkFactoryRule = readRule(CHECK_FACTORY_RULE_PATH);
  const readConfigRule = readRule(READ_CONFIG_RULE_PATH);

  return [
    `Proje koku: ${requestBody.project.rootPath}`,
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution ?? null)}`,
    "",
    "--- kural (RULE-A01, 010-check_factory.rules.md) ---",
    checkFactoryRule,
    "--- kural sonu ---",
    "",
    "--- kural (RULE-A02, 020-read_config.rules.md) ---",
    readConfigRule,
    "--- kural sonu ---",
    "",
    "Exe az once bu iki kuralin gerektirdigi islemi tamamladigini iddia ediyor.",
    "Sen bunu yapmiyorsun - yalnizca gercegi kontrol ediyorsun.",
    "RULE-A01 icin klasor disi degisiklik kontrolunu check_factory adimi icin yorumla;",
    "factory.config.yaml dosyasi varsa/olustuysa bu RULE-A02 read_config adiminin kapsamindadir.",
    "",
    "Sirayla dogrula: once RULE-A01, sonra RULE-A02. Kendi Read/Bash'inle diske bak.",
    "Biri ihlal edilirse HEMEN dur, sonrakine gecme.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    "- Ikisi de gectiyse:",
    '{"ok": true, "check_factory": {"created": true|false, "path": "..."}, "read_config": {"version": "...", "mode": "...", "locale": "..."}}',
    "- Biri gecmediyse:",
    '{"ok": false, "failed_at": "RULE-A01"|"RULE-A02", "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createSelectRunPrompt = (requestBody) => {
  const selectRunRule = readRule(SELECT_RUN_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A03, 030-select_run.rules.md) ---",
    selectRunRule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.select_run ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A03'un kontrol listesine gore, kendi Read/Bash'inle diske bakarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Gectiyse: exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createPlaceInputsPrompt = (requestBody) => {
  const placeInputsRule = readRule(PLACE_INPUTS_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A04, 040-place_inputs.rules.md) ---",
    placeInputsRule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.place_inputs ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A04'un kontrol listesine gore, kendi Read/Bash'inle diske bakarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Kontrol gectiyse (ready ya da waiting_for_input, ikisi de gecerli sonuctur): exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Kontrol gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createCaptureGitStatePrompt = (requestBody) => {
  const captureGitStateRule = readRule(CAPTURE_GIT_STATE_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A05, 050-capture_git_state.rules.md) ---",
    captureGitStateRule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.capture_git_state ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A05'in kontrol listesine gore, kendi Read/Bash'inle diske bakarak ve gerekirse kendi git komutlarini calistirarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Gectiyse: exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createBuildSourceManifestPrompt = (requestBody) => {
  const rule = readRule(BUILD_SOURCE_MANIFEST_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A06, 060-build_source_manifest.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.build_source_manifest ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A06'nin kontrol listesine gore, kendi Read/Bash'inle diske bakarak ve birkac dosyanin hash'ini kendin hesaplayarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Gectiyse: exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createBuildFactoryManifestPrompt = (requestBody) => {
  const rule = readRule(BUILD_FACTORY_MANIFEST_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A07, 070-build_factory_manifest.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.build_factory_manifest ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A07'nin kontrol listesine gore, kendi Read/Bash'inle diske bakarak ve birkac dosyanin hash'ini kendin hesaplayarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Gectiyse: exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createSealRunPrompt = (requestBody) => {
  const rule = readRule(SEAL_RUN_RULE_PATH);

  return [
    `Project root: ${requestBody.project.rootPath}`,
    "",
    "--- kural (RULE-A08, 080-seal_run.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "Exe az once bu kuralin algoritmasini calistirdigini, su sonuca ulastigini iddia ediyor:",
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.seal_run ?? null)}`,
    "",
    "Sen bunu yapmiyorsun - RULE-A08'in kontrol listesine gore, kendi Read/Bash'inle diske bakarak 7 dosyanin hash'ini kendin hesaplayarak dogrula.",
    "",
    "Bitince, baska hicbir sey yazmadan, SON SATIRA tek satirlik JSON yaz:",
    '- Gectiyse: exe_result\'u aynen ilet, {"ok": true, ...} ile sarmalayarak',
    '- Gecmediyse: {"ok": false, "violation": "<hangi madde>", "detail": "<ne oldu>"}'
  ].join("\n");
};

const createDiscoverySemanticPrompt = (requestBody) => {
  const payload = requestBody.localExecution?.semantic_task ?? {};
  const taskId = payload.semantic_task_id;

  if (taskId === "D03_DOMAIN_GLOSSARY") {
    return [
      "Discovery contract 2.0.0 semantic task: D03_DOMAIN_GLOSSARY.",
      "The payload is already bounded by ForgePilot. Do not read project files and do not write files.",
      "Use only the supplied document lines. Each line object has its canonical source line number.",
      "Return only glossary candidates supported literally by a supplied line.",
      "Allowed categories: business_term, module_name, entity_name, role, service_name, api_name.",
      "Do not return excerpts, severity, ids, or any other fields.",
      `payload: ${JSON.stringify(payload)}`,
      "Return one raw JSON object only. Do not use Markdown/code fences or prose.",
      '{"candidates":[{"term":"...","category":"business_term","evidence":{"source":"README.md","line":1}}]}'
    ].join("\n");
  }

  if (taskId === "D04_CONTEXT_FIELDS") {
    return [
      "Discovery contract 2.0.0 semantic task: D04_CONTEXT_FIELDS.",
      "The payload is bounded. Do not read project files and do not write files.",
      "Only resolve: project.type, project.purpose, business_domain.name, assumptions[], modules[].description.",
      "Allowed project.type values: application, service, library, cli, monorepo, infrastructure, UNKNOWN.",
      "Every non-UNKNOWN semantic value must cite a supplied document line or manifest description field.",
      "If evidence is insufficient, use UNKNOWN or an empty assumptions array. Never guess.",
      `payload: ${JSON.stringify(payload)}`,
      "Return one raw JSON object only. Do not use Markdown/code fences or prose.",
      '{"project":{"type":"UNKNOWN","purpose":"UNKNOWN","evidence":{"type":null,"purpose":null}},"business_domain":{"name":"UNKNOWN","name_evidence":null},"assumptions":[],"modules":[{"id":"...","description":"UNKNOWN","description_evidence":null}]}'
    ].join("\n");
  }

  if (taskId === "D05_SEMANTIC_GAPS") {
    return [
      "Discovery contract 2.0.0 semantic task: D05_SEMANTIC_GAPS.",
      "Do not read project files and do not write files. Use only this bounded candidate view.",
      "You may return only these kinds: duplicate_finding, absence_judged, absence_scope_undeclared, unknown_not_marked.",
      "Do not set severity, evidence excerpts, or final ids.",
      "duplicate_finding must reference at least two supplied preliminary candidate_key values and only when they represent the same underlying defect.",
      "The other three kinds must use an exact semantic_targets target and its exact locator.",
      "Return no candidate when the predicate is not clearly supported.",
      `payload: ${JSON.stringify(payload)}`,
      "Return one raw JSON object only. Do not use Markdown/code fences or prose.",
      '{"candidates":[{"kind":"unknown_not_marked","target":"PROJECT_CONTEXT.json#/project/purpose","locator":{"source":"README.md","line":1},"reason":"..."}]}'
    ].join("\n");
  }

  if (taskId === "D07_REPORT_PROSE") {
    return [
      "Discovery contract 2.0.0 semantic task: D07_REPORT_PROSE.",
      "Do not read project files and do not write files. The input is a report-safe aggregate view.",
      "Produce only executive_summary_body and recommended_actions.",
      "Do not change or invent gate decisions, scores, finding ids, severities, counts, project facts, or pipeline commands.",
      "Every active issue/warning id must receive exactly one recommended action. If there are no findings, recommended_actions must be empty.",
      `payload: ${JSON.stringify(payload)}`,
      "Return one raw JSON object only. Do not use Markdown/code fences or prose.",
      '{"executive_summary_body":"...","recommended_actions":[{"finding_id":"DISC-WARN-001","action":"..."}]}'
    ].join("\n");
  }

  throw new Error(`Unsupported Discovery semantic task: ${String(taskId)}`);
};

const createPrompt = (requestBody) => {
  if (requestBody.localExecution?.semantic_task) {
    return createDiscoverySemanticPrompt(requestBody);
  }

  if (requestBody.localExecution?.seal_run) {
    return createSealRunPrompt(requestBody);
  }

  if (requestBody.localExecution?.build_factory_manifest) {
    return createBuildFactoryManifestPrompt(requestBody);
  }

  if (requestBody.localExecution?.build_source_manifest) {
    return createBuildSourceManifestPrompt(requestBody);
  }

  if (requestBody.localExecution?.capture_git_state) {
    return createCaptureGitStatePrompt(requestBody);
  }

  if (requestBody.localExecution?.place_inputs) {
    return createPlaceInputsPrompt(requestBody);
  }

  if (requestBody.localExecution?.select_run) {
    return createSelectRunPrompt(requestBody);
  }

  return createStartupPrompt(requestBody);
};

const getStageId = (requestBody) => {
  const semanticTask = requestBody.localExecution?.semantic_task?.semantic_task_id;
  if (typeof semanticTask === "string") {
    return `020-discovery:${semanticTask.toLowerCase().replaceAll("_", "-")}`;
  }

  if (requestBody.localExecution?.seal_run) {
    return "010-startup:seal-run";
  }

  if (requestBody.localExecution?.build_factory_manifest) {
    return "010-startup:build-factory-manifest";
  }

  if (requestBody.localExecution?.build_source_manifest) {
    return "010-startup:build-source-manifest";
  }

  if (requestBody.localExecution?.capture_git_state) {
    return "010-startup:capture-git-state";
  }

  if (requestBody.localExecution?.place_inputs) {
    return "010-startup:place-inputs";
  }

  if (requestBody.localExecution?.select_run) {
    return "010-startup:select-run";
  }

  return "010-startup";
};

const createTask = (jobId, requestBody) => ({
  id: randomUUID(),
  jobId,
  instructions: {
    body: createPrompt(requestBody),
    format: "plain-text",
    metadata: {
      localExecution: requestBody.localExecution ?? null,
      source: "mock-cloud",
      stageId: getStageId(requestBody)
    }
  },
  timeoutMs: 300000
});

const createJob = (requestBody) => {
  const jobId = randomUUID();
  const runId = randomUUID();
  const task = createTask(jobId, requestBody);

  return {
    id: jobId,
    runId,
    stageId: getStageId(requestBody),
    providerId: requestBody.providerId,
    status: "received",
    task,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null
  };
};

const directiveBase = (messageStarted, messageCompleted, progressStarted, progressCompleted) => ({
  id: randomUUID(),
  messageCompleted,
  messageStarted,
  progressCompleted,
  progressStarted
});

const localDirective = (operation, inputs, saveAs, messages, progress) => ({
  ...directiveBase(messages[0], messages[1], progress[0], progress[1]),
  kind: "local",
  operation,
  inputs: inputs ?? {},
  saveAs: saveAs ?? null
});

const providerDirective = (
  session,
  localExecution,
  mode,
  requireOk,
  saveAs,
  messages,
  progress
) => {
  const requestBody = {
    capabilities: [],
    localExecution,
    project: session.project,
    providerId: session.providerId
  };
  const job = createJob(requestBody);
  jobs.set(job.id, { ...job, projectId: session.project.id });

  return {
    ...directiveBase(messages[0], messages[1], progress[0], progress[1]),
    job,
    kind: "provider",
    mode,
    requireOk,
    saveAs: saveAs ?? null
  };
};

const terminalDirective = (outcome, message, progress) => ({
  id: randomUUID(),
  kind: "terminal",
  message,
  outcome,
  progress
});

const outputObject = (session, key) => {
  const value = session.context[key];
  return typeof value === "object" && value !== null ? value : {};
};

const startupDirectiveFor = (session) => {
  const selectRun = outputObject(session, "selectRun");
  const placeInputs = outputObject(session, "placeInputs");
  const sealRun = outputObject(session, "sealRun");

  switch (session.step) {
    case 0:
      return localDirective(
        "startup.select-run",
        { newRun: session.newRun },
        "selectRun",
        ["Selecting the AI Factory run folder.", "Run folder selection completed."],
        [20, 28]
      );
    case 1:
      if (selectRun.decision === "already_sealed") {
        return providerDirective(
          session,
          { select_run: selectRun },
          "verification",
          true,
          null,
          ["Verifying the existing sealed run.", "Existing sealed run verification completed."],
          [30, 100]
        );
      }

      return localDirective(
        "startup.check",
        {},
        "startupCheck",
        [
          "Checking the factory folder and configuration.",
          "Factory and configuration check completed."
        ],
        [30, 38]
      );
    case 2:
      if (selectRun.decision === "already_sealed") {
        return terminalDirective(
          "completed",
          "A valid sealed run already exists; Startup is complete.",
          100
        );
      }

      return localDirective(
        "startup.place-inputs",
        { runId: selectRun.run_id },
        "placeInputs",
        ["Placing SCOPE.md and BASELINE.md.", "Input placement completed."],
        [40, 50]
      );
    case 3:
      if (placeInputs.status === "waiting_for_input") {
        return terminalDirective(
          "blocked",
          "SCOPE.md and BASELINE.md need user review before Startup can continue.",
          50
        );
      }

      return localDirective(
        "startup.capture-git-state",
        { runId: selectRun.run_id },
        "gitState",
        ["Capturing git state.", "Git state captured."],
        [52, 62]
      );
    case 4:
      return localDirective(
        "startup.build-source-manifest",
        { runId: selectRun.run_id },
        "sourceManifest",
        ["Building SOURCE_MANIFEST.csv.", "Source manifest built."],
        [64, 74]
      );
    case 5:
      return localDirective(
        "startup.build-factory-manifest",
        { runId: selectRun.run_id },
        "factoryManifest",
        ["Building FACTORY_MANIFEST.csv.", "Factory manifest built."],
        [76, 86]
      );
    case 6:
      return localDirective(
        "startup.seal-run",
        { runId: selectRun.run_id },
        "sealRun",
        ["Sealing the Startup run.", "Startup seal calculation completed."],
        [88, 94]
      );
    case 7:
      if (sealRun.decision !== "PASS") {
        return terminalDirective(
          "blocked",
          "Startup seal did not pass; review the missing run artifacts.",
          94
        );
      }

      return providerDirective(
        session,
        { seal_run: sealRun },
        "verification",
        true,
        null,
        ["Performing final Startup verification.", "Final Startup verification completed."],
        [95, 100]
      );
    default:
      return sealRun.decision === "PASS"
        ? terminalDirective("completed", "Startup completed and the run is sealed.", 100)
        : terminalDirective(
            "blocked",
            "Startup seal did not pass; review the missing run artifacts.",
            100
          );
  }
};

const MOCK_DISCOVERY_SEVERITY_POLICY = {
  base: {
    mandatory_output_missing: "HIGH",
    output_schema_invalid: "CRITICAL",
    inventory_inconsistent: "MEDIUM",
    document_index_inconsistent: "MEDIUM",
    dependency_map_inconsistent: "HIGH",
    evidence_missing: "HIGH",
    evidence_excerpt_is_note: "MEDIUM",
    evidence_line_mismatch: "MEDIUM",
    secret_unmasked: "CRITICAL",
    vcs_status_inferred: "CRITICAL",
    duplicate_finding: "LOW",
    absence_judged: "MEDIUM",
    absence_scope_undeclared: "LOW",
    unknown_not_marked: "HIGH"
  }
};

// The real Cloud resolves these policies from AI Factory. The local mock sends
// concrete policy objects so ForgePilot never invents severity/scoring policy.
const MOCK_DISCOVERY_CHECKLIST = {
  items: [
    { id: "CHECK-PRESENCE", obligation: "mandatory", predicate: "check:CHK-PRE-GATE-PRESENCE" },
    { id: "CHECK-SCHEMA", obligation: "mandatory", predicate: "check:CHK-PRE-GATE-SCHEMA" },
    { id: "CHECK-INVENTORY", obligation: "mandatory", predicate: "check:CHK-INVENTORY-CONSISTENCY" },
    { id: "CHECK-DOCUMENTS", obligation: "mandatory", predicate: "check:CHK-DOCUMENT-CONSISTENCY" },
    { id: "CHECK-DEPENDENCIES", obligation: "mandatory", predicate: "check:CHK-DEPENDENCY-CONSISTENCY" },
    { id: "CHECK-MODULES", obligation: "mandatory", predicate: "check:CHK-MODULE-MAP-CONSISTENCY" },
    { id: "CHECK-EVIDENCE", obligation: "reporting", predicate: "check:CHK-EVIDENCE-INTEGRITY" },
    { id: "CHECK-SECRETS", obligation: "reporting", predicate: "check:CHK-SECRET-REDACTION" },
    { id: "CHECK-VCS", obligation: "reporting", predicate: "check:CHK-VCS-ASSERTIONS" },
    { id: "POST-GATE-REPORT", obligation: "post_gate", predicate: "post_gate:DISCOVERY_REPORT.md" },
    { id: "POST-GATE-SUMMARY", obligation: "post_gate", predicate: "post_gate:DISCOVERY_EXECUTIVE_SUMMARY.md" },
    { id: "POST-GATE-RESULT", obligation: "post_gate", predicate: "post_gate:DISCOVERY_RESULT.json" },
    { id: "POST-GATE-METRICS", obligation: "post_gate", predicate: "post_gate:DISCOVERY_METRICS.json" }
  ]
};

const MOCK_DISCOVERY_SCORE_POLICY = {
  components: [
    { name: "Presence", weight: 15, gap_kinds: ["mandatory_output_missing"] },
    { name: "Schema", weight: 20, gap_kinds: ["output_schema_invalid"] },
    {
      name: "Consistency",
      weight: 25,
      gap_kinds: [
        "inventory_inconsistent",
        "document_index_inconsistent",
        "dependency_map_inconsistent",
        "duplicate_finding",
        "unknown_not_marked"
      ]
    },
    {
      name: "Evidence",
      weight: 25,
      gap_kinds: [
        "evidence_missing",
        "evidence_excerpt_is_note",
        "evidence_line_mismatch",
        "vcs_status_inferred",
        "absence_judged",
        "absence_scope_undeclared"
      ]
    },
    { name: "Security", weight: 15, gap_kinds: ["secret_unmasked"] }
  ]
};

const MOCK_DISCOVERY_MINIMUM_SCORE = Number(process.env.FORGEPILOT_DISCOVERY_MINIMUM_SCORE ?? 90);

const hasOutput = (session, key) => Object.prototype.hasOwnProperty.call(session.context, key);

const discoveryDirectiveFor = (session) => {
  if (!hasOutput(session, "scanProject")) {
    return localDirective(
      "discovery.scan-project",
      {},
      "scanProject",
      ["Scanning the project tree.", "Project scan completed and validated locally."],
      [20, 28]
    );
  }

  if (!hasOutput(session, "classifyFiles")) {
    return localDirective(
      "discovery.classify-files",
      {},
      "classifyFiles",
      ["Classifying inventoried files.", "File classification completed and validated locally."],
      [30, 38]
    );
  }

  if (!hasOutput(session, "indexPreparation")) {
    return localDirective(
      "discovery.prepare-index-documents-v2",
      {},
      "indexPreparation",
      ["Indexing project documents.", "Document index preparation completed."],
      [40, 43]
    );
  }

  const indexPreparation = outputObject(session, "indexPreparation");
  if (indexPreparation.semanticNeeded === true && !hasOutput(session, "glossaryPatch")) {
    return providerDirective(
      session,
      { semantic_task: indexPreparation.semanticPayload },
      "semantic",
      false,
      "glossaryPatch",
      ["Resolving bounded domain glossary semantics.", "Domain glossary semantic pass completed."],
      [44, 48]
    );
  }

  if (!hasOutput(session, "indexDocuments")) {
    const glossaryPatch = outputObject(session, "glossaryPatch");
    return localDirective(
      "discovery.finalize-index-documents-v2",
      {
        preparationId: indexPreparation.preparationId,
        candidates: Array.isArray(glossaryPatch.candidates) ? glossaryPatch.candidates : []
      },
      "indexDocuments",
      ["Finalizing document artifacts.", "Document artifacts finalized and validated locally."],
      [49, 53]
    );
  }

  if (!hasOutput(session, "mapDependencies")) {
    return localDirective(
      "discovery.map-dependencies",
      {},
      "mapDependencies",
      ["Mapping manifest dependencies.", "Manifest dependency map completed and validated locally."],
      [54, 60]
    );
  }

  if (!hasOutput(session, "contextPreparation")) {
    return localDirective(
      "discovery.prepare-context-v2",
      {},
      "contextPreparation",
      ["Preparing bounded project-context evidence.", "Project-context evidence prepared."],
      [62, 65]
    );
  }

  const contextPreparation = outputObject(session, "contextPreparation");
  if (contextPreparation.semanticNeeded === true && !hasOutput(session, "contextPatch")) {
    return providerDirective(
      session,
      { semantic_task: contextPreparation.semanticPayload },
      "semantic",
      false,
      "contextPatch",
      ["Resolving bounded semantic project context.", "Semantic project-context pass completed."],
      [66, 72]
    );
  }

  if (!hasOutput(session, "buildContext")) {
    return localDirective(
      "discovery.finalize-context-v2",
      {
        preparationId: contextPreparation.preparationId,
        patch: hasOutput(session, "contextPatch") ? session.context.contextPatch : {}
      },
      "buildContext",
      ["Finalizing project context.", "Project context finalized and validated locally."],
      [73, 76]
    );
  }

  if (!hasOutput(session, "moduleDependencies")) {
    return localDirective(
      "discovery.map-module-dependencies-v2",
      {},
      "moduleDependencies",
      ["Mapping module dependencies.", "Module dependency map completed and validated locally."],
      [78, 83]
    );
  }

  if (!hasOutput(session, "gapPreparation")) {
    return localDirective(
      "discovery.prepare-detect-gaps-v2",
      {
        severityPolicy: MOCK_DISCOVERY_SEVERITY_POLICY,
        checklist: MOCK_DISCOVERY_CHECKLIST
      },
      "gapPreparation",
      ["Running deterministic Discovery validation.", "Deterministic Discovery validation completed."],
      [85, 88]
    );
  }

  const gapPreparation = outputObject(session, "gapPreparation");
  if (gapPreparation.semanticNeeded === true && !hasOutput(session, "gapPatch")) {
    return providerDirective(
      session,
      { semantic_task: gapPreparation.semanticPayload },
      "semantic",
      false,
      "gapPatch",
      ["Checking bounded semantic gap candidates.", "Semantic gap candidate pass completed."],
      [89, 92]
    );
  }

  if (!hasOutput(session, "detectGaps")) {
    const gapPatch = outputObject(session, "gapPatch");
    return localDirective(
      "discovery.finalize-detect-gaps-v2",
      {
        preparationId: gapPreparation.preparationId,
        candidates: Array.isArray(gapPatch.candidates) ? gapPatch.candidates : []
      },
      "detectGaps",
      ["Finalizing Discovery findings.", "Discovery findings finalized and validated locally."],
      [92, 94]
    );
  }

  if (!hasOutput(session, "scoreGate")) {
    return localDirective(
      "discovery.score-and-gate-v2",
      {
        scorePolicy: MOCK_DISCOVERY_SCORE_POLICY,
        minimumScore: MOCK_DISCOVERY_MINIMUM_SCORE
      },
      "scoreGate",
      ["Calculating Discovery score and gate.", "Discovery score and gate calculated locally."],
      [94, 96]
    );
  }

  const scoreGate = outputObject(session, "scoreGate");
  if (scoreGate.decision !== "PASS" && scoreGate.decision !== "PASS_WITH_WARNINGS") {
    return terminalDirective(
      "blocked",
      `Discovery gate requires revision: ${String(scoreGate.decision ?? "UNKNOWN")} (${String(scoreGate.matched_rule ?? "no-rule")}).`,
      96
    );
  }

  if (!hasOutput(session, "reportPreparation")) {
    return localDirective(
      "discovery.prepare-report-v2",
      {},
      "reportPreparation",
      ["Preparing final Discovery report model.", "Final Discovery report model prepared."],
      [97, 97]
    );
  }

  const reportPreparation = outputObject(session, "reportPreparation");
  if (reportPreparation.semanticNeeded === true && !hasOutput(session, "reportPatch")) {
    return providerDirective(
      session,
      { semantic_task: reportPreparation.semanticPayload },
      "semantic",
      false,
      "reportPatch",
      ["Writing bounded executive-summary prose.", "Executive-summary prose completed."],
      [98, 99]
    );
  }

  if (!hasOutput(session, "generateReport")) {
    return localDirective(
      "discovery.finalize-report-v2",
      {
        preparationId: reportPreparation.preparationId,
        patch: hasOutput(session, "reportPatch") ? session.context.reportPatch : null
      },
      "generateReport",
      ["Committing final Discovery reports.", "Final Discovery reports committed and validated locally."],
      [99, 100]
    );
  }

  return terminalDirective("completed", "Discovery v2 completed successfully.", 100);
};

const nextDirectiveFor = (session) => {
  if (session.failure) {
    return terminalDirective("failed", session.failure, session.lastProgress ?? 0);
  }

  if (session.stageId === STARTUP_STAGE_ID) {
    return startupDirectiveFor(session);
  }

  if (session.stageId === DISCOVERY_STAGE_ID) {
    return discoveryDirectiveFor(session);
  }

  return terminalDirective(
    "failed",
    `Mock cloud has no execution plan for stage: ${session.stageId}`,
    0
  );
};

const applyPreviousResult = (session, previous) => {
  if (previous.directiveId === session.lastAppliedDirectiveId) {
    return;
  }

  if (!session.pending) {
    throw new Error("Execution result was supplied without a pending directive.");
  }

  if (previous.directiveId !== session.pending.id) {
    throw new Error("Execution result does not match the pending directive.");
  }

  session.lastProgress = session.pending.progressCompleted ?? session.lastProgress ?? 0;

  if (previous.status !== "completed") {
    session.failure = previous.message || `Directive ${session.pending.id} failed.`;
    session.lastAppliedDirectiveId = session.pending.id;
    session.pending = null;
    return;
  }

  if (session.pending.saveAs) {
    session.context[session.pending.saveAs] = previous.output;
  }

  session.lastAppliedDirectiveId = session.pending.id;
  session.step += 1;
  session.pending = null;
};

const createExecution = (body) => {
  const session = {
    context: {},
    failure: null,
    id: randomUUID(),
    lastAppliedDirectiveId: null,
    lastProgress: 16,
    newRun: body.newRun === true,
    pending: null,
    project: body.project,
    providerId: body.providerId,
    stageId: body.stageId,
    step: 0
  };
  executions.set(session.id, session);
  return session;
};

const handleExecutionNext = (body) => {
  const session = body.executionId ? executions.get(body.executionId) : createExecution(body);

  if (!session) {
    return { statusCode: 404, payload: { error: "execution-not-found" } };
  }

  if (session.stageId !== body.stageId || session.project.id !== body.project?.id) {
    return { statusCode: 409, payload: { error: "execution-scope-mismatch" } };
  }

  if (body.previous) {
    applyPreviousResult(session, body.previous);
  }

  if (!session.pending) {
    session.pending = nextDirectiveFor(session);
  }

  if (session.pending.kind === "local" && !Array.isArray(body.localOperations)) {
    session.pending = terminalDirective(
      "failed",
      "Desktop did not report local operations.",
      session.lastProgress
    );
  } else if (
    session.pending.kind === "local" &&
    Array.isArray(body.localOperations) &&
    !body.localOperations.includes(session.pending.operation)
  ) {
    session.pending = terminalDirective(
      "failed",
      `Desktop does not support required local operation: ${session.pending.operation}`,
      session.lastProgress
    );
  }

  if (session.pending.kind === "terminal" && session.pending.outcome === "completed") {
    markStagePassed(session.project.id, session.stageId);
  }

  return {
    statusCode: 200,
    payload: {
      directive: session.pending,
      executionId: session.id,
      stageId: session.stageId
    }
  };
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  try {
    if (request.method === "POST" && url.pathname === "/session/handshake") {
      const body = await readJson(request);
      const capabilities = Array.isArray(body.supportedCapabilities) ? body.supportedCapabilities : [];
      const protocolCompatible = body.protocolVersion === "2";
      const discoveryContractCompatible = capabilities.includes("contract:020-discovery@2.0.0");
      const compatible = protocolCompatible && discoveryContractCompatible;
      sendJson(response, 200, {
        status: compatible ? "ok" : "update-required",
        serverVersion: "mock-0.3.0",
        protocolVersion: "2",
        message: compatible
          ? "Mock cloud connected (Discovery contract 2.0.0)"
          : !protocolCompatible
            ? "Desktop protocol v2 is required for server-driven execution directives."
            : "Desktop must support AI Factory Discovery contract 2.0.0."
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workflows/current") {
      const projectId = url.searchParams.get("projectId");
      sendJson(response, 200, {
        workflowId: "mock-workflow",
        workflowVersion: "2.0.0",
        stages: buildStages(projectId)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/executions/next") {
      const body = await readJson(request);
      const result = handleExecutionNext(body);
      sendJson(response, result.statusCode, result.payload);
      return;
    }

    // Legacy/manual job request endpoint remains for IPC compatibility. Stage
    // completion is intentionally NOT inferred from individual job results.
    if (request.method === "POST" && url.pathname === "/jobs/request") {
      const body = await readJson(request);
      const job = createJob(body);
      const projectId = body.project?.id ?? null;
      jobs.set(job.id, { ...job, projectId });
      sendJson(response, 200, job);
      return;
    }

    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      sendJson(response, job ? 200 : 404, job ? job.task : { error: "job-not-found" });
      return;
    }

    const heartbeatMatch = url.pathname.match(/^\/jobs\/([^/]+)\/heartbeat$/);
    if (request.method === "POST" && heartbeatMatch) {
      await readJson(request);
      sendJson(response, 200, { accepted: true });
      return;
    }

    const resultMatch = url.pathname.match(/^\/jobs\/([^/]+)\/result$/);
    if (request.method === "POST" && resultMatch) {
      const body = await readJson(request);
      const job = jobs.get(resultMatch[1]);
      if (job) {
        job.status = body.status === "completed" ? "acked" : "failed";
        job.finishedAt = new Date().toISOString();
        job.exitCode = body.exitCode;
      }
      sendJson(response, 200, { accepted: true, findings: [] });
      return;
    }

    const failMatch = url.pathname.match(/^\/jobs\/([^/]+)\/fail$/);
    if (request.method === "POST" && failMatch) {
      await readJson(request);
      const job = jobs.get(failMatch[1]);
      if (job) {
        job.status = "failed";
        job.finishedAt = new Date().toISOString();
      }
      sendJson(response, 200, { accepted: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/findings/sync") {
      await readJson(request);
      sendJson(response, 200, { accepted: true });
      return;
    }

    sendJson(response, 404, { error: "not-found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "mock-cloud-error"
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`ForgePilot mock cloud listening at http://localhost:${PORT}`);
});
