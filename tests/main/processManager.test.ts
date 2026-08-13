import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createProcessManager } from "@main/process/processManager";
import { PROVIDER_IDS } from "@shared/constants/providerIds";

describe("processManager", () => {
  it("runs a child process inside the project root and emits output and exit", async () => {
    const projectRoot = join(
      process.cwd(),
      "node_modules",
      ".tmp-process-manager",
      crypto.randomUUID()
    );
    await mkdir(projectRoot, { recursive: true });
    const manager = createProcessManager();
    const managedProcess = await manager.start({
      args: ["-e", "process.stdout.write(process.cwd())"],
      command: process.execPath,
      providerId: PROVIDER_IDS.codex,
      rootPath: projectRoot,
      timeoutMs: 5_000
    });

    const output = await new Promise<string>((resolve) => {
      managedProcess.onOutput((chunk) => resolve(chunk.text));
    });
    const exitInfo = await new Promise<{ exitCode: number | null }>((resolve) => {
      managedProcess.onExit(resolve);
    });

    expect(output).toBe(projectRoot);
    expect(exitInfo.exitCode).toBe(0);
    manager.dispose();
  });
});
