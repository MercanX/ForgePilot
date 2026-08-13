import { vi } from "vitest";

import type { SettingsRepository } from "@services/settings/settingsRepository";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { AppSettings } from "@shared/schemas/settings";

const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({
  default: {
    app: {
      getPath: () => "C:/ForgePilotUserData"
    },
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }
      )
    }
  }
}));

const settings: AppSettings = {
  activeProviderId: PROVIDER_IDS.codex,
  providerModels: {
    [PROVIDER_IDS.claudeCode]: "sonnet",
    [PROVIDER_IDS.codex]: "gpt-5"
  }
};

describe("settings IPC", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("registers settings handlers", async () => {
    const { registerSettingsIpc } = await import("@main/ipc/settings");
    const repository: SettingsRepository = {
      get: vi.fn(() => Promise.resolve(settings)),
      save: vi.fn((nextSettings) => Promise.resolve(nextSettings))
    };

    registerSettingsIpc(repository);

    expect(handlers.has(IPC_CHANNELS.settings.get)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.settings.save)).toBe(true);
    await expect(handlers.get(IPC_CHANNELS.settings.get)?.({}, {})).resolves.toEqual(settings);
  });
});
