import type { CommandRunner } from "@main/process/commandRunner";
import { createClaudeCodeAdapter } from "@main/providers/claudeCodeAdapter";
import { PROVIDER_IDS } from "@shared/constants/providerIds";

const runner: CommandRunner = {
  findExecutable: vi.fn(() => Promise.resolve("/usr/bin/claude")),
  run: vi.fn(() => Promise.resolve({ exitCode: 0, stderr: "", stdout: "1.0.0" }))
};

vi.mock("@main/process/commandRunner", () => ({
  createCommandRunner: () => runner
}));

describe("createClaudeCodeAdapter", () => {
  it("does not pass unsupported json-schema CLI flags", async () => {
    const adapter = createClaudeCodeAdapter();
    const command = await adapter.createExecutionCommand({
      instructions: {
        body: "Return JSON",
        format: "plain-text",
        metadata: {}
      },
      mode: "provider",
      model: "sonnet",
      outputJsonSchema: {
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
        type: "object"
      },
      projectRootPath: process.cwd(),
      providerId: PROVIDER_IDS.claudeCode,
      timeoutMs: 1000
    });

    expect(command.args).toContain("--output-format");
    expect(command.args).toContain("json");
    expect(command.args).not.toContain("--json-schema");
    expect(command.input).toBe("Return JSON");
  });
});
