import { vi } from "vitest";

import type { ProviderRegistry } from "@main/providers/registry";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

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

const providerResult: ProviderDetectionResult = {
  errorMessage: null,
  id: PROVIDER_IDS.codex,
  installed: false,
  label: "Codex",
  status: "not-installed",
  version: null
};

describe("providers IPC", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("registers provider handlers", async () => {
    const { registerProvidersIpc } = await import("@main/ipc/providers");
    const registry: ProviderRegistry = {
      detect: vi.fn(() => Promise.resolve(providerResult)),
      list: vi.fn(() => Promise.resolve([providerResult])),
      refresh: vi.fn(() => Promise.resolve([providerResult]))
    };

    registerProvidersIpc(registry);

    expect(handlers.has(IPC_CHANNELS.providers.list)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.providers.detect)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.providers.refresh)).toBe(true);
    await expect(
      handlers.get(IPC_CHANNELS.providers.detect)?.({}, { providerId: PROVIDER_IDS.codex })
    ).resolves.toEqual(providerResult);
  });
});
