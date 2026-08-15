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
    return new Map(Object.entries(raw).map(([projectId, stageIds]) => [projectId, new Set(stageIds)]));
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
const SCAN_PROJECT_RULE_PATH =
  process.env.FORGEPILOT_DISCOVERY_SCAN_PROJECT_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\rules\\005-scan_project.rules.md";
const CLASSIFY_FILES_RULE_PATH =
  process.env.FORGEPILOT_DISCOVERY_CLASSIFY_FILES_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\rules\\010-classify_files.rules.md";
const INDEX_DOCUMENTS_RULE_PATH =
  process.env.FORGEPILOT_DISCOVERY_INDEX_DOCUMENTS_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\rules\\015-index_documents.rules.md";
const MAP_DEPENDENCIES_RULE_PATH =
  process.env.FORGEPILOT_DISCOVERY_MAP_DEPENDENCIES_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\rules\\017-map_dependencies.rules.md";
const BUILD_CONTEXT_RULE_PATH =
  process.env.FORGEPILOT_DISCOVERY_BUILD_CONTEXT_RULE ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\rules\\020-build_context.rules.md";

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
  const startupCompleted =
    passed.has(STARTUP_STAGE_ID) || passed.has(LEGACY_STARTUP_SEAL_STAGE_ID);
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
    { id: "030-context", name: "030-Context", status: "waiting", progress: 0, currentAgent: null, currentOperation: null },
    { id: "040-implementation", name: "040-Implementation", status: "waiting", progress: 0, currentAgent: null, currentOperation: null },
    { id: "050-validation", name: "050-Validation", status: "waiting", progress: 0, currentAgent: null, currentOperation: null }
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

const createScanProjectPrompt = (requestBody) => {
  const rule = readRule(SCAN_PROJECT_RULE_PATH);

  return [
    `Proje koku: ${requestBody.project.rootPath}`,
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.scan_project ?? null)}`,
    "",
    "--- kural (RULE-D01, 005-scan_project.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "EXE RULE-D01 islemini tamamladigini iddia ediyor.",
    "",
    "Sen uretim yapmiyorsun. Dosya yazma/degistirme.",
    "RULE-D01 Verification bolumunu ve invariant'larini bagimsiz dogrula.",
    "",
    "Ozellikle gercek traversal kapsamini, exclusion, path canonicalization,",
    "FILE_INVENTORY/FOLDER_STRUCTURE exact iliskisini ve Git status davranisini kontrol et.",
    "",
    "Son satira yalniz:",
    '{"ok":true,"job":"scan_project","verified_rules":["RULE-D01"]}',
    "veya",
    '{"ok":false,"job":"scan_project","failed_at":"RULE-D01","violation":"...","detail":"..."}',
    "yaz."
  ].join("\n");
};

const createClassifyFilesPrompt = (requestBody) => {
  const rule = readRule(CLASSIFY_FILES_RULE_PATH);

  return [
    `Proje koku: ${requestBody.project.rootPath}`,
    "",
    `exe_result: ${JSON.stringify(requestBody.localExecution?.classify_files ?? null)}`,
    "",
    "--- kural (RULE-D02, 010-classify_files.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "EXE RULE-D02 islemini tamamladigini iddia ediyor.",
    "Uretim yapma; yalniz RULE-D02 Verification listesini bagimsiz uygula.",
    "",
    "Inventory/classified path exact esitligini, kapali kind/format/signals",
    "sozluklerini, manifest precedence'i, signal tokenizer fixture'larini ve",
    "UNKNOWN_FILES esitligini kontrol et.",
    "",
    "Son satira yalniz:",
    '{"ok":true,"job":"classify_files","verified_rules":["RULE-D02"]}',
    "veya",
    '{"ok":false,"job":"classify_files","failed_at":"RULE-D02","violation":"...","detail":"..."}',
    "yaz."
  ].join("\n");
};

const createIndexDocumentsCandidatesPrompt = (requestBody) => {
  const rule = readRule(INDEX_DOCUMENTS_RULE_PATH);
  const candidateDocuments = requestBody.localExecution?.index_documents_candidates ?? [];
  const canonicalView = candidateDocuments
    .map((doc) => {
      const numberedLines = (doc.lines ?? []).map((line, index) => `${index + 1}: ${line}`).join("\n");
      return `--- document (${doc.source}) ---\n${numberedLines}\n--- document sonu ---`;
    })
    .join("\n\n");

  return [
    "--- kural (RULE-D03, 015-index_documents.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "Asagidaki canonical document view uzerinden yalniz DOMAIN_GLOSSARY candidate'lari uret.",
    "",
    canonicalView,
    "",
    "Filesystem'e yazma.",
    "Excerpt uretme.",
    "Yalniz su kapali category degerlerini kullan:",
    "business_term, module_name, entity_name, role, service_name, api_name.",
    "",
    "Yalniz JSON dondur:",
    '{"candidates":[{"term":"...","category":"...","evidence":{"source":"...","line":1}}]}'
  ].join("\n");
};

const createIndexDocumentsAndMapDependenciesVerificationPrompt = (requestBody) => {
  const d03Rule = readRule(INDEX_DOCUMENTS_RULE_PATH);
  const d09Rule = readRule(MAP_DEPENDENCIES_RULE_PATH);

  return [
    "--- kural (RULE-D03, 015-index_documents.rules.md) ---",
    d03Rule,
    "--- kural sonu ---",
    "",
    "--- kural (RULE-D09, 017-map_dependencies.rules.md) ---",
    d09Rule,
    "--- kural sonu ---",
    "",
    `exe_result (index_documents): ${JSON.stringify(requestBody.localExecution?.index_documents ?? null)}`,
    `exe_result (map_dependencies): ${JSON.stringify(requestBody.localExecution?.map_dependencies ?? null)}`,
    "",
    "EXE iki branch'in final output'larini tamamladigini iddia ediyor.",
    "Uretim yapma, dosya degistirme.",
    "",
    "Once RULE-D03 Verification listesini uygula.",
    "FAIL ise hemen dur.",
    "Gecerse RULE-D09 Verification listesini uygula.",
    "",
    "Ikisi de gecerse son satira yalniz:",
    '{"ok":true,"job":"index_documents_and_map_dependencies","verified_rules":["RULE-D03","RULE-D09"]}',
    "Biri gecmezse:",
    '{"ok":false,"job":"index_documents_and_map_dependencies","failed_at":"RULE-D03|RULE-D09","violation":"...","detail":"..."}',
    "yaz."
  ].join("\n");
};

const createBuildContextEvidencePrompt = (requestBody) => {
  const rule = readRule(BUILD_CONTEXT_RULE_PATH);
  const evidence = requestBody.localExecution?.build_context_evidence ?? {};
  const documents = evidence.documents ?? [];
  const canonicalView = documents
    .map((doc) => {
      const numberedLines = (doc.lines ?? []).map((line, index) => `${index + 1}: ${line}`).join("\n");
      return `--- document (${doc.source}) ---\n${numberedLines}\n--- document sonu ---`;
    })
    .join("\n\n");

  return [
    "--- kural (RULE-D04, 020-build_context.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    "Asagidaki bounded semantic evidence view uzerinden yalniz RULE-D04'un izin",
    "verdigi semantic alanlar icin structured JSON patch uret:",
    "project.type, project.purpose, business_domain.name, assumptions[], modules[].description.",
    "",
    `modules: ${JSON.stringify(evidence.modules ?? [])}`,
    `manifest_descriptions: ${JSON.stringify(evidence.manifestDescriptionCandidates ?? [])}`,
    `glossary_business_terms: ${JSON.stringify(evidence.businessTerms ?? [])}`,
    "",
    canonicalView,
    "",
    "Deterministik alanlari degistirme.",
    "Kanitsiz deger uretme; kanit yoksa RULE-D04'te tanimlandigi gibi UNKNOWN/[] kullan.",
    "Filesystem'e yazma.",
    "Baska top-level/semantic alan uretme.",
    "",
    "Yalniz JSON dondur:",
    '{"project":{"type":"...","purpose":"...","evidence":{"type":{...},"purpose":{...}}},' +
      '"business_domain":{"name":"...","name_evidence":{...}},' +
      '"assumptions":[{"statement":"...","evidence":{...}}],' +
      '"modules":[{"id":"...","description":"...","description_evidence":{...}}]}'
  ].join("\n");
};

const createBuildContextVerificationPrompt = (requestBody) => {
  const rule = readRule(BUILD_CONTEXT_RULE_PATH);

  return [
    "--- kural (RULE-D04, 020-build_context.rules.md) ---",
    rule,
    "--- kural sonu ---",
    "",
    `exe_result (build_context): ${JSON.stringify(requestBody.localExecution?.build_context ?? null)}`,
    "",
    "EXE PROJECT_CONTEXT.json ve MODULE_MAP_BASE.json final output'larini yazdigini iddia ediyor.",
    "Uretim yapma, dosya degistirme.",
    "RULE-D04 Verification listesini bagimsiz uygula.",
    "",
    "Ozellikle canonical module ownership, root/fallback/catch-all davranisi,",
    "PROJECT_CONTEXT <-> MODULE_MAP_BASE id esitligi, technology exact copy ve",
    "semantic evidence/UNKNOWN invariant'larini dogrula.",
    "",
    "Son satira:",
    '{"ok":true,"job":"build_context","verified_rules":["RULE-D04"]}',
    "veya",
    '{"ok":false,"job":"build_context","failed_at":"RULE-D04","violation":"...","detail":"..."}',
    "yaz."
  ].join("\n");
};

const createPrompt = (requestBody) => {
  if (requestBody.localExecution?.build_context_evidence) {
    return createBuildContextEvidencePrompt(requestBody);
  }

  if (requestBody.localExecution?.build_context) {
    return createBuildContextVerificationPrompt(requestBody);
  }

  if (requestBody.localExecution?.index_documents_candidates) {
    return createIndexDocumentsCandidatesPrompt(requestBody);
  }

  if (requestBody.localExecution?.index_documents || requestBody.localExecution?.map_dependencies) {
    return createIndexDocumentsAndMapDependenciesVerificationPrompt(requestBody);
  }

  if (requestBody.localExecution?.classify_files) {
    return createClassifyFilesPrompt(requestBody);
  }

  if (requestBody.localExecution?.scan_project) {
    return createScanProjectPrompt(requestBody);
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
  if (requestBody.localExecution?.build_context_evidence) {
    return "020-discovery:build-context-evidence";
  }

  if (requestBody.localExecution?.build_context) {
    return "020-discovery:build-context";
  }

  if (requestBody.localExecution?.index_documents_candidates) {
    return "020-discovery:index-documents-candidates";
  }

  if (requestBody.localExecution?.index_documents || requestBody.localExecution?.map_dependencies) {
    return "020-discovery:index-documents-and-map-dependencies";
  }

  if (requestBody.localExecution?.classify_files) {
    return "020-discovery:classify-files";
  }

  if (requestBody.localExecution?.scan_project) {
    return "020-discovery:scan-project";
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

const providerDirective = (session, localExecution, mode, requireOk, saveAs, messages, progress) => {
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
        [20, 25]
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
        ["Checking the factory folder and configuration.", "Factory and configuration check completed."],
        [28, 35]
      );
    case 2:
      if (selectRun.decision === "already_sealed") {
        return terminalDirective("completed", "A valid sealed run already exists; Startup is complete.", 100);
      }
      return providerDirective(
        session,
        session.context.startupCheck,
        "verification",
        true,
        null,
        ["Verifying factory/configuration state.", "Factory/configuration verification completed."],
        [38, 48]
      );
    case 3:
      return providerDirective(
        session,
        { select_run: selectRun },
        "verification",
        true,
        null,
        ["Verifying run-folder selection.", "Run-folder selection verification completed."],
        [50, 60]
      );
    case 4:
      return localDirective(
        "startup.place-inputs",
        { runId: selectRun.run_id },
        "placeInputs",
        ["Placing SCOPE.md and BASELINE.md.", "Input placement completed."],
        [62, 70]
      );
    case 5:
      return providerDirective(
        session,
        { place_inputs: placeInputs },
        "verification",
        true,
        null,
        ["Verifying Startup input files.", "Startup input verification completed."],
        [72, 78]
      );
    case 6:
      if (placeInputs.status === "waiting_for_input") {
        return terminalDirective(
          "blocked",
          "SCOPE.md and BASELINE.md need user review before Startup can continue.",
          78
        );
      }
      return localDirective(
        "startup.capture-git-state",
        { runId: selectRun.run_id },
        "gitState",
        ["Capturing git state.", "Git state captured."],
        [80, 84]
      );
    case 7:
      return providerDirective(
        session,
        { capture_git_state: session.context.gitState },
        "verification",
        true,
        null,
        ["Verifying captured git state.", "Git-state verification completed."],
        [85, 88]
      );
    case 8:
      return localDirective(
        "startup.build-source-manifest",
        { runId: selectRun.run_id },
        "sourceManifest",
        ["Building SOURCE_MANIFEST.csv.", "Source manifest built."],
        [89, 91]
      );
    case 9:
      return providerDirective(
        session,
        { build_source_manifest: session.context.sourceManifest },
        "verification",
        true,
        null,
        ["Verifying source manifest.", "Source-manifest verification completed."],
        [92, 94]
      );
    case 10:
      return localDirective(
        "startup.build-factory-manifest",
        { runId: selectRun.run_id },
        "factoryManifest",
        ["Building FACTORY_MANIFEST.csv.", "Factory manifest built."],
        [95, 96]
      );
    case 11:
      return providerDirective(
        session,
        { build_factory_manifest: session.context.factoryManifest },
        "verification",
        true,
        null,
        ["Verifying factory manifest.", "Factory-manifest verification completed."],
        [96, 97]
      );
    case 12:
      return localDirective(
        "startup.seal-run",
        { runId: selectRun.run_id },
        "sealRun",
        ["Sealing the Startup run.", "Startup seal calculation completed."],
        [98, 99]
      );
    case 13:
      return providerDirective(
        session,
        { seal_run: sealRun },
        "verification",
        true,
        null,
        ["Verifying the Startup seal.", "Startup seal verification completed."],
        [99, 100]
      );
    default:
      return sealRun.decision === "PASS"
        ? terminalDirective("completed", "Startup completed and the run is sealed.", 100)
        : terminalDirective("blocked", "Startup seal did not pass; review the missing run artifacts.", 100);
  }
};

const discoveryDirectiveFor = (session) => {
  const prepared = outputObject(session, "indexAndMapPreparation");
  const glossaryPatch = outputObject(session, "glossaryPatch");
  const contextPreparation = outputObject(session, "contextPreparation");
  const contextPatch = outputObject(session, "contextPatch");

  switch (session.step) {
    case 0:
      return localDirective(
        "discovery.scan-project",
        {},
        "scanProject",
        ["Scanning the project tree.", "Project scan completed."],
        [20, 30]
      );
    case 1:
      return providerDirective(
        session,
        { scan_project: session.context.scanProject },
        "verification",
        true,
        null,
        ["Verifying project scan.", "Project-scan verification completed."],
        [32, 45]
      );
    case 2:
      return localDirective(
        "discovery.classify-files",
        {},
        "classifyFiles",
        ["Classifying inventoried files.", "File classification completed."],
        [47, 60]
      );
    case 3:
      return providerDirective(
        session,
        { classify_files: session.context.classifyFiles },
        "verification",
        true,
        null,
        ["Verifying file classification.", "File-classification verification completed."],
        [62, 72]
      );
    case 4:
      return localDirective(
        "discovery.prepare-index-and-map",
        {},
        "indexAndMapPreparation",
        ["Preparing document index and dependency map.", "Document/dependency preparation completed."],
        [74, 79]
      );
    case 5:
      return providerDirective(
        session,
        { index_documents_candidates: prepared.preparation?.candidateDocuments ?? [] },
        "semantic",
        false,
        "glossaryPatch",
        ["Resolving domain glossary candidates.", "Domain glossary candidate generation completed."],
        [80, 83]
      );
    case 6:
      return localDirective(
        "discovery.finalize-index-documents",
        {
          candidates: Array.isArray(glossaryPatch.candidates) ? glossaryPatch.candidates : [],
          preparation: prepared.preparation
        },
        "indexDocuments",
        ["Finalizing document index.", "Document index finalized."],
        [84, 86]
      );
    case 7:
      return providerDirective(
        session,
        {
          index_documents: session.context.indexDocuments,
          map_dependencies: prepared.mapDependencies
        },
        "verification",
        true,
        null,
        ["Verifying document index and dependency map.", "Document/dependency verification completed."],
        [87, 90]
      );
    case 8:
      return localDirective(
        "discovery.prepare-context",
        {},
        "contextPreparation",
        ["Preparing project-context evidence.", "Project-context evidence prepared."],
        [91, 93]
      );
    case 9:
      return providerDirective(
        session,
        {
          build_context_evidence: {
            businessTerms: contextPreparation.businessTerms ?? [],
            documents: contextPreparation.documents ?? [],
            manifestDescriptionCandidates: contextPreparation.manifestDescriptionCandidates ?? [],
            modules: Array.isArray(contextPreparation.modules)
              ? contextPreparation.modules.map((module) => ({
                  id: module.id,
                  name: module.name,
                  root: module.root
                }))
              : []
          }
        },
        "semantic",
        false,
        "contextPatch",
        ["Resolving semantic project context.", "Semantic project-context resolution completed."],
        [94, 96]
      );
    case 10:
      return localDirective(
        "discovery.finalize-context",
        { patch: contextPatch, preparation: contextPreparation },
        "buildContext",
        ["Finalizing PROJECT_CONTEXT.json.", "Project context finalized."],
        [96, 98]
      );
    case 11:
      return providerDirective(
        session,
        { build_context: session.context.buildContext },
        "verification",
        true,
        null,
        ["Verifying final project context.", "Project-context verification completed."],
        [98, 100]
      );
    default:
      return terminalDirective("completed", "Discovery completed successfully.", 100);
  }
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

  return terminalDirective("failed", `Mock cloud has no execution plan for stage: ${session.stageId}`, 0);
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

  if (
    session.pending.kind === "local" &&
    !Array.isArray(body.localOperations)
  ) {
    session.pending = terminalDirective("failed", "Desktop did not report local operations.", session.lastProgress);
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
      const compatible = body.protocolVersion === "2";
      sendJson(response, 200, {
        status: compatible ? "ok" : "update-required",
        serverVersion: "mock-0.2.1",
        protocolVersion: "2",
        message: compatible
          ? "Mock cloud connected"
          : "Desktop protocol v2 is required for server-driven execution directives."
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
