const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "forgepilot-protocol-"));
const projectRoot = path.join(tempRoot, "project");
const statePath = path.join(tempRoot, "state.json");
const rulePath = path.join(tempRoot, "rule.md");
const port = 44317;
const baseUrl = `http://127.0.0.1:${port}`;
mkdirSync(projectRoot, { recursive: true });
writeFileSync(rulePath, "# Test rule\nVerification fixture only.\n", "utf8");

const ruleEnvironmentNames = [
  "FORGEPILOT_STARTUP_CHECK_FACTORY_RULE",
  "FORGEPILOT_STARTUP_READ_CONFIG_RULE",
  "FORGEPILOT_STARTUP_SELECT_RUN_RULE",
  "FORGEPILOT_STARTUP_PLACE_INPUTS_RULE",
  "FORGEPILOT_STARTUP_CAPTURE_GIT_STATE_RULE",
  "FORGEPILOT_STARTUP_BUILD_SOURCE_MANIFEST_RULE",
  "FORGEPILOT_STARTUP_BUILD_FACTORY_MANIFEST_RULE",
  "FORGEPILOT_STARTUP_SEAL_RUN_RULE",
  "FORGEPILOT_DISCOVERY_SCAN_PROJECT_RULE",
  "FORGEPILOT_DISCOVERY_CLASSIFY_FILES_RULE",
  "FORGEPILOT_DISCOVERY_INDEX_DOCUMENTS_RULE",
  "FORGEPILOT_DISCOVERY_MAP_DEPENDENCIES_RULE",
  "FORGEPILOT_DISCOVERY_BUILD_CONTEXT_RULE"
];

const child = spawn(process.execPath, [path.join(__dirname, "mock-cloud", "mock-cloud.cjs")], {
  env: {
    ...process.env,
    FORGEPILOT_MOCK_CLOUD_PORT: String(port),
    FORGEPILOT_MOCK_CLOUD_STATE_FILE: statePath,
    ...Object.fromEntries(ruleEnvironmentNames.map((name) => [name, rulePath]))
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const waitForServer = () =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Mock cloud did not start.")), 5000);
    const onData = (chunk) => {
      if (chunk.toString("utf8").includes("ForgePilot mock cloud listening")) {
        clearTimeout(timeout);
        resolve();
      }
    };
    child.stdout.on("data", onData);
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

const localOutputFor = (operation) => {
  const runId = "protocol-fixture-20260816-001";
  const outputs = {
    "startup.select-run": { decision: "new", run_id: runId },
    "startup.check": {
      check_factory: { created: true, path: path.join(projectRoot, ".ai-factory") },
      read_config: { locale: "tr-TR", mode: "test", version: "1" }
    },
    "startup.place-inputs": { baseline: "placed", run_id: runId, scope: "placed", status: "ready" },
    "startup.capture-git-state": { has_git: false, run_id: runId },
    "startup.build-source-manifest": { file_count: 1, run_id: runId },
    "startup.build-factory-manifest": { file_count: 1, run_id: runId },
    "startup.seal-run": {
      decision: "PASS",
      missing: [],
      pre_run_manifest_sha256: "fixture",
      run_id: runId
    },
    "discovery.scan-project": { directory_count: 1, file_count: 1 },
    "discovery.classify-files": { file_count: 1, unknown_count: 0 },
    "discovery.prepare-index-and-map": {
      preparation: { candidateDocuments: [] },
      mapDependencies: { package_count: 0, technology_count: 0 }
    },
    "discovery.finalize-index-documents": {
      document_count: 0,
      glossary_term_count: 0,
      missing_document_count: 0,
      reference_count: 0
    },
    "discovery.prepare-context": {
      businessTerms: [],
      documents: [],
      manifestDescriptionCandidates: [],
      modules: []
    },
    "discovery.finalize-context": {
      entity_count: 0,
      module_count: 0,
      unknown_count: 0,
      user_role_count: 0
    }
  };
  if (!(operation in outputs)) {
    throw new Error(`No fixture output for local operation ${operation}`);
  }
  return outputs[operation];
};

const providerOutputFor = (directive) => {
  const localExecution = directive.job.task?.instructions?.metadata?.localExecution ?? {};
  if (directive.mode === "semantic") {
    if (localExecution.index_documents_candidates) {
      return { candidates: [] };
    }
    return {};
  }
  return { ok: true };
};

const submitFakeProviderResult = async (directive, output) => {
  const now = new Date().toISOString();
  const result = {
    taskId: directive.job.task.id,
    jobId: directive.job.id,
    providerId: directive.job.providerId,
    status: "completed",
    exitCode: 0,
    outputChunks: [
      { stream: "stdout", text: `${JSON.stringify(output)}\n`, timestamp: now }
    ],
    findings: [],
    startedAt: now,
    finishedAt: now
  };
  await requestJson("POST", `/jobs/${directive.job.id}/result`, result);
};

const workflowStage = async (stageId) => {
  const workflow = await requestJson("GET", `/workflows/current?projectId=${encodeURIComponent(project.id)}`);
  return workflow.stages.find((stage) => stage.id === stageId);
};


const verifyDuplicateResultIdempotency = async () => {
  const fixtureProject = { ...project, id: randomUUID(), name: "idempotency-fixture" };
  const base = {
    capabilities: ["stage-execution:directives-v1"],
    executionId: null,
    localOperations: [
      "startup.select-run",
      "startup.check",
      "startup.place-inputs",
      "startup.capture-git-state",
      "startup.build-source-manifest",
      "startup.build-factory-manifest",
      "startup.seal-run"
    ],
    newRun: false,
    previous: null,
    project: fixtureProject,
    providerId: "claude-code",
    stageId: "010-startup"
  };
  const first = await requestJson("POST", "/executions/next", base);
  const previous = {
    directiveId: first.directive.id,
    message: null,
    output: { decision: "new", run_id: "idempotency-20260816-001" },
    status: "completed"
  };
  const second = await requestJson("POST", "/executions/next", {
    ...base,
    executionId: first.executionId,
    previous
  });
  const duplicate = await requestJson("POST", "/executions/next", {
    ...base,
    executionId: first.executionId,
    previous
  });

  if (second.directive.id !== duplicate.directive.id) {
    throw new Error("Duplicate previous result advanced the server state machine twice.");
  }
};

const runStage = async (stageId, verifyMidStage) => {
  let executionId = null;
  let previous = null;
  let providerCount = 0;

  for (let index = 0; index < 60; index += 1) {
    const next = await requestJson("POST", "/executions/next", {
      capabilities: ["stage-execution:directives-v1"],
      executionId,
      localOperations: [
        "startup.select-run",
        "startup.check",
        "startup.place-inputs",
        "startup.capture-git-state",
        "startup.build-source-manifest",
        "startup.build-factory-manifest",
        "startup.seal-run",
        "discovery.scan-project",
        "discovery.classify-files",
        "discovery.prepare-index-and-map",
        "discovery.finalize-index-documents",
        "discovery.prepare-context",
        "discovery.finalize-context"
      ],
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
      return;
    }

    let output;
    if (directive.kind === "local") {
      output = localOutputFor(directive.operation);
    } else {
      providerCount += 1;
      output = providerOutputFor(directive);
      await submitFakeProviderResult(directive, output);
      if (verifyMidStage) {
        await verifyMidStage(providerCount);
      }
    }

    previous = {
      directiveId: directive.id,
      message: null,
      output,
      status: "completed"
    };
  }

  throw new Error(`${stageId} did not terminate.`);
};

(async () => {
  try {
    await waitForServer();
    const handshake = await requestJson("POST", "/session/handshake", {
      desktopVersion: "0.2.1",
      protocolVersion: "2",
      supportedCapabilities: ["stage-execution:directives-v1"]
    });
    if (handshake.protocolVersion !== "2") {
      throw new Error("Mock cloud did not negotiate protocol v2.");
    }

    const incompatibleHandshake = await requestJson("POST", "/session/handshake", {
      desktopVersion: "0.1.0",
      protocolVersion: "1",
      supportedCapabilities: ["stage-execution:directives-v1"]
    });
    if (incompatibleHandshake.status !== "update-required") {
      throw new Error("Mock cloud accepted an incompatible protocol version.");
    }

    await verifyDuplicateResultIdempotency();

    const initialStartup = await workflowStage("010-startup");
    const initialDiscovery = await workflowStage("020-discovery");
    if (initialStartup.status !== "ready" || initialDiscovery.status !== "waiting") {
      throw new Error("Initial workflow gating is incorrect.");
    }

    await runStage("010-startup", async () => {
      const stage = await workflowStage("010-startup");
      if (stage.status === "completed") {
        throw new Error("Startup completed from an individual provider result before terminal state.");
      }
    });

    const startupAfter = await workflowStage("010-startup");
    const discoveryReady = await workflowStage("020-discovery");
    if (startupAfter.status !== "completed" || discoveryReady.status !== "ready") {
      throw new Error("Startup terminal completion did not unlock Discovery.");
    }

    await runStage("020-discovery", async (providerCount) => {
      if (providerCount === 2) {
        const stage = await workflowStage("020-discovery");
        if (stage.status === "completed") {
          throw new Error("Discovery completed after classify-files verification; later jobs were skipped.");
        }
      }
    });

    const discoveryAfter = await workflowStage("020-discovery");
    if (discoveryAfter.status !== "completed") {
      throw new Error("Discovery terminal completion was not persisted.");
    }

    console.log("Execution protocol verification passed.");
  } finally {
    child.kill("SIGTERM");
    rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
