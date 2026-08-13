const http = require("node:http");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.FORGEPILOT_MOCK_CLOUD_PORT ?? 4317);
const jobs = new Map();

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

const createTask = (jobId, projectName) => ({
  id: randomUUID(),
  jobId,
  instructions: {
    body: `Summarize the local workspace named "${projectName}" in one short sentence. Do not modify files.`,
    format: "plain-text",
    metadata: {
      source: "mock-cloud"
    }
  },
  timeoutMs: 300000
});

const createJob = (requestBody) => {
  const jobId = randomUUID();
  const runId = randomUUID();
  const task = createTask(jobId, requestBody.project.name);

  return {
    id: jobId,
    runId,
    stageId: "mock-analysis",
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
            id: "mock-analysis",
            name: "Mock Analysis",
            status: "ready",
            progress: 0,
            currentAgent: "Mock Cloud",
            currentOperation: "Waiting for provider execution"
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
