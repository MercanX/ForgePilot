import type { CommandRunner } from "@main/process/commandRunner";
import { CliProviderAdapter } from "@main/providers/cliProviderAdapter";

const runner: CommandRunner = {
  findExecutable: async () => "/usr/bin/provider-fixture",
  run: async () => ({ exitCode: 0, stderr: "", stdout: "1.0.0" })
};

describe("provider execution command", () => {
  it("keeps the task body on stdin instead of a temporary prompt file", async () => {
    const adapter = new CliProviderAdapter({
      buildExecutionArgs: () => ["--non-interactive", "-"],
      command: "provider-fixture",
      id: "codex",
      label: "Fixture",
      runner,
      versionArgs: ["--version"]
    });
    const command = await adapter.createExecutionCommand({
      instructions: {
        body: "server-owned instruction body",
        format: "plain-text",
        metadata: {}
      },
      mode: "provider",
      model: null,
      projectRootPath: process.cwd(),
      providerId: "codex",
      timeoutMs: 1000
    });

    expect(command.input).toBe("server-owned instruction body");
    expect(command.args.join(" ")).not.toContain("prompt-");
    expect(command.args.join(" ")).not.toContain(".ai-factory/.tmp");
  });
});
