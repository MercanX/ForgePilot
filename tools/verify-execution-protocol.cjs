const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require("node:fs");
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
const d05RuntimeRoot = path.join(tempRoot, "discovery-runtime", "D05-Project-Overview");
const d05PromptPath = path.join(d05RuntimeRoot, "prompt", "project-overview.compiled.prompt.md");
const d05SchemaPath = path.join(d05RuntimeRoot, "contracts", "project-overview-output.schema.json");
const port = 44317;
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(projectRoot, { recursive: true });
mkdirSync(path.dirname(startupRulePath), { recursive: true });
mkdirSync(path.dirname(d05PromptPath), { recursive: true });
mkdirSync(path.dirname(d05SchemaPath), { recursive: true });
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
    "OV-001",
    "OV-082"
  ].join("\n"),
  "utf8"
);
writeFileSync(
  d05SchemaPath,
  JSON.stringify({
    type: "object",
    properties: {
      substage: { type: "string", enum: ["D05-Project-Overview"] },
      result: { type: "string", enum: ["PASS", "PASS_WITH_FINDINGS", "PARTIAL", "BLOCKED"] },
      summary: { type: "string" },
      checklist: { type: "array" }
    },
    required: ["substage", "result", "summary", "checklist"],
    additionalProperties: false
  }),
  "utf8"
);

const child = spawn(process.execPath, [path.join(__dirname, "mock-cloud", "mock-cloud.cjs")], {
  env: {
    ...process.env,
    FORGEPILOT_MOCK_CLOUD_PORT: String(port),
    FORGEPILOT_MOCK_CLOUD_STATE_FILE: statePath,
    FORGEPILOT_STARTUP_CONTRACT: startupContractPath,
    FORGEPILOT_DISCOVERY_D05_PROMPT: d05PromptPath,
    FORGEPILOT_DISCOVERY_D05_SCHEMA: d05SchemaPath
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
  "discovery.save-d05-result"
];

let startupScopeApproved = false;
let d05Completed = false;

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
  throw new Error(`No fixture output for local operation ${operation}`);
};

const providerOutputFor = (directive) => {
  const task = directive.job.task?.instructions?.metadata?.localExecution?.semantic_task;
  if (task?.semantic_task_id === "SCOPE_PROPOSAL") {
    return { include: [{ path: "src", reason: "source", confidence: "high" }], exclude: [], needs_user_decision: [], summary: "fixture" };
  }
  if (task?.semantic_task_id === "D05_PROJECT_OVERVIEW") {
    const prompt = directive.job.task.instructions.body;
    if (!prompt.includes("OV-001") || !prompt.includes("OV-082") || prompt.includes("{{PROJECT_ROOT}}")) {
      throw new Error("D05 compiled prompt was not loaded/substituted correctly.");
    }
    return { substage: "D05-Project-Overview", result: "PASS", summary: "fixture overview", checklist: [] };
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
      desktopVersion: "0.4.8",
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

    const d05Restart = await runStage("020-d05-project-overview", "completed", true);
    if (d05Restart.providerTasks[0] !== "D05_PROJECT_OVERVIEW") throw new Error("D05 Restart did not rerun only D05 AI task.");

    console.log("Execution protocol verification passed (Startup -> manual D05 -> D05 restart; compiled prompt + schema loaded from AI Factory)." );
  } finally {
    child.kill("SIGTERM");
    rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
