import type { HttpClient } from "@services/api/httpClient";
import { createStageExecutionService } from "@services/jobs/stageExecutionService";
import type { TaskExecutionService } from "@services/tasks/taskExecutionService";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { TaskExitEvent, TaskOutputEvent } from "@shared/schemas/job";
import type { Unsubscribe } from "@shared/types/provider-adapter";

import { projectFixture } from "../shared/fixtures";

describe("stageExecutionService provider contracts", () => {
  it("fails semantic provider output that does not match the directive schema", async () => {
    const outputCallbacks = new Set<(event: TaskOutputEvent) => void>();
    const exitCallbacks = new Set<(event: TaskExitEvent) => void>();
    const taskId = "44444444-4444-4444-8444-444444444444";
    const directiveId = "55555555-5555-4555-8555-555555555555";
    const jobId = "11111111-1111-4111-8111-111111111111";
    const runId = "22222222-2222-4222-8222-222222222222";
    let terminalMessage = "";

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
                text: "{}\n",
                timestamp: "2026-08-16T00:00:01.000Z"
              },
              providerId: PROVIDER_IDS.claudeCode,
              taskId
            });
          }
          for (const callback of exitCallbacks) {
            callback({
              exitInfo: {
                exitCode: 0,
                finishedAt: "2026-08-16T00:00:02.000Z",
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
          startedAt: "2026-08-16T00:00:01.000Z"
        });
      }),
      stop: vi.fn(() => true)
    };

    const client: HttpClient = {
      get: (path, schema) => {
        if (path === `/jobs/${jobId}`) {
          return Promise.resolve(
            schema.parse({
              id: "33333333-3333-4333-8333-333333333333",
              instructions: {
                body: "Return scope JSON",
                format: "plain-text",
                metadata: {}
              },
              jobId,
              timeoutMs: 300000
            })
          );
        }

        return Promise.reject(new Error(`Unexpected GET ${path}`));
      },
      post: (path, body, schema) => {
        if (path === "/executions/next" && body && typeof body === "object" && "previous" in body) {
          const previous = body.previous as { message: string | null; status: string } | null;
          if (previous) {
            terminalMessage = previous.message ?? "";
            return Promise.resolve(
              schema.parse({
                directive: {
                  id: "66666666-6666-4666-8666-666666666666",
                  kind: "terminal",
                  message: terminalMessage,
                  outcome: "failed",
                  progress: 46
                },
                executionId: "77777777-7777-4777-8777-777777777777",
                stageId: "010-startup"
              })
            );
          }
        }

        if (path === "/executions/next") {
          return Promise.resolve(
            schema.parse({
              directive: {
                id: directiveId,
                job: {
                  exitCode: null,
                  finishedAt: null,
                  id: jobId,
                  providerId: PROVIDER_IDS.claudeCode,
                  runId,
                  stageId: "010-startup:scope-proposal",
                  startedAt: "2026-08-16T00:00:00.000Z",
                  status: "received",
                  task: null
                },
                kind: "provider",
                messageCompleted: "AI scope proposal completed.",
                messageStarted: "AI is surveying the project and proposing audit scope.",
                mode: "semantic",
                outputSchema: {
                  additionalProperties: false,
                  properties: { summary: { type: "string" } },
                  required: ["summary"],
                  type: "object"
                },
                progressCompleted: 46,
                progressStarted: 28,
                requireOk: false,
                saveAs: "scopeProposal"
              },
              executionId: "77777777-7777-4777-8777-777777777777",
              stageId: "010-startup"
            })
          );
        }

        if (path === `/jobs/${jobId}/result`) {
          return Promise.resolve(schema.parse({ accepted: true, findings: [] }));
        }

        if (path === "/findings/sync" || path.endsWith("/heartbeat")) {
          return Promise.resolve(schema.parse({ accepted: true }));
        }

        return Promise.reject(new Error(`Unexpected POST ${path}`));
      }
    };
    const service = createStageExecutionService({
      createClient: () => client,
      createJournal: () => ({
        clearStage: vi.fn(),
        getExecutionId: vi.fn(() => Promise.resolve(null)),
        getLocalResult: vi.fn(() => Promise.resolve({ found: false, output: null })),
        saveLocalResult: vi.fn(),
        setExecutionId: vi.fn()
      }),
      taskExecutionService: taskService
    });

    const response = await service.run({
      model: "sonnet",
      newRun: true,
      project: projectFixture,
      providerId: PROVIDER_IDS.claudeCode,
      serverUrl: "http://localhost:4317",
      stageId: "010-startup",
      timeoutMs: 1000
    });

    expect(response.stageOutcome.status).toBe("failed");
    expect(terminalMessage).toContain("Provider output failed local contract validation");
    expect(terminalMessage).toContain("$.summary is required.");
  });
});
