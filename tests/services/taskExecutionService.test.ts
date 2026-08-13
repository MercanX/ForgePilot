import type { ProcessManager, ProcessStartOptions } from "@main/process/processManager";
import type { ProviderRegistry } from "@main/providers/registry";
import { createTaskExecutionService } from "@services/tasks/taskExecutionService";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

const providerResult: ProviderDetectionResult = {
  errorMessage: null,
  id: PROVIDER_IDS.codex,
  installed: true,
  label: "Codex",
  status: "installed",
  version: {
    providerId: PROVIDER_IDS.codex,
    rawOutput: "codex-cli 0.125.0",
    version: "0.125.0"
  }
};

describe("taskExecutionService", () => {
  it("starts echo fixture tasks through the process manager", async () => {
    const startMock = vi.fn((options: ProcessStartOptions) => {
      void options;
      return Promise.resolve({
        handle: {
          id: "11111111-1111-4111-8111-111111111111",
          processId: 123,
          providerId: PROVIDER_IDS.codex
        },
        kill: vi.fn(),
        onExit: vi.fn(() => () => undefined),
        onOutput: vi.fn(() => () => undefined),
        stop: vi.fn()
      });
    });
    const processManager: ProcessManager = {
      dispose: vi.fn(),
      get: vi.fn(() => null),
      start: startMock,
      stop: vi.fn(() => true)
    };
    const registry: ProviderRegistry = {
      detect: vi.fn(() => Promise.resolve(providerResult)),
      list: vi.fn(() => Promise.resolve([providerResult])),
      refresh: vi.fn(() => Promise.resolve([providerResult]))
    };
    const service = createTaskExecutionService({
      processManager,
      providerRegistry: registry
    });
    const response = await service.start({
      instructions: {
        body: "hello",
        format: "plain-text",
        metadata: {}
      },
      mode: "echo-fixture",
      projectRootPath: "C:/Github/ForgePilot",
      providerId: PROVIDER_IDS.codex,
      timeoutMs: 1_000
    });

    expect(response.handle.providerId).toBe(PROVIDER_IDS.codex);
    const startOptions = startMock.mock.calls[0]?.[0];
    expect(startOptions?.command).toBe(process.execPath);
    expect(startOptions?.input).toBe("hello");
  });
});
