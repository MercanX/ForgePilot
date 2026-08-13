import { vi } from "vitest";

import type { ProjectRepository } from "@services/projects/projectRepository";
import { IPC_CHANNELS } from "@shared/constants/channels";

const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
let dialogResult: { canceled: boolean; filePaths: string[] };

vi.mock("electron", () => ({
  default: {
    app: {
      getPath: () => "C:/ForgePilotUserData"
    },
    dialog: {
      showOpenDialog: vi.fn(() => Promise.resolve(dialogResult))
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

describe("projects IPC", () => {
  beforeEach(() => {
    handlers.clear();
    dialogResult = { canceled: false, filePaths: ["C:/Workspace/sample"] };
  });

  it("registers project handlers and handles dialog cancelation", async () => {
    const { registerProjectsIpc } = await import("@main/ipc/projects");
    const repository: ProjectRepository = {
      add: vi.fn(),
      list: vi.fn(() => Promise.resolve([])),
      open: vi.fn(),
      remove: vi.fn()
    };

    registerProjectsIpc(repository);

    expect(handlers.has(IPC_CHANNELS.projects.list)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.projects.add)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.projects.remove)).toBe(true);
    expect(handlers.has(IPC_CHANNELS.projects.open)).toBe(true);

    dialogResult = { canceled: true, filePaths: [] };
    await expect(handlers.get(IPC_CHANNELS.projects.add)?.({}, {})).resolves.toBeNull();
    expect(repository.add).not.toHaveBeenCalled();
  });
});
