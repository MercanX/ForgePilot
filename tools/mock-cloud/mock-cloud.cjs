const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");

const PORT = Number(process.env.FORGEPILOT_MOCK_CLOUD_PORT ?? 4317);
const jobs = new Map();
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

const createPrompt = (requestBody) =>
  requestBody.localExecution?.capture_git_state
    ? createCaptureGitStatePrompt(requestBody)
    : requestBody.localExecution?.place_inputs
      ? createPlaceInputsPrompt(requestBody)
      : requestBody.localExecution?.select_run
        ? createSelectRunPrompt(requestBody)
        : createStartupPrompt(requestBody);

const getStageId = (requestBody) => {
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
      sendJson(response, 200, {
        workflowId: "mock-workflow",
        workflowVersion: "1.0.0",
        stages: [
          {
            id: "010-startup",
            name: "010-Startup",
            status: "ready",
            progress: 0,
            currentAgent: "Startup Agent",
            currentOperation: "Waiting to open the provider session"
          },
          {
            id: "020-discovery",
            name: "020-Discovery",
            status: "waiting",
            progress: 0,
            currentAgent: null,
            currentOperation: null
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
        ]
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/jobs/request") {
      const body = await readJson(request);
      const job = createJob(body);
      jobs.set(job.id, job);
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
