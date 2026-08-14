import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { vi } from "vitest";

import { IPC_CHANNELS } from "@shared/constants/channels";

const handlers = new Map<string, (event: unknown, request: unknown) => Promise<unknown>>();
const openPath = vi.fn(() => Promise.resolve(""));

vi.mock("electron", () => ({
  default: {
    ipcMain: {
      handle: vi.fn(
        (channel: string, handler: (event: unknown, request: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        }
      )
    },
    shell: {
      openPath
    }
  }
}));

describe("startup IPC", () => {
  let tempRoot: string;

  beforeEach(async () => {
    handlers.clear();
    openPath.mockClear();
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "forgepilot-startup-ipc-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("opens a startup input file through the system shell", async () => {
    const { registerStartupIpc } = await import("@main/ipc/startup");
    const runId = "sample-20260814-001";
    const inputFilePath = path.join(tempRoot, ".ai-factory-runs", runId, "SCOPE.md");
    await mkdir(path.dirname(inputFilePath), { recursive: true });
    await writeFile(inputFilePath, "# Scope\n", "utf8");

    registerStartupIpc();

    expect(handlers.has(IPC_CHANNELS.startup.openInputFile)).toBe(true);
    await expect(
      handlers.get(IPC_CHANNELS.startup.openInputFile)?.(
        {},
        {
          fileName: "SCOPE.md",
          projectRootPath: tempRoot,
          runId
        }
      )
    ).resolves.toEqual({
      errorMessage: null,
      opened: true,
      path: inputFilePath
    });
    expect(openPath).toHaveBeenCalledWith(inputFilePath);
  });

  it("rejects files outside the selected project root", async () => {
    const { registerStartupIpc } = await import("@main/ipc/startup");
    registerStartupIpc();

    await expect(
      handlers.get(IPC_CHANNELS.startup.openInputFile)?.(
        {},
        {
          fileName: "SCOPE.md",
          projectRootPath: tempRoot,
          runId: "..\\..\\outside"
        }
      )
    ).rejects.toThrow("Path is outside the selected project root.");
    expect(openPath).not.toHaveBeenCalled();
  });
});
