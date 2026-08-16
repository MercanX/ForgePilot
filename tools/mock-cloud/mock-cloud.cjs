const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");

const PORT = Number(process.env.FORGEPILOT_MOCK_CLOUD_PORT ?? 4317);
const jobs = new Map();
const STARTUP_STAGE_ID = "010-startup";
const DISCOVERY_D05_STAGE_ID = "020-d05-project-overview";
const DISCOVERY_D10_STAGE_ID = "020-d10-architecture";
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

const unmarkStagePassed = (projectId, stageId) => {
  if (!projectId || !stageId) return;
  passedStagesByProject.get(projectId)?.delete(stageId);
  persistPassedStagesByProject();
};
const STARTUP_CONTRACT_PATH =
  process.env.FORGEPILOT_STARTUP_CONTRACT ??
  "C:\\Github\\aiFactory\\.ai-factory\\010-Startup\\STARTUP_CONTRACT.json";

const loadStartupContract = () => JSON.parse(readFileSync(STARTUP_CONTRACT_PATH, "utf8"));

const getStartupProviderTask = (taskId) => {
  const contract = loadStartupContract();
  const task = contract?.provider_tasks?.[taskId];
  if (!task || typeof task.rule !== "string" || !task.output_schema) {
    throw new Error(`Startup contract does not define provider task: ${taskId}`);
  }
  return {
    ...task,
    rulePath: path.resolve(path.dirname(STARTUP_CONTRACT_PATH), task.rule)
  };
};

const DISCOVERY_D05_PROMPT_PATH =
  process.env.FORGEPILOT_DISCOVERY_D05_PROMPT ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\D05-Project-Overview\\prompt\\project-overview.compiled.prompt.md";
const DISCOVERY_D05_SCHEMA_PATH =
  process.env.FORGEPILOT_DISCOVERY_D05_SCHEMA ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\D05-Project-Overview\\contracts\\project-overview-output.schema.json";

const loadDiscoveryD05Prompt = () => readFileSync(DISCOVERY_D05_PROMPT_PATH, "utf8");
const loadDiscoveryD05Schema = () => JSON.parse(readFileSync(DISCOVERY_D05_SCHEMA_PATH, "utf8"));

const DISCOVERY_D10_PROMPT_PATH =
  process.env.FORGEPILOT_DISCOVERY_D10_PROMPT ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\D10-Architecture\\prompt\\architecture.compiled.prompt.md";
const DISCOVERY_D10_SCHEMA_PATH =
  process.env.FORGEPILOT_DISCOVERY_D10_SCHEMA ??
  "C:\\Github\\aiFactory\\.ai-factory\\020-Discovery\\D10-Architecture\\contracts\\architecture-output.schema.json";

const loadDiscoveryD10Prompt = () => readFileSync(DISCOVERY_D10_PROMPT_PATH, "utf8");
const loadDiscoveryD10Schema = () => JSON.parse(readFileSync(DISCOVERY_D10_SCHEMA_PATH, "utf8"));


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
  const startupCompleted = passed.has(STARTUP_STAGE_ID);
  const d05Completed = passed.has(DISCOVERY_D05_STAGE_ID);
  const d10Completed = passed.has(DISCOVERY_D10_STAGE_ID);

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
      id: DISCOVERY_D05_STAGE_ID,
      name: "020-D05-Project-Overview",
      status: d05Completed ? "completed" : startupCompleted ? "ready" : "waiting",
      progress: d05Completed ? 100 : 0,
      currentAgent: startupCompleted ? "D05 Project Overview Agent" : null,
      currentOperation: d05Completed
        ? "Project Overview audit completed."
        : startupCompleted
          ? "Ready for manual start."
          : null
    },
    {
      id: DISCOVERY_D10_STAGE_ID,
      name: "020-D10-Architecture",
      status: d10Completed ? "completed" : d05Completed ? "ready" : "waiting",
      progress: d10Completed ? 100 : 0,
      currentAgent: d05Completed ? "D10 Architecture Agent" : null,
      currentOperation: d10Completed
        ? "Architecture audit completed."
        : d05Completed
          ? "Ready for manual start."
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
const createStartupScopePrompt = (requestBody) => {
  const task = getStartupProviderTask("SCOPE_PROPOSAL");
  const rule = readRule(task.rulePath);

  return [
    "AI Factory 010-Startup semantic task: SCOPE_PROPOSAL.",
    `Selected project root: ${requestBody.project.rootPath}`,
    "",
    "The selected project root is your working directory. Explore it with your normal read/search tools as needed.",
    "Do not modify project files. Do not perform the software audit. Only propose the audit scope.",
    "",
    "--- authoritative Startup scope rule ---",
    rule,
    "--- end authoritative Startup scope rule ---",
    "",
    `Required output JSON schema: ${JSON.stringify(task.output_schema)}`,
    "Return one raw JSON object matching this schema. Do not use Markdown fences or prose outside JSON."
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

const createDiscoveryD05Prompt = (requestBody) => {
  const task = requestBody.localExecution?.semantic_task ?? {};
  const runtimeInputs = task.runtime_inputs ?? {};
  const template = loadDiscoveryD05Prompt();

  return template
    .replaceAll("{{PROJECT_ROOT}}", requestBody.project.rootPath)
    .replaceAll("{{OUTPUT_LANGUAGE}}", requestBody.outputLanguage ?? "Turkish")
    .replaceAll("{{STARTUP_SCOPE_JSON}}", JSON.stringify(runtimeInputs.startup_scope ?? {}))
    .replaceAll("{{STARTUP_SEAL_JSON}}", JSON.stringify(runtimeInputs.startup_seal ?? {}))
    .replaceAll("{{DISCOVERY_CONTEXT_JSON}}", JSON.stringify(runtimeInputs.discovery_context ?? {}));
};

const createDiscoveryD10Prompt = (requestBody) => {
  const task = requestBody.localExecution?.semantic_task ?? {};
  const runtimeInputs = task.runtime_inputs ?? {};
  const template = loadDiscoveryD10Prompt();

  return template
    .replaceAll("{{PROJECT_ROOT}}", requestBody.project.rootPath)
    .replaceAll("{{OUTPUT_LANGUAGE}}", requestBody.outputLanguage ?? "Turkish")
    .replaceAll("{{STARTUP_SCOPE_JSON}}", JSON.stringify(runtimeInputs.startup_scope ?? {}))
    .replaceAll("{{STARTUP_SEAL_JSON}}", JSON.stringify(runtimeInputs.startup_seal ?? {}))
    .replaceAll("{{DISCOVERY_CONTEXT_JSON}}", JSON.stringify(runtimeInputs.discovery_context ?? {}));
};

const createPrompt = (requestBody) => {
  const semanticTask = requestBody.localExecution?.semantic_task?.semantic_task_id;

  if (semanticTask === "SCOPE_PROPOSAL") {
    return createStartupScopePrompt(requestBody);
  }

  if (semanticTask === "D05_PROJECT_OVERVIEW") {
    return createDiscoveryD05Prompt(requestBody);
  }

  if (semanticTask === "D10_ARCHITECTURE") {
    return createDiscoveryD10Prompt(requestBody);
  }

  if (typeof semanticTask === "string") {
    return createDiscoverySemanticPrompt(requestBody);
  }

  throw new Error("Provider job does not identify a supported semantic task.");
};
const getStageId = (requestBody) => {
  const semanticTask = requestBody.localExecution?.semantic_task?.semantic_task_id;
  if (semanticTask === "SCOPE_PROPOSAL") {
    return "010-startup:scope-proposal";
  }

  if (semanticTask === "D05_PROJECT_OVERVIEW") {
    return DISCOVERY_D05_STAGE_ID;
  }

  if (semanticTask === "D10_ARCHITECTURE") {
    return DISCOVERY_D10_STAGE_ID;
  }

  if (typeof semanticTask === "string") {
    return `020-${semanticTask.toLowerCase().replaceAll("_", "-")}`;
  }

  return "unknown";
};
const createTask = (jobId, requestBody) => {
  const stageId = getStageId(requestBody);
  return {
    id: randomUUID(),
    jobId,
    instructions: {
      body: createPrompt(requestBody),
      format: "plain-text",
      metadata: {
        localExecution: requestBody.localExecution ?? null,
        outputLanguage: requestBody.outputLanguage ?? "Turkish",
        source: "mock-cloud",
        stageId,
        timeoutMs: Math.min(10_800_000, Math.max(300_000, Number(requestBody.timeoutMs) || 5_400_000))
      }
    },
    timeoutMs: Math.min(10_800_000, Math.max(300_000, Number(requestBody.timeoutMs) || 5_400_000))
  };
};

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

const semanticLocatorSchema = () => ({
  oneOf: [
    {
      type: "object",
      properties: { source: { type: "string" }, line: { type: "integer", minimum: 1 } },
      required: ["source", "line"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: { source: { type: "string" }, field: { type: "string" } },
      required: ["source", "field"],
      additionalProperties: false
    }
  ]
});

const nullableLocatorSchema = () => ({ anyOf: [{ type: "null" }, semanticLocatorSchema()] });

const semanticOutputSchema = (localExecution) => {
  const taskId = localExecution?.semantic_task?.semantic_task_id;
  if (taskId === "SCOPE_PROPOSAL") {
    return getStartupProviderTask("SCOPE_PROPOSAL").output_schema;
  }
  if (taskId === "D05_PROJECT_OVERVIEW") {
    return loadDiscoveryD05Schema();
  }
  if (taskId === "D10_ARCHITECTURE") {
    return loadDiscoveryD10Schema();
  }
  return discoverySemanticOutputSchema(localExecution);
};

const discoverySemanticOutputSchema = (localExecution) => {
  const taskId = localExecution?.semantic_task?.semantic_task_id;

  if (taskId === "D03_DOMAIN_GLOSSARY") {
    return {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              term: { type: "string" },
              category: {
                type: "string",
                enum: ["business_term", "module_name", "entity_name", "role", "service_name", "api_name"]
              },
              evidence: {
                type: "object",
                properties: { source: { type: "string" }, line: { type: "integer", minimum: 1 } },
                required: ["source", "line"],
                additionalProperties: false
              }
            },
            required: ["term", "category", "evidence"],
            additionalProperties: false
          }
        }
      },
      required: ["candidates"],
      additionalProperties: false
    };
  }

  if (taskId === "D04_CONTEXT_FIELDS") {
    return {
      type: "object",
      properties: {
        project: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["application", "service", "library", "cli", "monorepo", "infrastructure", "UNKNOWN"] },
            purpose: { type: "string" },
            evidence: {
              type: "object",
              properties: { type: nullableLocatorSchema(), purpose: nullableLocatorSchema() },
              required: ["type", "purpose"],
              additionalProperties: false
            }
          },
          required: ["type", "purpose", "evidence"],
          additionalProperties: false
        },
        business_domain: {
          type: "object",
          properties: { name: { type: "string" }, name_evidence: nullableLocatorSchema() },
          required: ["name", "name_evidence"],
          additionalProperties: false
        },
        assumptions: {
          type: "array",
          items: {
            type: "object",
            properties: { statement: { type: "string" }, evidence: semanticLocatorSchema() },
            required: ["statement", "evidence"],
            additionalProperties: false
          }
        },
        modules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              description_evidence: nullableLocatorSchema()
            },
            required: ["id", "description", "description_evidence"],
            additionalProperties: false
          }
        }
      },
      required: ["project", "business_domain", "assumptions", "modules"],
      additionalProperties: false
    };
  }

  if (taskId === "D05_SEMANTIC_GAPS") {
    return {
      type: "object",
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["duplicate_finding", "absence_judged", "absence_scope_undeclared", "unknown_not_marked"]
              },
              target: { anyOf: [{ type: "string" }, { type: "null" }] },
              locator: nullableLocatorSchema(),
              candidate_keys: { type: "array", items: { type: "string" } },
              reason: { type: "string" }
            },
            required: ["kind", "target", "locator", "candidate_keys", "reason"],
            additionalProperties: false
          }
        }
      },
      required: ["candidates"],
      additionalProperties: false
    };
  }

  if (taskId === "D07_REPORT_PROSE") {
    return {
      type: "object",
      properties: {
        executive_summary_body: { type: "string" },
        recommended_actions: {
          type: "array",
          items: {
            type: "object",
            properties: { finding_id: { type: "string" }, action: { type: "string" } },
            required: ["finding_id", "action"],
            additionalProperties: false
          }
        }
      },
      required: ["executive_summary_body", "recommended_actions"],
      additionalProperties: false
    };
  }

  return null;
};

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
    providerId: session.providerId,
    outputLanguage: session.outputLanguage,
    timeoutMs: session.timeoutMs
  };
  const job = createJob(requestBody);
  jobs.set(job.id, { ...job, projectId: session.project.id });

  return {
    ...directiveBase(messages[0], messages[1], progress[0], progress[1]),
    job,
    kind: "provider",
    mode,
    outputSchema: mode === "semantic" ? semanticOutputSchema(localExecution) : null,
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
  const scopeStatus = outputObject(session, "scopeStatus");

  if (!Object.prototype.hasOwnProperty.call(session.context, "scopeStatus")) {
    return localDirective(
      "startup.scope-status",
      { reset: session.newRun === true },
      "scopeStatus",
      [
        session.newRun ? "Resetting Startup workspace state." : "Checking Startup workspace state.",
        session.newRun ? "Startup workspace state reset." : "Startup workspace state checked."
      ],
      [20, 26]
    );
  }

  if (scopeStatus.state === "sealed") {
    return terminalDirective(
      "completed",
      "Startup workspace is approved and sealed for Discovery.",
      100
    );
  }

  if (scopeStatus.state === "proposal_pending") {
    return terminalDirective(
      "blocked",
      "AI scope proposal is ready. Review/edit the scope and approve it in ForgePilot.",
      52
    );
  }

  if (scopeStatus.state === "missing" && !Object.prototype.hasOwnProperty.call(session.context, "scopeProposal")) {
    return providerDirective(
      session,
      { semantic_task: { semantic_task_id: "SCOPE_PROPOSAL" } },
      "semantic",
      false,
      "scopeProposal",
      ["AI is surveying the project and proposing audit scope.", "AI scope proposal completed."],
      [28, 46]
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(session.context, "scopeProposal") &&
    !Object.prototype.hasOwnProperty.call(session.context, "scopeProposalSaved")
  ) {
    return localDirective(
      "startup.save-scope-proposal",
      { proposal: session.context.scopeProposal },
      "scopeProposalSaved",
      ["Saving the AI scope proposal for user review.", "AI scope proposal saved."],
      [48, 52]
    );
  }

  if (Object.prototype.hasOwnProperty.call(session.context, "scopeProposalSaved")) {
    return terminalDirective(
      "blocked",
      "AI scope proposal is ready. Review/edit the scope and approve it in ForgePilot.",
      52
    );
  }

  if (scopeStatus.state === "approved" && !Object.prototype.hasOwnProperty.call(session.context, "workspaceManifest")) {
    return localDirective(
      "startup.build-workspace-manifest",
      {},
      "workspaceManifest",
      ["Hashing the approved workspace.", "Approved workspace manifest created."],
      [62, 88]
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(session.context, "workspaceManifest") &&
    !Object.prototype.hasOwnProperty.call(session.context, "startupSeal")
  ) {
    return localDirective(
      "startup.seal-workspace",
      {},
      "startupSeal",
      ["Sealing the approved workspace snapshot.", "Workspace snapshot sealed."],
      [90, 100]
    );
  }

  const startupSeal = outputObject(session, "startupSeal");
  if (startupSeal.status === "READY_FOR_DISCOVERY") {
    return terminalDirective(
      "completed",
      "Startup completed. Approved workspace is sealed and ready for Discovery.",
      100
    );
  }

  return terminalDirective(
    "failed",
    `Startup reached an unsupported state: ${String(scopeStatus.state ?? "UNKNOWN")}`,
    session.lastProgress ?? 0
  );
};

const hasOutput = (session, key) => Object.prototype.hasOwnProperty.call(session.context, key);

const discoveryD05DirectiveFor = (session) => {
  if (!hasOutput(session, "d05Status")) {
    return localDirective(
      "discovery.d05-status",
      { reset: session.newRun === true },
      "d05Status",
      [
        session.newRun ? "Resetting only D05 Project Overview state." : "Checking D05 Project Overview prerequisites.",
        session.newRun ? "D05 Project Overview state reset." : "D05 Project Overview prerequisites verified."
      ],
      [12, 18]
    );
  }

  const status = outputObject(session, "d05Status");
  if (status.state === "completed") {
    return terminalDirective(
      "completed",
      "D05 Project Overview is already completed for this sealed workspace. Use Restart to run D05 again.",
      100
    );
  }

  if (!hasOutput(session, "d05Result")) {
    return providerDirective(
      session,
      {
        semantic_task: {
          semantic_task_id: "D05_PROJECT_OVERVIEW",
          runtime_inputs: {
            audit_id: status.audit_id ?? null,
            discovery_context: status.discovery_context ?? {},
            startup_scope: status.startup_scope ?? {},
            startup_seal: status.startup_seal ?? {}
          }
        }
      },
      "semantic",
      false,
      "d05Result",
      [
        "AI is running D05 Project Overview against the approved Startup scope.",
        "D05 Project Overview AI audit completed."
      ],
      [20, 90]
    );
  }

  if (!hasOutput(session, "d05Saved")) {
    return localDirective(
      "discovery.save-d05-result",
      { result: session.context.d05Result },
      "d05Saved",
      [
        "Validating D05 evidence, checklist coverage, and canonical records.",
        "D05 Project Overview result saved to the active audit snapshot."
      ],
      [92, 99]
    );
  }

  const saved = outputObject(session, "d05Saved");
  if (saved.result === "BLOCKED") {
    return terminalDirective(
      "blocked",
      "D05 Project Overview returned BLOCKED. Review the recorded unknowns/limitations before retrying.",
      99
    );
  }

  return terminalDirective(
    "completed",
    `D05 Project Overview completed (${String(saved.result ?? "UNKNOWN")}); ${String(saved.finding_count ?? 0)} findings, ${String(saved.unknown_count ?? 0)} unknowns, ${String(saved.checklist_count ?? 0)} checklist dispositions.`,
    100
  );
};

const discoveryD10DirectiveFor = (session) => {
  if (!hasOutput(session, "d10Status")) {
    return localDirective(
      "discovery.d10-status",
      { reset: session.newRun === true },
      "d10Status",
      [
        session.newRun ? "Resetting only D10 Architecture state." : "Checking D10 Architecture prerequisites.",
        session.newRun ? "D10 Architecture state reset." : "D10 Architecture prerequisites verified."
      ],
      [12, 18]
    );
  }

  const status = outputObject(session, "d10Status");
  if (status.state === "completed") {
    return terminalDirective(
      "completed",
      "D10 Architecture is already completed for this sealed workspace. Use Restart to run D10 again.",
      100
    );
  }

  if (!hasOutput(session, "d10Result")) {
    return providerDirective(
      session,
      {
        semantic_task: {
          semantic_task_id: "D10_ARCHITECTURE",
          runtime_inputs: {
            audit_id: status.audit_id ?? null,
            discovery_context: status.discovery_context ?? {},
            startup_scope: status.startup_scope ?? {},
            startup_seal: status.startup_seal ?? {}
          }
        }
      },
      "semantic",
      false,
      "d10Result",
      [
        "AI is reconstructing and auditing the implemented D10 Architecture using D05 context and repository evidence.",
        "D10 Architecture AI audit completed."
      ],
      [20, 90]
    );
  }

  if (!hasOutput(session, "d10Saved")) {
    return localDirective(
      "discovery.save-d10-result",
      { result: session.context.d10Result },
      "d10Saved",
      [
        "Validating D10 architecture evidence, checklist coverage, and canonical records.",
        "D10 Architecture result saved to the active audit snapshot."
      ],
      [92, 99]
    );
  }

  const saved = outputObject(session, "d10Saved");
  if (saved.result === "BLOCKED") {
    return terminalDirective(
      "blocked",
      "D10 Architecture returned BLOCKED. Review the recorded unknowns/limitations before retrying.",
      99
    );
  }

  return terminalDirective(
    "completed",
    `D10 Architecture completed (${String(saved.result ?? "UNKNOWN")}); ${String(saved.finding_count ?? 0)} findings, ${String(saved.unknown_count ?? 0)} unknowns, ${String(saved.checklist_count ?? 0)} checklist dispositions.`,
    100
  );
};

const nextDirectiveFor = (session) => {
  if (session.failure) {
    return terminalDirective("failed", session.failure, session.lastProgress ?? 0);
  }

  if (session.stageId === STARTUP_STAGE_ID) {
    return startupDirectiveFor(session);
  }

  if (session.stageId === DISCOVERY_D05_STAGE_ID) {
    return discoveryD05DirectiveFor(session);
  }

  if (session.stageId === DISCOVERY_D10_STAGE_ID) {
    return discoveryD10DirectiveFor(session);
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
    outputLanguage: typeof body.outputLanguage === "string" && body.outputLanguage.trim() ? body.outputLanguage.trim() : "Turkish",
    timeoutMs: Math.min(10_800_000, Math.max(300_000, Number(body.timeoutMs) || 5_400_000)),
    stageId: body.stageId,
    step: 0
  };
  executions.set(session.id, session);
  return session;
};

const handleExecutionNext = (body) => {
  if (!body.executionId && body.newRun === true && body.stageId === DISCOVERY_D05_STAGE_ID) {
    unmarkStagePassed(body.project?.id, DISCOVERY_D05_STAGE_ID);
  }
  if (!body.executionId && body.newRun === true && body.stageId === DISCOVERY_D10_STAGE_ID) {
    unmarkStagePassed(body.project?.id, DISCOVERY_D10_STAGE_ID);
  }
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
      const startupContract = loadStartupContract();
      const startupRuntimeCompatible = startupContract.contract_version === "2.1.0";
      const startupContractCompatible = capabilities.includes("contract:010-startup@2.1.0");
      const discoveryContractCompatible = capabilities.includes("contract:020-discovery@2.0.0");
      let d05RuntimeCompatible = false;
      try {
        const d05Prompt = loadDiscoveryD05Prompt();
        const d05Schema = loadDiscoveryD05Schema();
        d05RuntimeCompatible =
          d05Prompt.includes("OV-001") &&
          d05Prompt.includes("OV-082") &&
          d05Prompt.includes("{{OUTPUT_LANGUAGE}}") &&
          d05Schema?.properties?.substage?.enum?.includes("D05-Project-Overview") &&
          Array.isArray(d05Schema?.$defs?.checkDisposition?.required) &&
          d05Schema.$defs.checkDisposition.required.includes("unknown_ids");
      } catch {
        d05RuntimeCompatible = false;
      }
      let d10RuntimeCompatible = false;
      try {
        const d10Prompt = loadDiscoveryD10Prompt();
        const d10Schema = loadDiscoveryD10Schema();
        d10RuntimeCompatible =
          d10Prompt.includes("AR-001") &&
          d10Prompt.includes("AR-082") &&
          d10Prompt.includes("{{OUTPUT_LANGUAGE}}") &&
          d10Prompt.includes("D05") &&
          d10Schema?.properties?.substage?.enum?.includes("D10-Architecture") &&
          d10Schema?.$defs?.checkDisposition?.properties?.check_id?.pattern === "^AR-\\d{3}$" &&
          Array.isArray(d10Schema?.$defs?.checkDisposition?.required) &&
          d10Schema.$defs.checkDisposition.required.includes("unknown_ids");
      } catch {
        d10RuntimeCompatible = false;
      }
      const compatible =
        protocolCompatible &&
        startupRuntimeCompatible &&
        startupContractCompatible &&
        discoveryContractCompatible &&
        d05RuntimeCompatible &&
        d10RuntimeCompatible;
      sendJson(response, 200, {
        status: compatible ? "ok" : "update-required",
        serverVersion: "mock-0.5.1-d10-debug",
        protocolVersion: "2",
        message: compatible
          ? "Mock cloud connected (Startup 2.1.0, Discovery D05 + D10)"
          : !protocolCompatible
            ? "Desktop protocol v2 is required for server-driven execution directives."
            : !startupRuntimeCompatible
              ? `AI Factory Startup runtime contract 2.1.0 is required; server loaded ${String(startupContract.contract_version ?? "unknown")}.`
              : !startupContractCompatible
                ? "Desktop must support AI Factory Startup contract 2.1.0."
                : !discoveryContractCompatible
                  ? "Desktop must support AI Factory Discovery contract 2.0.0."
                  : !d05RuntimeCompatible
                    ? "AI Factory D05 runtime files are missing or invalid. Expected the approved D05 compiled prompt and output schema."
                    : "AI Factory D10 runtime files are missing or invalid. Expected the approved D10 compiled prompt and output schema."
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
