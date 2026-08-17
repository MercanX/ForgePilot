const { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "forgepilot-protocol-"));
const projectRoot = path.join(tempRoot, "project");
const statePath = path.join(tempRoot, "state.json");
const startupRuntimeRoot = path.join(tempRoot, "startup-runtime");
const startupRulePath = path.join(startupRuntimeRoot, "rules", "005-propose_scope.rules.md");
const startupContractPath = path.join(startupRuntimeRoot, "STARTUP_CONTRACT.json");
const discoveryRuntimeRoot = path.join(tempRoot, "discovery-runtime");
const discoveryManifestPath = path.join(discoveryRuntimeRoot, "STAGE-EXECUTION-MANIFEST.json");
const d05RuntimeRoot = path.join(discoveryRuntimeRoot, "D05-Project-Overview");
const d05PromptPath = path.join(d05RuntimeRoot, "prompt", "project-overview.compiled.prompt.md");
const d05SchemaPath = path.join(d05RuntimeRoot, "contracts", "project-overview-output.schema.json");
const d10RuntimeRoot = path.join(tempRoot, "discovery-runtime", "D10-Architecture");
const d10PromptPath = path.join(d10RuntimeRoot, "prompt", "architecture.compiled.prompt.md");
const d10SchemaPath = path.join(d10RuntimeRoot, "contracts", "architecture-output.schema.json");
const d15RuntimeRoot = path.join(discoveryRuntimeRoot, "D15-Database");
const d15PromptPath = path.join(d15RuntimeRoot, "prompt", "database.compiled.prompt.md");
const d15SchemaPath = path.join(d15RuntimeRoot, "contracts", "database-output.schema.json");
const d20RuntimeRoot = path.join(discoveryRuntimeRoot, "D20-Dependencies-Integrations");
const d20PromptPath = path.join(d20RuntimeRoot, "prompt", "dependencies-integrations.compiled.prompt.md");
const d20SchemaPath = path.join(d20RuntimeRoot, "contracts", "dependencies-integrations-output.schema.json");
const port = 44317;
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(projectRoot, { recursive: true });
mkdirSync(path.dirname(startupRulePath), { recursive: true });
mkdirSync(path.dirname(d05PromptPath), { recursive: true });
mkdirSync(path.dirname(d05SchemaPath), { recursive: true });
mkdirSync(path.dirname(d10PromptPath), { recursive: true });
mkdirSync(path.dirname(d10SchemaPath), { recursive: true });
mkdirSync(path.dirname(d15PromptPath), { recursive: true });
mkdirSync(path.dirname(d15SchemaPath), { recursive: true });
mkdirSync(path.dirname(d20PromptPath), { recursive: true });
mkdirSync(path.dirname(d20SchemaPath), { recursive: true });
writeFileSync(
  discoveryManifestPath,
  readFileSync(path.join(__dirname, "..", "tests", "fixtures", "discovery-stage-execution-manifest.json"), "utf8"),
  "utf8"
);
writeFileSync(startupRulePath, "# Startup scope fixture rule\n", "utf8");
writeFileSync(
  startupContractPath,
  JSON.stringify({
    contract_version: "2.1.0",
    provider_tasks: {
      SCOPE_PROPOSAL: {
        rule: "rules/005-propose_scope.rules.md",
        output_schema: {
          type: "object",
          properties: {
            include: { type: "array" },
            exclude: { type: "array" },
            needs_user_decision: { type: "array" },
            summary: { type: "string" }
          },
          required: ["include", "exclude", "needs_user_decision", "summary"],
          additionalProperties: false
        }
      }
    }
  }),
  "utf8"
);
writeFileSync(
  d05PromptPath,
  [
    "# D05 compiled fixture",
    "PROJECT_ROOT={{PROJECT_ROOT}}",
    "SCOPE={{STARTUP_SCOPE_JSON}}",
    "SEAL={{STARTUP_SEAL_JSON}}",
    "CONTEXT={{DISCOVERY_CONTEXT_JSON}}",
    "LANG={{OUTPUT_LANGUAGE}}",
    "OV-001",
    "OV-082",
    "@startup/scope",
    "**Excluded evidence is a hard failure.** Unauthorized evidence must not be treated as completed."
  ].join("\n"),
  "utf8"
);
writeFileSync(
  d05SchemaPath,
  JSON.stringify({
    type: "object",
    properties: {
      audit_id: { type: "string", minLength: 1 },
      completed_at: { type: "string", format: "date-time" },
      result: {
        type: "object",
        properties: {
          substage: { type: "string", const: "D05-Project-Overview" },
          result: { type: "string", enum: ["PASS", "PASS_WITH_FINDINGS", "PARTIAL", "BLOCKED"] },
          summary: { type: "string" },
          checklist: { type: "array" }
        },
        required: ["substage", "result", "summary", "checklist"],
        additionalProperties: false
      },
      schema_version: { type: "string", const: "1.0" },
      substage: { type: "string", const: "D05-Project-Overview" },
      workspace_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }
    },
    required: ["audit_id", "completed_at", "result", "schema_version", "substage", "workspace_hash"],
    additionalProperties: false,
    $defs: {
      checkDisposition: {
        type: "object",
        required: ["check_id", "status", "evidence", "finding_ids", "unknown_ids", "contradiction_ids", "strength_ids", "notes", "confidence"]
      }
    }
  }),
  "utf8"
);


writeFileSync(
  d10PromptPath,
  [
    "# D10 compiled fixture",
    "PROJECT_ROOT={{PROJECT_ROOT}}",
    "SCOPE={{STARTUP_SCOPE_JSON}}",
    "SEAL={{STARTUP_SEAL_JSON}}",
    "CONTEXT={{DISCOVERY_CONTEXT_JSON}}",
    "LANG={{OUTPUT_LANGUAGE}}",
    "D05 prior context",
    "AR-001",
    "AR-082",
    "@startup/scope",
    "**Excluded evidence is a hard failure.** Unauthorized evidence must not be treated as completed."
  ].join("\n"),
  "utf8"
);
writeFileSync(
  d10SchemaPath,
  JSON.stringify({
    type: "object",
    properties: {
      audit_id: { type: "string", minLength: 1 },
      completed_at: { type: "string", format: "date-time" },
      result: {
        type: "object",
        properties: {
          substage: { type: "string", const: "D10-Architecture" },
          result: { type: "string", enum: ["PASS", "PASS_WITH_FINDINGS", "PARTIAL", "BLOCKED"] },
          summary: { type: "string" },
          checklist: { type: "array" }
        },
        required: ["substage", "result", "summary", "checklist"],
        additionalProperties: false
      },
      schema_version: { type: "string", const: "1.0" },
      substage: { type: "string", const: "D10-Architecture" },
      workspace_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }
    },
    required: ["audit_id", "completed_at", "result", "schema_version", "substage", "workspace_hash"],
    additionalProperties: false,
    $defs: {
      checkDisposition: {
        type: "object",
        properties: { check_id: { type: "string", pattern: "^AR-(00[1-9]|0[1-7][0-9]|08[0-2])$" } },
        required: ["check_id", "status", "evidence", "finding_ids", "unknown_ids", "contradiction_ids", "strength_ids", "notes", "confidence"]
      }
    }
  }),
  "utf8"
);

writeFileSync(
  d15PromptPath,
  [
    "# D15 compiled fixture",
    "PROJECT_ROOT={{PROJECT_ROOT}}",
    "SCOPE={{STARTUP_SCOPE_JSON}}",
    "SEAL={{STARTUP_SEAL_JSON}}",
    "CONTEXT={{DISCOVERY_CONTEXT_JSON}}",
    "LANG={{OUTPUT_LANGUAGE}}",
    "D05 prior context",
    "D10 prior context",
    "DB-001",
    "DB-116",
    "@startup/scope",
    "**Excluded evidence is a hard failure.** Unauthorized evidence must not be treated as completed."
  ].join("\n"),
  "utf8"
);
writeFileSync(
  d15SchemaPath,
  JSON.stringify({
    type: "object",
    properties: {
      audit_id: { type: "string", minLength: 1 },
      completed_at: { type: "string", format: "date-time" },
      result: {
        type: "object",
        properties: {
          substage: { type: "string", const: "D15-Database" },
          result: { type: "string", enum: ["PASS", "PASS_WITH_FINDINGS", "PARTIAL", "BLOCKED"] },
          summary: { type: "string" },
          checklist: { type: "array", minItems: 116, maxItems: 116 }
        },
        required: ["substage", "result", "summary", "checklist"],
        additionalProperties: false
      },
      schema_version: { type: "string", const: "1.0" },
      substage: { type: "string", const: "D15-Database" },
      workspace_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }
    },
    required: ["audit_id", "completed_at", "result", "schema_version", "substage", "workspace_hash"],
    additionalProperties: false,
    $defs: {
      checkDisposition: {
        type: "object",
        properties: { check_id: { type: "string", pattern: "^DB-(00[1-9]|0[1-9][0-9]|10[0-9]|11[0-6])$" } },
        required: ["check_id", "status", "evidence", "finding_ids", "unknown_ids", "contradiction_ids", "strength_ids", "notes", "confidence"]
      }
    }
  }),
  "utf8"
);

writeFileSync(
  d20PromptPath,
  [
    "# D20 compiled fixture",
    "PROJECT_ROOT={{PROJECT_ROOT}}",
    "SCOPE={{STARTUP_SCOPE_JSON}}",
    "SEAL={{STARTUP_SEAL_JSON}}",
    "CONTEXT={{DISCOVERY_CONTEXT_JSON}}",
    "LANG={{OUTPUT_LANGUAGE}}",
    "D05 prior context",
    "D10 prior context",
    "DI-001",
    "DI-102",
    "@startup/scope",
    "**Excluded evidence is a hard failure.** Unauthorized evidence must not be treated as completed."
  ].join("\n"),
  "utf8"
);
writeFileSync(
  d20SchemaPath,
  JSON.stringify({
    type: "object",
    properties: {
      audit_id: { type: "string", minLength: 1 },
      completed_at: { type: "string", format: "date-time" },
      result: {
        type: "object",
        properties: {
          substage: { type: "string", const: "D20-Dependencies-Integrations" },
          result: { type: "string", enum: ["PASS", "PASS_WITH_FINDINGS", "PARTIAL", "BLOCKED"] },
          summary: { type: "string" },
          checklist: { type: "array", minItems: 102, maxItems: 102 }
        },
        required: ["substage", "result", "summary", "checklist"],
        additionalProperties: false
      },
      schema_version: { type: "string", const: "1.0" },
      substage: { type: "string", const: "D20-Dependencies-Integrations" },
      workspace_hash: { type: "string", pattern: "^[a-f0-9]{64}$" }
    },
    required: ["audit_id", "completed_at", "result", "schema_version", "substage", "workspace_hash"],
    additionalProperties: false,
    $defs: {
      checkDisposition: {
        type: "object",
        properties: { check_id: { type: "string", pattern: "^DI-(00[1-9]|0[1-9][0-9]|10[0-2])$" } },
        required: ["check_id", "status", "evidence", "finding_ids", "unknown_ids", "contradiction_ids", "strength_ids", "notes", "confidence"]
      }
    }
  }),
  "utf8"
);


const child = spawn(process.execPath, [path.join(__dirname, "mock-cloud", "mock-cloud.cjs")], {
  env: {
    ...process.env,
    FORGEPILOT_MOCK_CLOUD_PORT: String(port),
    FORGEPILOT_MOCK_CLOUD_STATE_FILE: statePath,
    FORGEPILOT_STARTUP_CONTRACT: startupContractPath,
    FORGEPILOT_DISCOVERY_MANIFEST: discoveryManifestPath,
    FORGEPILOT_DISCOVERY_D05_PROMPT: d05PromptPath,
    FORGEPILOT_DISCOVERY_D05_SCHEMA: d05SchemaPath,
    FORGEPILOT_DISCOVERY_D10_PROMPT: d10PromptPath,
    FORGEPILOT_DISCOVERY_D10_SCHEMA: d10SchemaPath,
    FORGEPILOT_DISCOVERY_D15_PROMPT: d15PromptPath,
    FORGEPILOT_DISCOVERY_D15_SCHEMA: d15SchemaPath,
    FORGEPILOT_DISCOVERY_D20_PROMPT: d20PromptPath,
    FORGEPILOT_DISCOVERY_D20_SCHEMA: d20SchemaPath
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const waitForServer = () =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Mock cloud did not start.")), 5000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("ForgePilot mock cloud listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Mock cloud exited early with ${code}.`));
    });
  });

const requestJson = async (method, pathname, body) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} -> ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
};

const project = {
  id: randomUUID(),
  name: "protocol-fixture",
  rootPath: projectRoot,
  addedAt: new Date().toISOString(),
  lastOpenedAt: null
};

const LOCAL_OPERATIONS = [
  "startup.scope-status",
  "startup.save-scope-proposal",
  "startup.build-workspace-manifest",
  "startup.seal-workspace",
  "discovery.d05-status",
  "discovery.save-d05-result",
  "discovery.d10-status",
  "discovery.save-d10-result",
  "discovery.d15-status",
  "discovery.save-d15-result",
  "discovery.d20-status",
  "discovery.save-d20-result"
];

let startupScopeApproved = false;
let d05Completed = false;
let d10Completed = false;
let d15Completed = false;
let d20Completed = false;

const localOutputFor = (operation, inputs = {}) => {
  if (operation === "startup.scope-status") {
    return startupScopeApproved
      ? { state: "approved", approved: true, hasProposal: true, sealed: false, workspace_hash: null }
      : { state: "missing", approved: false, hasProposal: false, sealed: false, workspace_hash: null };
  }
  if (operation === "startup.save-scope-proposal") return { status: "pending_approval" };
  if (operation === "startup.build-workspace-manifest") {
    return { file_count: 1, manifest_hash: "a".repeat(64), scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64) };
  }
  if (operation === "startup.seal-workspace") {
    return { file_count: 1, manifest_hash: "a".repeat(64), scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64), status: "READY_FOR_DISCOVERY" };
  }
  if (operation === "discovery.d05-status") {
    if (inputs.reset === true) d05Completed = false;
    return {
      audit_id: "AUD-001",
      state: d05Completed ? "completed" : "ready",
      scope_hash: "b".repeat(64),
      workspace_hash: "c".repeat(64),
      startup_scope: { approved: { include: ["src"], exclude: [], explicit_files: [] }, scope_hash: "b".repeat(64) },
      startup_seal: { status: "READY_FOR_DISCOVERY", scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64), manifest_hash: "a".repeat(64), file_count: 1 },
      discovery_context: { audit_id: "AUD-001", completed_substages: [] }
    };
  }
  if (operation === "discovery.save-d05-result") {
    d05Completed = true;
    return { audit_id: "AUD-001", result: "PASS", finding_count: 0, unknown_count: 0, checklist_count: 82, saved: true };
  }
  if (operation === "discovery.d10-status") {
    if (!d05Completed) throw new Error("D10 fixture requires D05 first.");
    if (inputs.reset === true) d10Completed = false;
    return {
      audit_id: "AUD-001",
      state: d10Completed ? "completed" : "ready",
      prerequisite_d05: "completed",
      scope_hash: "b".repeat(64),
      workspace_hash: "c".repeat(64),
      startup_scope: { approved: { include: ["src"], exclude: [], explicit_files: [] }, scope_hash: "b".repeat(64) },
      startup_seal: { status: "READY_FOR_DISCOVERY", scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64), manifest_hash: "a".repeat(64), file_count: 1 },
      discovery_context: { audit_id: "AUD-001", completed_substages: ["D05-Project-Overview"], prior_d05: { summary: "fixture overview" } }
    };
  }
  if (operation === "discovery.save-d10-result") {
    d10Completed = true;
    return { audit_id: "AUD-001", result: "PASS", finding_count: 0, unknown_count: 0, checklist_count: 82, saved: true };
  }
  if (operation === "discovery.d15-status") {
    if (!d05Completed || !d10Completed) throw new Error("D15 fixture requires D05 + D10 first.");
    if (inputs.reset === true) d15Completed = false;
    return {
      audit_id: "AUD-001",
      state: d15Completed ? "completed" : "ready",
      prerequisite_d05: "completed",
      prerequisite_d10: "completed",
      scope_hash: "b".repeat(64),
      workspace_hash: "c".repeat(64),
      startup_scope: { approved: { include: ["src"], exclude: [], explicit_files: [] }, scope_hash: "b".repeat(64) },
      startup_seal: { status: "READY_FOR_DISCOVERY", scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64), manifest_hash: "a".repeat(64), file_count: 1 },
      discovery_context: { audit_id: "AUD-001", completed_substages: ["D05-Project-Overview", "D10-Architecture"], prior_d05: { summary: "fixture overview" }, prior_d10: { summary: "fixture architecture" } }
    };
  }
  if (operation === "discovery.save-d15-result") {
    d15Completed = true;
    return { audit_id: "AUD-001", result: "PASS", finding_count: 0, unknown_count: 0, checklist_count: 116, saved: true };
  }
  if (operation === "discovery.d20-status") {
    if (!d05Completed || !d10Completed) throw new Error("D20 fixture requires D05 + D10 first.");
    if (inputs.reset === true) d20Completed = false;
    return {
      audit_id: "AUD-001",
      state: d20Completed ? "completed" : "ready",
      prerequisite_d05: "completed",
      prerequisite_d10: "completed",
      scope_hash: "b".repeat(64),
      workspace_hash: "c".repeat(64),
      startup_scope: { approved: { include: ["src"], exclude: [], explicit_files: [] }, scope_hash: "b".repeat(64) },
      startup_seal: { status: "READY_FOR_DISCOVERY", scope_hash: "b".repeat(64), workspace_hash: "c".repeat(64), manifest_hash: "a".repeat(64), file_count: 1 },
      discovery_context: { audit_id: "AUD-001", completed_substages: ["D05-Project-Overview", "D10-Architecture"], prior_d05: { summary: "fixture overview" }, prior_d10: { summary: "fixture architecture" } }
    };
  }
  if (operation === "discovery.save-d20-result") {
    d20Completed = true;
    return { audit_id: "AUD-001", result: "PASS", finding_count: 0, unknown_count: 0, checklist_count: 102, saved: true };
  }
  throw new Error(`No fixture output for local operation ${operation}`);
};

const providerOutputFor = (directive) => {
  const task = directive.job.task?.instructions?.metadata?.localExecution?.semantic_task;
  if (task?.semantic_task_id === "SCOPE_PROPOSAL") {
    return { include: [{ path: "src", reason: "source", confidence: "high" }], exclude: [], needs_user_decision: [], summary: "fixture" };
  }
  if (task?.semantic_task_id === "D05_PROJECT_OVERVIEW") {
    const prompt = directive.job.task.instructions.body;
    if (
      !prompt.includes("OV-001") ||
      !prompt.includes("OV-082") ||
      !prompt.includes("LANG=Turkish") ||
      prompt.includes("{{PROJECT_ROOT}}") ||
      prompt.includes("{{OUTPUT_LANGUAGE}}")
    ) {
      throw new Error("D05 compiled prompt was not loaded/substituted correctly.");
    }
    return {
      audit_id: "AUD-001",
      completed_at: new Date().toISOString(),
      result: { substage: "D05-Project-Overview", result: "PASS", summary: "fixture overview", checklist: [] },
      schema_version: "1.0",
      substage: "D05-Project-Overview",
      workspace_hash: "c".repeat(64)
    };
  }
  if (task?.semantic_task_id === "D10_ARCHITECTURE") {
    const prompt = directive.job.task.instructions.body;
    if (
      !prompt.includes("AR-001") ||
      !prompt.includes("AR-082") ||
      !prompt.includes("LANG=Turkish") ||
      !prompt.includes("fixture overview") ||
      prompt.includes("{{DISCOVERY_CONTEXT_JSON}}") ||
      prompt.includes("{{OUTPUT_LANGUAGE}}")
    ) {
      throw new Error("D10 compiled prompt/context was not loaded/substituted correctly.");
    }
    return {
      audit_id: "AUD-001",
      completed_at: new Date().toISOString(),
      result: { substage: "D10-Architecture", result: "PASS", summary: "fixture architecture", checklist: [] },
      schema_version: "1.0",
      substage: "D10-Architecture",
      workspace_hash: "c".repeat(64)
    };
  }
  if (task?.semantic_task_id === "D15_DATABASE") {
    const prompt = directive.job.task.instructions.body;
    if (
      !prompt.includes("DB-001") ||
      !prompt.includes("DB-116") ||
      !prompt.includes("LANG=Turkish") ||
      !prompt.includes("fixture overview") ||
      !prompt.includes("fixture architecture") ||
      prompt.includes("{{DISCOVERY_CONTEXT_JSON}}") ||
      prompt.includes("{{OUTPUT_LANGUAGE}}")
    ) {
      throw new Error("D15 compiled prompt/context was not loaded/substituted correctly.");
    }
    return {
      audit_id: "AUD-001",
      completed_at: new Date().toISOString(),
      result: { substage: "D15-Database", result: "PASS", summary: "fixture database", checklist: Array.from({ length: 116 }, (_, i) => ({ check_id: `DB-${String(i + 1).padStart(3, "0")}` })) },
      schema_version: "1.0",
      substage: "D15-Database",
      workspace_hash: "c".repeat(64)
    };
  }
  if (task?.semantic_task_id === "D20_DEPENDENCIES_INTEGRATIONS") {
    const prompt = directive.job.task.instructions.body;
    if (
      !prompt.includes("DI-001") ||
      !prompt.includes("DI-102") ||
      !prompt.includes("LANG=Turkish") ||
      !prompt.includes("fixture overview") ||
      !prompt.includes("fixture architecture") ||
      prompt.includes("{{DISCOVERY_CONTEXT_JSON}}") ||
      prompt.includes("{{OUTPUT_LANGUAGE}}")
    ) {
      throw new Error("D20 compiled prompt/context was not loaded/substituted correctly.");
    }
    return {
      audit_id: "AUD-001",
      completed_at: new Date().toISOString(),
      result: { substage: "D20-Dependencies-Integrations", result: "PASS", summary: "fixture dependencies", checklist: Array.from({ length: 102 }, (_, i) => ({ check_id: `DI-${String(i + 1).padStart(3, "0")}` })) },
      schema_version: "1.0",
      substage: "D20-Dependencies-Integrations",
      workspace_hash: "c".repeat(64)
    };
  }
  throw new Error(`Unexpected provider task ${String(task?.semantic_task_id)}`);
};

const submitFakeProviderResult = async (directive, output) => {
  const now = new Date().toISOString();
  await requestJson("POST", `/jobs/${directive.job.id}/result`, {
    taskId: directive.job.task.id,
    jobId: directive.job.id,
    providerId: directive.job.providerId,
    status: "completed",
    exitCode: 0,
    outputChunks: [{ stream: "stdout", text: `${JSON.stringify(output)}\n`, timestamp: now }],
    findings: [],
    startedAt: now,
    finishedAt: now
  });
};

const workflowStage = async (stageId) => {
  const workflow = await requestJson("GET", `/workflows/current?projectId=${encodeURIComponent(project.id)}`);
  return workflow.stages.find((stage) => stage.id === stageId);
};

const runStage = async (stageId, expectedOutcome = "completed", newRun = false) => {
  let executionId = null;
  let previous = null;
  const providerTasks = [];
  const localOperations = [];

  for (let index = 0; index < 20; index += 1) {
    const next = await requestJson("POST", "/executions/next", {
      capabilities: ["stage-execution:directives-v1", "contract:010-startup@2.1.0", "contract:020-discovery@2.0.0"],
      executionId,
      localOperations: LOCAL_OPERATIONS,
      newRun: executionId ? false : newRun,
      previous,
      project,
      providerId: "claude-code",
      outputLanguage: "Turkish",
      timeoutMs: 5_400_000,
      stageId
    });
    executionId = next.executionId;
    const directive = next.directive;

    if (directive.kind === "terminal") {
      if (directive.outcome !== expectedOutcome) {
        throw new Error(`${stageId} ended as ${directive.outcome}: ${directive.message}`);
      }
      return { localOperations, providerTasks };
    }

    let output;
    if (directive.kind === "local") {
      localOperations.push(directive.operation);
      output = localOutputFor(directive.operation, directive.inputs);
    } else {
      const taskId = directive.job.task?.instructions?.metadata?.localExecution?.semantic_task?.semantic_task_id;
      providerTasks.push(taskId);
      if (!directive.outputSchema || directive.outputSchema.type !== "object") {
        throw new Error(`${taskId} semantic directive is missing its output schema.`);
      }
      output = providerOutputFor(directive);
      await submitFakeProviderResult(directive, output);
    }

    previous = { directiveId: directive.id, message: null, output, status: "completed" };
  }

  throw new Error(`${stageId} did not terminate.`);
};

(async () => {
  try {
    await waitForServer();
    const handshake = await requestJson("POST", "/session/handshake", {
      desktopVersion: "0.5.5",
      protocolVersion: "2",
      supportedCapabilities: ["stage-execution:directives-v1", "contract:010-startup@2.1.0", "contract:020-discovery@2.0.0"]
    });
    if (handshake.status !== "ok") throw new Error(`Handshake failed: ${handshake.message}`);

    const workflow = await requestJson("GET", `/workflows/current?projectId=${encodeURIComponent(project.id)}`);
    if (workflow.stages?.some((stage) => stage.id === "020-discovery" || stage.name === "020-Discovery")) {
      throw new Error("020-Discovery must not exist as an executable workflow stage.");
    }

    const initialD05 = await workflowStage("020-d05-project-overview");
    if (initialD05.status !== "waiting") throw new Error("D05 must wait for 010-Startup.");
    const initialD10 = await workflowStage("020-d10-architecture");
    if (initialD10.status !== "waiting") throw new Error("D10 must wait for D05.");
    const initialD15 = await workflowStage("020-d15-database");
    if (initialD15.status !== "waiting") throw new Error("D15 must wait for D05 + D10.");
    const initialD20 = await workflowStage("020-d20-dependencies-integrations");
    if (initialD20.status !== "waiting") throw new Error("D20 must wait for D05 + D10.");

    const startupProposal = await runStage("010-startup", "blocked");
    if (startupProposal.providerTasks[0] !== "SCOPE_PROPOSAL") throw new Error("Startup scope proposal task missing.");

    startupScopeApproved = true;
    await runStage("010-startup");

    const d05Ready = await workflowStage("020-d05-project-overview");
    if (d05Ready.status !== "ready") throw new Error("D05 did not become ready after Startup.");

    const d05 = await runStage("020-d05-project-overview");
    if (JSON.stringify(d05.providerTasks) !== JSON.stringify(["D05_PROJECT_OVERVIEW"])) {
      throw new Error(`D05 should use exactly one AI task, saw ${d05.providerTasks.join(", ")}.`);
    }
    for (const operation of ["discovery.d05-status", "discovery.save-d05-result"]) {
      if (!d05.localOperations.includes(operation)) throw new Error(`D05 missed ${operation}.`);
    }

    const d05After = await workflowStage("020-d05-project-overview");
    if (d05After.status !== "completed") throw new Error("D05 completion was not persisted by Cloud.");

    const d10Ready = await workflowStage("020-d10-architecture");
    if (d10Ready.status !== "ready") throw new Error("D10 did not become ready after D05.");
    const d10 = await runStage("020-d10-architecture");
    if (JSON.stringify(d10.providerTasks) !== JSON.stringify(["D10_ARCHITECTURE"])) {
      throw new Error(`D10 should use exactly one AI task, saw ${d10.providerTasks.join(", ")}.`);
    }
    for (const operation of ["discovery.d10-status", "discovery.save-d10-result"]) {
      if (!d10.localOperations.includes(operation)) throw new Error(`D10 missed ${operation}.`);
    }
    const d10After = await workflowStage("020-d10-architecture");
    if (d10After.status !== "completed") throw new Error("D10 completion was not persisted by Cloud.");

    const d15Ready = await workflowStage("020-d15-database");
    if (d15Ready.status !== "ready") throw new Error("D15 did not become ready after D05 + D10.");
    const d15 = await runStage("020-d15-database");
    if (JSON.stringify(d15.providerTasks) !== JSON.stringify(["D15_DATABASE"])) {
      throw new Error(`D15 should use exactly one AI task, saw ${d15.providerTasks.join(", ")}.`);
    }
    for (const operation of ["discovery.d15-status", "discovery.save-d15-result"]) {
      if (!d15.localOperations.includes(operation)) throw new Error(`D15 missed ${operation}.`);
    }
    const d15After = await workflowStage("020-d15-database");
    if (d15After.status !== "completed") throw new Error("D15 completion was not persisted by Cloud.");

    const d20Ready = await workflowStage("020-d20-dependencies-integrations");
    if (d20Ready.status !== "ready") throw new Error("D20 did not become ready after D05 + D10.");
    const d20 = await runStage("020-d20-dependencies-integrations");
    if (JSON.stringify(d20.providerTasks) !== JSON.stringify(["D20_DEPENDENCIES_INTEGRATIONS"])) {
      throw new Error(`D20 should use exactly one AI task, saw ${d20.providerTasks.join(", ")}.`);
    }
    for (const operation of ["discovery.d20-status", "discovery.save-d20-result"]) {
      if (!d20.localOperations.includes(operation)) throw new Error(`D20 missed ${operation}.`);
    }
    const d20After = await workflowStage("020-d20-dependencies-integrations");
    if (d20After.status !== "completed") throw new Error("D20 completion was not persisted by Cloud.");
    const d20Restart = await runStage("020-d20-dependencies-integrations", "completed", true);
    if (d20Restart.providerTasks[0] !== "D20_DEPENDENCIES_INTEGRATIONS") throw new Error("D20 Restart did not rerun only D20 AI task.");

    const d15Restart = await runStage("020-d15-database", "completed", true);
    if (d15Restart.providerTasks[0] !== "D15_DATABASE") throw new Error("D15 Restart did not rerun only D15 AI task.");

    const d10Restart = await runStage("020-d10-architecture", "completed", true);
    if (d10Restart.providerTasks[0] !== "D10_ARCHITECTURE") throw new Error("D10 Restart did not rerun only D10 AI task.");

    const d05Restart = await runStage("020-d05-project-overview", "completed", true);
    if (d05Restart.providerTasks[0] !== "D05_PROJECT_OVERVIEW") throw new Error("D05 Restart did not rerun only D05 AI task.");

    console.log("Execution protocol verification passed (Startup -> D05 -> D10 -> D15 + D20 -> independent D20/D15/D10/D05 restarts; compiled prompts + schemas loaded from AI Factory)." );
  } finally {
    child.kill("SIGTERM");
    rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
