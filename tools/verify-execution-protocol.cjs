const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "forgepilot-protocol-"));
const projectRoot = path.join(tempRoot, "project");
const statePath = path.join(tempRoot, "state.json");
const rulePath = path.join(tempRoot, "startup-rule.md");
const port = 44317;
const baseUrl = `http://127.0.0.1:${port}`;
mkdirSync(projectRoot, { recursive: true });
writeFileSync(rulePath, "# Startup test rule\n", "utf8");

const startupRuleEnvironmentNames = [
  "FORGEPILOT_STARTUP_CHECK_FACTORY_RULE",
  "FORGEPILOT_STARTUP_READ_CONFIG_RULE",
  "FORGEPILOT_STARTUP_SELECT_RUN_RULE",
  "FORGEPILOT_STARTUP_PLACE_INPUTS_RULE",
  "FORGEPILOT_STARTUP_CAPTURE_GIT_STATE_RULE",
  "FORGEPILOT_STARTUP_BUILD_SOURCE_MANIFEST_RULE",
  "FORGEPILOT_STARTUP_BUILD_FACTORY_MANIFEST_RULE",
  "FORGEPILOT_STARTUP_SEAL_RUN_RULE"
];

const child = spawn(process.execPath, [path.join(__dirname, "mock-cloud", "mock-cloud.cjs")], {
  env: {
    ...process.env,
    FORGEPILOT_MOCK_CLOUD_PORT: String(port),
    FORGEPILOT_MOCK_CLOUD_STATE_FILE: statePath,
    ...Object.fromEntries(startupRuleEnvironmentNames.map((name) => [name, rulePath]))
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
  "startup.select-run",
  "startup.check",
  "startup.place-inputs",
  "startup.capture-git-state",
  "startup.build-source-manifest",
  "startup.build-factory-manifest",
  "startup.seal-run",
  "discovery.scan-project",
  "discovery.classify-files",
  "discovery.prepare-index-documents-v2",
  "discovery.finalize-index-documents-v2",
  "discovery.map-dependencies",
  "discovery.prepare-context-v2",
  "discovery.finalize-context-v2",
  "discovery.map-module-dependencies-v2",
  "discovery.prepare-detect-gaps-v2",
  "discovery.finalize-detect-gaps-v2",
  "discovery.score-and-gate-v2",
  "discovery.prepare-report-v2",
  "discovery.finalize-report-v2"
];

const semanticPayload = (semanticTaskId) => ({
  semantic_task_id: semanticTaskId,
  contract_version: "2.0.0",
  budget: {
    max_payload_utf8_bytes: 98304,
    max_source_items: 40,
    max_excerpt_utf8_bytes_per_source: 8192,
    max_structured_records: 400,
    actual_payload_utf8_bytes: 256,
    source_items: 0,
    structured_records: 0,
    truncated: false
  }
});

const localOutputFor = (operation) => {
  const runId = "protocol-fixture-20260816-001";
  const outputs = {
    "startup.select-run": { decision: "new", run_id: runId },
    "startup.check": { check_factory: { created: true }, read_config: { version: "1" } },
    "startup.place-inputs": { run_id: runId, status: "ready" },
    "startup.capture-git-state": { has_git: false, run_id: runId },
    "startup.build-source-manifest": { file_count: 1, run_id: runId },
    "startup.build-factory-manifest": { file_count: 1, run_id: runId },
    "startup.seal-run": { decision: "PASS", missing: [], run_id: runId },
    "discovery.scan-project": { directory_count: 1, file_count: 1 },
    "discovery.classify-files": { file_count: 1, unknown_count: 0 },
    "discovery.prepare-index-documents-v2": {
      preparationId: "d03-prep",
      semanticNeeded: true,
      semanticPayload: semanticPayload("D03_DOMAIN_GLOSSARY")
    },
    "discovery.finalize-index-documents-v2": { document_count: 1, glossary_term_count: 0 },
    "discovery.map-dependencies": { package_count: 0, technology_count: 0 },
    "discovery.prepare-context-v2": {
      preparationId: "d04-prep",
      semanticNeeded: true,
      semanticPayload: semanticPayload("D04_CONTEXT_FIELDS")
    },
    "discovery.finalize-context-v2": { module_count: 1, unknown_count: 0 },
    "discovery.map-module-dependencies-v2": { edge_count: 0, module_count: 1 },
    "discovery.prepare-detect-gaps-v2": {
      preparationId: "d05-prep",
      semanticNeeded: true,
      semanticPayload: semanticPayload("D05_SEMANTIC_GAPS")
    },
    "discovery.finalize-detect-gaps-v2": { gap_count: 1, issue_count: 0, warning_count: 1 },
    "discovery.score-and-gate-v2": {
      decision: "PASS_WITH_WARNINGS",
      matched_rule: "GATE-D06-06",
      overall: 98
    },
    "discovery.prepare-report-v2": {
      preparationId: "d07-prep",
      semanticNeeded: true,
      semanticPayload: semanticPayload("D07_REPORT_PROSE")
    },
    "discovery.finalize-report-v2": { report_files: 4, gate_decision: "PASS_WITH_WARNINGS" }
  };
  if (!(operation in outputs)) throw new Error(`No fixture output for local operation ${operation}`);
  return outputs[operation];
};

const providerOutputFor = (directive) => {
  const task = directive.job.task?.instructions?.metadata?.localExecution?.semantic_task;
  if (directive.mode !== "semantic") return { ok: true };
  switch (task?.semantic_task_id) {
    case "D03_DOMAIN_GLOSSARY":
    case "D05_SEMANTIC_GAPS":
      return { candidates: [] };
    case "D04_CONTEXT_FIELDS":
      return { project: { type: "UNKNOWN", purpose: "UNKNOWN", evidence: { type: null, purpose: null } }, business_domain: { name: "UNKNOWN", name_evidence: null }, assumptions: [], modules: [] };
    case "D07_REPORT_PROSE":
      return { executive_summary_body: "Fixture summary.", recommended_actions: [] };
    default:
      return { ok: true };
  }
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

const runStage = async (stageId) => {
  let executionId = null;
  let previous = null;
  const providerTasks = [];
  const localOperations = [];

  for (let index = 0; index < 80; index += 1) {
    const next = await requestJson("POST", "/executions/next", {
      capabilities: ["stage-execution:directives-v1", "contract:020-discovery@2.0.0"],
      executionId,
      localOperations: LOCAL_OPERATIONS,
      newRun: false,
      previous,
      project,
      providerId: "claude-code",
      stageId
    });
    executionId = next.executionId;
    const directive = next.directive;

    if (directive.kind === "terminal") {
      if (directive.outcome !== "completed") {
        throw new Error(`${stageId} ended as ${directive.outcome}: ${directive.message}`);
      }
      return { localOperations, providerTasks };
    }

    let output;
    if (directive.kind === "local") {
      localOperations.push(directive.operation);
      output = localOutputFor(directive.operation);
    } else {
      const taskId = directive.job.task?.instructions?.metadata?.localExecution?.semantic_task?.semantic_task_id ?? "startup-verification";
      providerTasks.push(taskId);
      output = providerOutputFor(directive);
      await submitFakeProviderResult(directive, output);
      const midStage = await workflowStage(stageId);
      if (midStage.status === "completed") {
        throw new Error(`${stageId} completed from an intermediate provider result.`);
      }
    }

    previous = { directiveId: directive.id, message: null, output, status: "completed" };
  }

  throw new Error(`${stageId} did not terminate.`);
};

(async () => {
  try {
    await waitForServer();
    const handshake = await requestJson("POST", "/session/handshake", {
      desktopVersion: "0.3.0",
      protocolVersion: "2",
      supportedCapabilities: ["stage-execution:directives-v1", "contract:020-discovery@2.0.0"]
    });
    if (handshake.status !== "ok" || handshake.protocolVersion !== "2") {
      throw new Error("Mock cloud did not negotiate Discovery contract v2.");
    }

    const missingContract = await requestJson("POST", "/session/handshake", {
      desktopVersion: "0.2.1",
      protocolVersion: "2",
      supportedCapabilities: ["stage-execution:directives-v1"]
    });
    if (missingContract.status !== "update-required") {
      throw new Error("Mock cloud accepted a desktop without Discovery contract v2 capability.");
    }

    const initialStartup = await workflowStage("010-startup");
    const initialDiscovery = await workflowStage("020-discovery");
    if (initialStartup.status !== "ready" || initialDiscovery.status !== "waiting") {
      throw new Error("Initial workflow gating is incorrect.");
    }

    const startup = await runStage("010-startup");
    if (startup.providerTasks.length !== 1 || startup.providerTasks[0] !== "startup-verification") {
      throw new Error(`Startup should use one final provider verification, saw ${startup.providerTasks.join(", ")}.`);
    }

    const startupAfter = await workflowStage("010-startup");
    const discoveryReady = await workflowStage("020-discovery");
    if (startupAfter.status !== "completed" || discoveryReady.status !== "ready") {
      throw new Error("Startup terminal completion did not unlock Discovery.");
    }

    const discovery = await runStage("020-discovery");
    const expectedSemantic = [
      "D03_DOMAIN_GLOSSARY",
      "D04_CONTEXT_FIELDS",
      "D05_SEMANTIC_GAPS",
      "D07_REPORT_PROSE"
    ];
    if (JSON.stringify(discovery.providerTasks) !== JSON.stringify(expectedSemantic)) {
      throw new Error(`Discovery provider tasks are not the v2 semantic allowlist: ${discovery.providerTasks.join(", ")}.`);
    }
    for (const deterministicOperation of [
      "discovery.scan-project",
      "discovery.classify-files",
      "discovery.map-dependencies",
      "discovery.map-module-dependencies-v2",
      "discovery.score-and-gate-v2"
    ]) {
      if (!discovery.localOperations.includes(deterministicOperation)) {
        throw new Error(`Missing deterministic Discovery operation: ${deterministicOperation}`);
      }
    }

    const discoveryAfter = await workflowStage("020-discovery");
    if (discoveryAfter.status !== "completed") {
      throw new Error("Discovery terminal completion was not persisted.");
    }

    console.log("Execution protocol verification passed (Startup single verifier + Discovery v2 semantic allowlist)." );
  } finally {
    child.kill("SIGTERM");
    rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
