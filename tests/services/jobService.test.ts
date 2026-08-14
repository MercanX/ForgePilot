import type { HttpClient } from "@services/api/httpClient";
import { createJobService } from "@services/jobs/jobService";
import type { TaskExecutionService } from "@services/tasks/taskExecutionService";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type {
  FailJobRequest,
  GetTaskResponse,
  HandshakeResponse,
  RequestJobRequest,
  RequestJobResponse,
  SubmitResultResponse,
  SyncFindingsRequest
} from "@shared/schemas/cloud-api";
import type { TaskExitEvent, TaskOutputEvent } from "@shared/schemas/job";
import type { Unsubscribe } from "@shared/types/provider-adapter";

import { projectFixture } from "../shared/fixtures";

const job: RequestJobResponse = {
  exitCode: null,
  finishedAt: null,
  id: "11111111-1111-4111-8111-111111111111",
  providerId: PROVIDER_IDS.claudeCode,
  runId: "22222222-2222-4222-8222-222222222222",
  stageId: "mock-analysis",
  startedAt: "2026-08-14T00:00:00.000Z",
  status: "received",
  task: {
    id: "33333333-3333-4333-8333-333333333333",
    instructions: {
      body: "Say hello",
      format: "plain-text",
      metadata: {}
    },
    jobId: "11111111-1111-4111-8111-111111111111",
    timeoutMs: 300_000
  }
};

const task: GetTaskResponse = {
  id: "33333333-3333-4333-8333-333333333333",
  instructions: {
    body: "Say hello",
    format: "plain-text",
    metadata: {}
  },
  jobId: "11111111-1111-4111-8111-111111111111",
  timeoutMs: 300_000
};

describe("jobService", () => {
  it("runs a cloud job through the selected provider and submits the result", async () => {
    const postMock = vi.fn((path: string, body: unknown): Promise<unknown> => {
      if (path === "/session/handshake") {
        return Promise.resolve({
          message: "ok",
          protocolVersion: "1",
          serverVersion: "mock-0.1.0",
          status: "ok"
        } satisfies HandshakeResponse);
      }

      if (path === "/jobs/request") {
        expect((body as RequestJobRequest).project.id).toBe(projectFixture.id);
        return Promise.resolve(job);
      }

      if (path.endsWith("/result")) {
        return Promise.resolve({
          accepted: true,
          findings: []
        } satisfies SubmitResultResponse);
      }

      if (path === "/findings/sync") {
        expect((body as SyncFindingsRequest).runId).toBe(job.runId);
        return Promise.resolve({ accepted: true });
      }

      if (path.endsWith("/fail") || path.endsWith("/heartbeat")) {
        return Promise.resolve({ accepted: true });
      }

      return Promise.reject(new Error(`Unexpected POST ${path}`));
    });
    const getMock = vi.fn((path: string): Promise<unknown> => {
      if (path.startsWith("/workflows/current")) {
        return Promise.resolve({
          stages: [
            {
              currentAgent: "Mock",
              currentOperation: "Testing",
              id: "mock-analysis",
              name: "Mock Analysis",
              progress: 0,
              status: "ready"
            }
          ],
          workflowId: "mock",
          workflowVersion: "1.0.0"
        });
      }

      if (path === `/jobs/${job.id}`) {
        return Promise.resolve(task);
      }

      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    const client: HttpClient = {
      get: (path, schema) => getMock(path).then((payload) => schema.parse(payload)),
      post: (path, body, schema) => postMock(path, body).then((payload) => schema.parse(payload))
    };
    const outputCallbacks = new Set<(event: TaskOutputEvent) => void>();
    const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
    const taskService: TaskExecutionService = {
      dispose: vi.fn(),
      onExit: vi.fn((callback: (event: TaskExitEvent) => void): Unsubscribe => {
        exitCallbacks.add(callback);
        return () => exitCallbacks.delete(callback);
      }),
      onOutput: vi.fn((callback: (event: TaskOutputEvent) => void): Unsubscribe => {
        outputCallbacks.add(callback);
        return () => outputCallbacks.delete(callback);
      }),
      start: vi.fn(() => {
        setTimeout(() => {
          for (const callback of outputCallbacks) {
            callback({
              chunk: {
                stream: "stdout",
                text: "hello from provider",
                timestamp: "2026-08-14T00:00:01.000Z"
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId: "44444444-4444-4444-8444-444444444444"
            });
          }
          for (const callback of exitCallbacks) {
            callback({
              exitInfo: {
                exitCode: 0,
                finishedAt: "2026-08-14T00:00:02.000Z",
                signal: null
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId: "44444444-4444-4444-8444-444444444444"
            });
          }
        }, 0);

        return Promise.resolve({
          handle: {
            id: "44444444-4444-4444-8444-444444444444",
            processId: 123,
            providerId: PROVIDER_IDS.claudeCode
          },
          startedAt: "2026-08-14T00:00:01.000Z"
        });
      }),
      stop: vi.fn(() => true)
    };
    const service = createJobService({
      createClient: () => client,
      taskExecutionService: taskService
    });

    const response = await service.runOnce({
      model: "sonnet",
      project: projectFixture,
      providerId: PROVIDER_IDS.claudeCode,
      serverUrl: "http://localhost:4317",
      stageId: null,
      timeoutMs: 1_000
    });

    expect(response.result.status).toBe("completed");
    expect(response.result.outputChunks).toHaveLength(1);
    const resultCall = postMock.mock.calls.find(([path]) => path === `/jobs/${job.id}/result`);
    const resultPayload = resultCall?.[1] as { outputChunks: Array<{ text: string }> } | undefined;
    expect(resultPayload?.outputChunks[0]?.text).toBe("hello from provider");
  });

  it("reports client failures to the cloud", async () => {
    const failPayloads: FailJobRequest[] = [];
    const client: HttpClient = {
      get: (path, schema) => {
        if (path.startsWith("/workflows/current")) {
          return Promise.resolve(
            schema.parse({
              stages: [],
              workflowId: "mock",
              workflowVersion: "1.0.0"
            })
          );
        }

        if (path === `/jobs/${job.id}`) {
          return Promise.resolve(schema.parse(task));
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => {
        if (path === "/session/handshake") {
          return Promise.resolve(
            schema.parse({
              message: "ok",
              protocolVersion: "1",
              serverVersion: "mock-0.1.0",
              status: "ok"
            })
          );
        }

        if (path === "/jobs/request") {
          return Promise.resolve(schema.parse(job));
        }

        if (path.endsWith("/fail")) {
          failPayloads.push(body as FailJobRequest);
          return Promise.resolve(schema.parse({ accepted: true }));
        }

        return Promise.reject(new Error(`Unexpected POST ${path}`));
      }
    };
    const taskService: TaskExecutionService = {
      dispose: vi.fn(),
      onExit: vi.fn(() => () => undefined),
      onOutput: vi.fn(() => () => undefined),
      start: vi.fn(() => Promise.reject(new Error("provider failed"))),
      stop: vi.fn(() => false)
    };
    const service = createJobService({
      createClient: () => client,
      taskExecutionService: taskService
    });

    await expect(
      service.runOnce({
        model: "sonnet",
        project: projectFixture,
        providerId: PROVIDER_IDS.claudeCode,
        serverUrl: "http://localhost:4317",
        stageId: null,
        timeoutMs: 1_000
      })
    ).rejects.toThrow("provider failed");
    expect(failPayloads[0]).toEqual(
      expect.objectContaining({
        jobId: job.id,
        reason: "client-error"
      })
    );
  });

  it("runs the local startup job before requesting the startup cloud task", async () => {
    const startupResult = {
      check_factory: {
        created: true,
        path: "C:\\Github\\ForgePilot\\.ai-factory"
      },
      read_config: {
        locale: "tr-TR",
        mode: "unknown",
        version: "unknown"
      }
    };
    const postMock = vi.fn((path: string, body: unknown): Promise<unknown> => {
      if (path === "/session/handshake") {
        return Promise.resolve({
          message: "ok",
          protocolVersion: "1",
          serverVersion: "mock-0.1.0",
          status: "ok"
        } satisfies HandshakeResponse);
      }

      if (path === "/jobs/request") {
        expect((body as RequestJobRequest).localExecution).toEqual(startupResult);
        return Promise.resolve(job);
      }

      if (path.endsWith("/result")) {
        return Promise.resolve({
          accepted: true,
          findings: []
        } satisfies SubmitResultResponse);
      }

      if (path === "/findings/sync" || path.endsWith("/heartbeat")) {
        return Promise.resolve({ accepted: true });
      }

      return Promise.reject(new Error(`Unexpected POST ${path}`));
    });
    const client: HttpClient = {
      get: (path, schema) => {
        if (path.startsWith("/workflows/current")) {
          return Promise.resolve(
            schema.parse({
              stages: [
                {
                  currentAgent: "Startup Agent",
                  currentOperation: "Waiting",
                  id: "010-startup",
                  name: "010-Startup",
                  progress: 0,
                  status: "ready"
                }
              ],
              workflowId: "mock",
              workflowVersion: "1.0.0"
            })
          );
        }

        if (path === `/jobs/${job.id}`) {
          return Promise.resolve(schema.parse(task));
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => postMock(path, body).then((payload) => schema.parse(payload))
    };
    const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
    const taskService: TaskExecutionService = {
      dispose: vi.fn(),
      onExit: vi.fn((callback: (event: TaskExitEvent) => void): Unsubscribe => {
        exitCallbacks.add(callback);
        return () => exitCallbacks.delete(callback);
      }),
      onOutput: vi.fn(() => () => undefined),
      start: vi.fn(() => {
        setTimeout(() => {
          for (const callback of exitCallbacks) {
            callback({
              exitInfo: {
                exitCode: 0,
                finishedAt: "2026-08-14T00:00:02.000Z",
                signal: null
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId: "44444444-4444-4444-8444-444444444444"
            });
          }
        }, 0);

        return Promise.resolve({
          handle: {
            id: "44444444-4444-4444-8444-444444444444",
            processId: 123,
            providerId: PROVIDER_IDS.claudeCode
          },
          startedAt: "2026-08-14T00:00:01.000Z"
        });
      }),
      stop: vi.fn(() => true)
    };
    const runStartupJobMock = vi.fn(() => Promise.resolve(startupResult));
    const service = createJobService({
      createClient: () => client,
      runStartupJob: runStartupJobMock,
      taskExecutionService: taskService
    });

    await service.runOnce({
      model: "sonnet",
      project: projectFixture,
      providerId: PROVIDER_IDS.claudeCode,
      serverUrl: "http://localhost:4317",
      stageId: "010-startup",
      timeoutMs: 1_000
    });

    expect(runStartupJobMock).toHaveBeenCalledWith(projectFixture.rootPath);
    expect(postMock).toHaveBeenCalledWith(
      "/jobs/request",
      expect.objectContaining({ localExecution: startupResult })
    );
  });
});
