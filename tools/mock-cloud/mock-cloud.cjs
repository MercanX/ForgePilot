const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");

const PORT = Number(process.env.FORGEPILOT_MOCK_CLOUD_PORT ?? 4317);
const jobs = new Map();
const STARTUP_SEAL_STAGE_ID = "010-startup:seal-run";
const DISCOVERY_CLASSIFY_STAGE_ID = "020-discovery:classify-files";

// Persisted to disk (not just in-memory) so that stage-completion status
// survives a mock-cloud restart. This process is restarted frequently during
// development; losing this state made already-sealed/already-completed
// stages look "not done" again in the dashboard, inviting redundant reruns.
const STATE_FILE_PATH =
  process.env.FORGEPILOT_MOCK_CLOUD_STATE_FILE ??
  path.join(os.tmpdir(), "forgepilot-mock-cloud-state.json");

const loadPassedStageJobsByProject = () => {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE_PATH, "utf8"));
    return new Map(Object.entries(raw).map(([projectId, stageJobKeys]) => [projectId, new Set(stageJobKeys)]));
  } catch {
    return new Map();
  }
};

const passedStageJobsByProject = loadPassedStageJobsByProject();

const persistPassedStageJobsByProject = () => {
  try {
    const serializable = Object.fromEntries(
      [...passedStageJobsByProject].map(([projectId, stageJobKeys]) => [projectId, [...stageJobKeys]])
    );
    writeFileSync(STATE_FILE_PATH, JSON.stringify(serializable), "utf8");
  } catch {
    // Best-effort persistence; a write failure should not crash the mock server.
  }
};

const getProjectStageSet = (projectId) =>
  (projectId && passedStageJobsByProject.get(projectId)) || new Set();

const markStagePassed = (projectId, stageJobKey) => {
  if (!projectId || !stageJobKey) {
    return;
  }

  if (!passedStageJobsByProject.has(projectId)) {
    passedStageJobsByProject.set(projectId, new Set());
  }

  passedStageJobsByProject.get(projectId).add(stageJobKey);
  persistPassedStageJobsByProject();
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
  const startupCompleted = passed.has(STARTUP_SEAL_STAGE_ID);
  const discoveryCompleted = passed.has(DISCOVERY_CLASSIFY_STAGE_ID);

  return [
    {
      id: "010-startup",
      name: "010-Startup",
      status: startupCompleted ? "completed" : "ready",
      progress: startupCompleted ? 100 : 0,
      currentAgent: "Startup Agent",
      currentOperation: startupCompleted ? "Run sealed." : "Waiting to open the provider session"
    },
    {
      id: "020-discovery",
      name: "020-Discovery",
      status: discoveryCompleted ? "completed" : startupCompleted ? "ready" : "waiting",
      progress: discoveryCompleted ? 100 : 0,
      currentAgent: startupCompleted ? "Discovery Agent" : null,
      currentOperation: discoveryCompleted
        ? "Discovery jobs sealed."
        : startupCompleted
          ? "Waiting to open the provider session"
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  try {
    if (request.method === "POST" && url.pathname === "/session/handshake") {
      await readJson(request);
      sendJson(response, 200, {
        status: "ok",
        serverVersion: "mock-0.1.0",
        protocolVersion: "1",
        message: "Mock cloud connected"
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/workflows/current") {
      const projectId = url.searchParams.get("projectId");
      sendJson(response, 200, {
        workflowId: "mock-workflow",
        workflowVersion: "1.0.0",
        stages: buildStages(projectId)
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/jobs/request") {
      const body = await readJson(request);
      const job = createJob(body);
      const projectId = body.project?.id ?? null;
      jobs.set(job.id, { ...job, projectId });

      if (body.localExecution?.select_run?.decision === "already_sealed") {
        markStagePassed(projectId, STARTUP_SEAL_STAGE_ID);
      }

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

        const verification = getLastJsonObject(body.outputChunks);
        if (verification?.ok === true) {
          markStagePassed(job.projectId, job.stageId);
        }
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
