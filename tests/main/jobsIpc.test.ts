import { vi } from "vitest";

import type { JobService } from "@services/jobs/jobService";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { JobRunResponse } from "@shared/schemas/cloud-api";

import { projectFixture } from "../shared/fixtures";

const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  default: {
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }
      )
    }
  }
}));

const runResponse: JobRunResponse = {
  job: {
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
  },
  result: {
    exitCode: 0,
    findings: [],
    finishedAt: "2026-08-14T00:00:02.000Z",
    jobId: "11111111-1111-4111-8111-111111111111",
    outputChunks: [],
    providerId: PROVIDER_IDS.claudeCode,
    startedAt: "2026-08-14T00:00:01.000Z",
    status: "completed",
    taskId: "44444444-4444-4444-8444-444444444444"
  },
  submitAccepted: true,
  syncedFindings: []
};

describe("jobs IPC", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("registers cloud status and run handlers", async () => {
    const { registerJobsIpc } = await import("@main/ipc/jobs");
    const service: JobService = {
      fail: vi.fn(() => Promise.resolve({ accepted: true as const })),
      getStatus: vi.fn(() =>
        Promise.resolve({
          connected: true,
          message: "Mock cloud connected",
          serverVersion: "mock-0.1.0"
        })
      ),
      getTask: vi.fn(),
      getWorkflow: vi.fn(),
      requestJob: vi.fn(),
      runOnce: vi.fn(() => Promise.resolve(runResponse)),
      submitResult: vi.fn(),
      syncFindings: vi.fn(() => Promise.resolve({ accepted: true as const }))
    };

    registerJobsIpc(service);

    expect(handlers.has(IPC_CHANNELS.jobs.status)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.jobs.runOnce)).toBe(true);
    const send = vi.fn();
    await expect(
      handlers.get(IPC_CHANNELS.jobs.status)?.({}, { serverUrl: "http://localhost:4317" })
    ).resolves.toEqual({
      connected: true,
      message: "Mock cloud connected",
      serverVersion: "mock-0.1.0"
    });
    await expect(
      handlers.get(IPC_CHANNELS.jobs.runOnce)?.(
        { sender: { send } },
        {
          model: "sonnet",
          project: projectFixture,
          providerId: PROVIDER_IDS.claudeCode,
          serverUrl: "http://localhost:4317",
          timeoutMs: 1_000
        }
      )
    ).resolves.toEqual(runResponse);
    expect(service.runOnce).toHaveBeenCalledWith(expect.any(Object), expect.any(Function));
  });
});
