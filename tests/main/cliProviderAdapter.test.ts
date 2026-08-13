import type { CommandRunner } from "@main/process/commandRunner";
import { CliProviderAdapter } from "@main/providers/cliProviderAdapter";
import { PROVIDER_IDS } from "@shared/constants/providerIds";

const createAdapter = (runner: CommandRunner): CliProviderAdapter =>
  new CliProviderAdapter({
    command: "codex",
    id: PROVIDER_IDS.codex,
    label: "Codex",
    runner,
    versionArgs: ["--version"]
  });

describe("CliProviderAdapter", () => {
  it("reports not installed when executable lookup fails", async () => {
    const runner: CommandRunner = {
      findExecutable: () => Promise.resolve(null),
      run: () => Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
    };

    await expect(createAdapter(runner).detect()).resolves.toEqual({
      errorMessage: null,
      id: PROVIDER_IDS.codex,
      installed: false,
      label: "Codex",
      status: "not-installed",
      version: null
    });
  });

  it("extracts version output from installed providers", async () => {
    const runner: CommandRunner = {
      findExecutable: () => Promise.resolve("C:/Tools/codex.cmd"),
      run: () => Promise.resolve({ exitCode: 0, stderr: "", stdout: "codex 1.2.3\n" })
    };
    const result = await createAdapter(runner).detect();

    expect(result.installed).toBe(true);
    expect(result.status).toBe("installed");
    expect(result.version).toEqual({
      providerId: PROVIDER_IDS.codex,
      rawOutput: "codex 1.2.3",
      version: "1.2.3"
    });
  });
});
