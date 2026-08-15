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
      newRun: false,
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
        newRun: false,
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
      newRun: false,
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

  it("requests place_inputs after startup and select_run verification return ok true", async () => {
    const startupResult = {
      check_factory: {
        created: false,
        path: "C:\\Github\\ForgePilot\\.ai-factory"
      },
      read_config: {
        locale: "tr-TR",
        mode: "unknown",
        version: "unknown"
      }
    };
    const selectRunResult = {
      decision: "new" as const,
      run_id: "ForgePilot-20260814-001"
    };
    const placeInputsResult = {
      baseline: "missing" as const,
      run_id: "ForgePilot-20260814-001",
      scope: "missing" as const,
      status: "waiting_for_input" as const
    };
    const requestedLocalExecutions: unknown[] = [];
    let jobCounter = 0;
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
        requestedLocalExecutions.push((body as RequestJobRequest).localExecution);
        jobCounter += 1;
        const ids = [
          "11111111-1111-4111-8111-111111111111",
          "55555555-5555-4555-8555-555555555555",
          "88888888-8888-4888-8888-888888888888"
        ];
        return Promise.resolve({
          ...job,
          id: ids[jobCounter - 1],
          task: null
        });
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
              stages: [],
              workflowId: "mock",
              workflowVersion: "1.0.0"
            })
          );
        }

        if (path.startsWith("/jobs/")) {
          return Promise.resolve(schema.parse(task));
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => postMock(path, body).then((payload) => schema.parse(payload))
    };
    const outputCallbacks = new Set<(event: TaskOutputEvent) => void>();
    const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
    let startCounter = 0;
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
        startCounter += 1;
        const taskId =
          startCounter === 1
            ? "66666666-6666-4666-8666-666666666666"
            : startCounter === 2
              ? "77777777-7777-4777-8777-777777777777"
              : "99999999-9999-4999-8999-999999999999";
        const output =
          startCounter === 1
            ? '{"ok":true,"check_factory":{"created":false,"path":"x"},"read_config":{"version":"unknown","mode":"unknown","locale":"tr-TR"}}\n'
            : startCounter === 2
              ? '{"ok":true,"decision":"new","run_id":"ForgePilot-20260814-001"}\n'
              : '{"ok":true,"status":"waiting_for_input","scope":"missing","baseline":"missing","run_id":"ForgePilot-20260814-001"}\n';
        setTimeout(() => {
          for (const callback of outputCallbacks) {
            callback({
              chunk: {
                stream: "stdout",
                text: output,
                timestamp: "2026-08-14T00:00:01.000Z"
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId
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
              taskId
            });
          }
        }, 0);

        return Promise.resolve({
          handle: {
            id: taskId,
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
      runPlaceInputsJob: vi.fn(() => Promise.resolve(placeInputsResult)),
      runSelectRunJob: vi.fn(() => Promise.resolve(selectRunResult)),
      runStartupJob: vi.fn(() => Promise.resolve(startupResult)),
      taskExecutionService: taskService
    });

    const response = await service.runOnce({
      model: "sonnet",
      newRun: false,
      project: projectFixture,
      providerId: PROVIDER_IDS.claudeCode,
      serverUrl: "http://localhost:4317",
      stageId: "010-startup",
      timeoutMs: 1_000
    });

    expect(taskService.start).toHaveBeenCalledTimes(3);
    expect(requestedLocalExecutions).toEqual([
      startupResult,
      {
        select_run: selectRunResult
      },
      {
        place_inputs: placeInputsResult
      }
    ]);
    expect(response.result.outputChunks.at(-1)?.text).toContain('"waiting_for_input"');
  });

  it("requests the remaining startup jobs after place_inputs verification is ready", async () => {
    const startupResult = {
      check_factory: {
        created: false,
        path: "C:\\Github\\ForgePilot\\.ai-factory"
      },
      read_config: {
        locale: "tr-TR",
        mode: "unknown",
        version: "unknown"
      }
    };
    const selectRunResult = {
      decision: "continue" as const,
      run_id: "ForgePilot-20260814-001"
    };
    const placeInputsResult = {
      baseline: "placed" as const,
      run_id: "ForgePilot-20260814-001",
      scope: "placed" as const,
      status: "ready" as const
    };
    const captureGitStateResult = {
      has_git: false,
      run_id: "ForgePilot-20260814-001"
    };
    const sourceManifestResult = {
      file_count: 2,
      run_id: "ForgePilot-20260814-001"
    };
    const factoryManifestResult = {
      file_count: 1,
      run_id: "ForgePilot-20260814-001"
    };
    const sealRunResult = {
      decision: "PASS" as const,
      missing: [],
      pre_run_manifest_sha256: "abc123",
      run_id: "ForgePilot-20260814-001"
    };
    const requestedLocalExecutions: unknown[] = [];
    let jobCounter = 0;
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
        requestedLocalExecutions.push((body as RequestJobRequest).localExecution);
        jobCounter += 1;
        return Promise.resolve({
          ...job,
          id:
            [
              "11111111-1111-4111-8111-111111111111",
              "55555555-5555-4555-8555-555555555555",
              "88888888-8888-4888-8888-888888888888",
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
            ][jobCounter - 1] ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          task: null
        });
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
              stages: [],
              workflowId: "mock",
              workflowVersion: "1.0.0"
            })
          );
        }

        if (path.startsWith("/jobs/")) {
          return Promise.resolve(schema.parse(task));
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => postMock(path, body).then((payload) => schema.parse(payload))
    };
    const outputCallbacks = new Set<(event: TaskOutputEvent) => void>();
    const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
    let startCounter = 0;
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
        startCounter += 1;
        const taskIds = [
          "66666666-6666-4666-8666-666666666666",
          "77777777-7777-4777-8777-777777777777",
          "99999999-9999-4999-8999-999999999999",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        ];
        const outputs = [
          '{"ok":true,"check_factory":{"created":false,"path":"x"},"read_config":{"version":"unknown","mode":"unknown","locale":"tr-TR"}}\n',
          '{"ok":true,"decision":"continue","run_id":"ForgePilot-20260814-001"}\n',
          '{"ok":true,"status":"ready","scope":"placed","baseline":"placed","run_id":"ForgePilot-20260814-001"}\n',
          '{"ok":true,"has_git":false,"run_id":"ForgePilot-20260814-001"}\n',
          '{"ok":true,"file_count":2,"run_id":"ForgePilot-20260814-001"}\n',
          '{"ok":true,"file_count":1,"run_id":"ForgePilot-20260814-001"}\n',
          '{"ok":true,"decision":"PASS","missing":[],"pre_run_manifest_sha256":"abc123","run_id":"ForgePilot-20260814-001"}\n'
        ];
        const taskId = taskIds[startCounter - 1] ?? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const output =
          outputs[startCounter - 1] ??
          '{"ok":true,"has_git":false,"run_id":"ForgePilot-20260814-001"}\n';
        setTimeout(() => {
          for (const callback of outputCallbacks) {
            callback({
              chunk: {
                stream: "stdout",
                text: output,
                timestamp: "2026-08-14T00:00:01.000Z"
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId
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
              taskId
            });
          }
        }, 0);

        return Promise.resolve({
          handle: {
            id: taskId,
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
      runBuildFactoryManifestJob: vi.fn(() => Promise.resolve(factoryManifestResult)),
      runBuildSourceManifestJob: vi.fn(() => Promise.resolve(sourceManifestResult)),
      runCaptureGitStateJob: vi.fn(() => Promise.resolve(captureGitStateResult)),
      runPlaceInputsJob: vi.fn(() => Promise.resolve(placeInputsResult)),
      runSealRunJob: vi.fn(() => Promise.resolve(sealRunResult)),
      runSelectRunJob: vi.fn(() => Promise.resolve(selectRunResult)),
      runStartupJob: vi.fn(() => Promise.resolve(startupResult)),
      taskExecutionService: taskService
    });

    const response = await service.runOnce({
      model: "sonnet",
      newRun: false,
      project: projectFixture,
      providerId: PROVIDER_IDS.claudeCode,
      serverUrl: "http://localhost:4317",
      stageId: "010-startup",
      timeoutMs: 1_000
    });

    expect(taskService.start).toHaveBeenCalledTimes(7);
    expect(requestedLocalExecutions).toEqual([
      startupResult,
      {
        select_run: selectRunResult
      },
      {
        place_inputs: placeInputsResult
      },
      {
        capture_git_state: captureGitStateResult
      },
      {
        build_source_manifest: sourceManifestResult
      },
      {
        build_factory_manifest: factoryManifestResult
      },
      {
        seal_run: sealRunResult
      }
    ]);
    expect(response.result.outputChunks.at(-1)?.text).toContain('"decision":"PASS"');
  });

  describe("020-discovery", () => {
    const scanProjectResult = {
      directory_count: 3,
      file_count: 10
    };
    const classifyFilesResult = {
      file_count: 10,
      unknown_count: 1
    };

    const buildClient = (
      postMock: (path: string, body: unknown) => Promise<unknown>
    ): HttpClient => ({
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

        if (path.startsWith("/jobs/")) {
          return Promise.resolve(schema.parse(task));
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => postMock(path, body).then((payload) => schema.parse(payload))
    });

    const preparationResult = {
      candidateDocuments: [],
      documentIndexEntries: [],
      documentStructureEntries: [],
      missingDocuments: [],
      preparedDocuments: [],
      references: [],
      standardDocumentsInventory: {}
    };
    const mapDependenciesResult = {
      package_count: 2,
      technology_count: 1
    };
    const indexDocumentsResult = {
      document_count: 1,
      glossary_term_count: 0,
      missing_document_count: 0,
      reference_count: 0
    };

    it("runs Job 1-3 through to the index_documents+map_dependencies verification when everything passes", async () => {
      const requestedLocalExecutions: unknown[] = [];
      const jobIds = [
        "11111111-1111-4111-8111-111111111111",
        "55555555-5555-4555-8555-555555555555",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333"
      ];
      let jobCounter = 0;
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
          requestedLocalExecutions.push((body as RequestJobRequest).localExecution);
          jobCounter += 1;
          return Promise.resolve({
            ...job,
            id: jobIds[jobCounter - 1] ?? jobIds.at(-1),
            task: null
          });
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
      const client = buildClient(postMock);
      const outputCallbacks = new Set<(event: TaskOutputEvent) => void>();
      const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
      const taskIds = [
        "66666666-6666-4666-8666-666666666666",
        "77777777-7777-4777-8777-777777777777",
        "88888888-8888-4888-8888-888888888888",
        "99999999-9999-4999-8999-999999999999"
      ];
      const taskOutputs = [
        '{"ok":true,"job":"scan_project","verified_rules":["RULE-D01"]}\n',
        '{"ok":true,"job":"classify_files","verified_rules":["RULE-D02"]}\n',
        '{"candidates":[]}\n',
        '{"ok":true,"job":"index_documents_and_map_dependencies","verified_rules":["RULE-D03","RULE-D09"]}\n'
      ];
      let startCounter = 0;
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
          const taskId = taskIds[startCounter] ?? taskIds.at(-1) ?? "";
          const output = taskOutputs[startCounter] ?? taskOutputs.at(-1) ?? "";
          startCounter += 1;
          setTimeout(() => {
            for (const callback of outputCallbacks) {
              callback({
                chunk: {
                  stream: "stdout",
                  text: output,
                  timestamp: "2026-08-14T00:00:01.000Z"
                },
                providerId: PROVIDER_IDS.claudeCode,
                taskId
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
                taskId
              });
            }
          }, 0);

          return Promise.resolve({
            handle: {
              id: taskId,
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
        finalizeIndexDocumentsJob: vi.fn(() => Promise.resolve(indexDocumentsResult)),
        prepareIndexDocumentsJob: vi.fn(() => Promise.resolve(preparationResult)),
        runClassifyFilesJob: vi.fn(() => Promise.resolve(classifyFilesResult)),
        runMapDependenciesJob: vi.fn(() => Promise.resolve(mapDependenciesResult)),
        runScanProjectJob: vi.fn(() => Promise.resolve(scanProjectResult)),
        taskExecutionService: taskService
      });

      const response = await service.runOnce({
        model: "sonnet",
        newRun: false,
        project: projectFixture,
        providerId: PROVIDER_IDS.claudeCode,
        serverUrl: "http://localhost:4317",
        stageId: "020-discovery",
        timeoutMs: 1_000
      });

      expect(taskService.start).toHaveBeenCalledTimes(4);
      expect(requestedLocalExecutions).toEqual([
        { scan_project: scanProjectResult },
        { classify_files: classifyFilesResult },
        { index_documents_candidates: preparationResult.candidateDocuments },
        { index_documents: indexDocumentsResult, map_dependencies: mapDependenciesResult }
      ]);
      expect(response.result.outputChunks.at(-1)?.text).toContain(
        '"job":"index_documents_and_map_dependencies"'
      );
    });

    it("stops before classify_files when scan_project verification fails", async () => {
      const postMock = vi.fn((path: string): Promise<unknown> => {
        if (path === "/session/handshake") {
          return Promise.resolve({
            message: "ok",
            protocolVersion: "1",
            serverVersion: "mock-0.1.0",
            status: "ok"
          } satisfies HandshakeResponse);
        }

        if (path === "/jobs/request") {
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
      const client = buildClient(postMock);
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
                  text: '{"ok":false,"job":"scan_project","failed_at":"RULE-D01","violation":"x","detail":"y"}\n',
                  timestamp: "2026-08-14T00:00:01.000Z"
                },
                providerId: PROVIDER_IDS.claudeCode,
                taskId: "66666666-6666-4666-8666-666666666666"
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
                taskId: "66666666-6666-4666-8666-666666666666"
              });
            }
          }, 0);

          return Promise.resolve({
            handle: {
              id: "66666666-6666-4666-8666-666666666666",
              processId: 123,
              providerId: PROVIDER_IDS.claudeCode
            },
            startedAt: "2026-08-14T00:00:01.000Z"
          });
        }),
        stop: vi.fn(() => true)
      };
      const classifyFilesMock = vi.fn(() => Promise.resolve(classifyFilesResult));
      const service = createJobService({
        createClient: () => client,
        runClassifyFilesJob: classifyFilesMock,
        runScanProjectJob: vi.fn(() => Promise.resolve(scanProjectResult)),
        taskExecutionService: taskService
      });

      const response = await service.runOnce({
        model: "sonnet",
        newRun: false,
        project: projectFixture,
        providerId: PROVIDER_IDS.claudeCode,
        serverUrl: "http://localhost:4317",
        stageId: "020-discovery",
        timeoutMs: 1_000
      });

      expect(classifyFilesMock).not.toHaveBeenCalled();
      expect(taskService.start).toHaveBeenCalledTimes(1);
      expect(response.result.outputChunks.at(-1)?.text).toContain('"ok":false');
    });
  });
});
