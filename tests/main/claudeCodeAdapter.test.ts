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
    expect(command.args).toContain("stream-json");
    expect(command.args).not.toContain("--json-schema");
    expect(command.input).toBe("Return JSON");
  });

  it("grants the Write tool when stageOutputFile metadata is present", async () => {
    const adapter = createClaudeCodeAdapter();
    const command = await adapter.createExecutionCommand({
      instructions: {
        body: "Return JSON",
        format: "plain-text",
        metadata: { stageOutputFile: ".ai-factory/.forgepilot/stage-output/D15-Database.json" }
      },
      mode: "provider",
      model: "sonnet",
      outputJsonSchema: null,
      projectRootPath: process.cwd(),
      providerId: PROVIDER_IDS.claudeCode,
      timeoutMs: 1000
    });

    const allowedIndex = command.args.indexOf("--allowedTools");
    const disallowedIndex = command.args.indexOf("--disallowedTools");
    // Bare Write, not a path-scoped rule: Write(<path>) patterns are never
    // matched by the Windows CLI, so a scoped rule would deny every write.
    expect(command.args[allowedIndex + 1]).toBe("Read,Glob,Grep,Write");
    // Deny rules win over allow rules, so the blanket Write deny must be gone.
    expect(command.args[disallowedIndex + 1]).toBe("Edit,Bash,PowerShell,Agent");
  });

  it("keeps the blanket Write deny without stageOutputFile metadata", async () => {
    const adapter = createClaudeCodeAdapter();
    const command = await adapter.createExecutionCommand({
      instructions: {
        body: "Return JSON",
        format: "plain-text",
        metadata: {}
      },
      mode: "provider",
      model: "sonnet",
      outputJsonSchema: null,
      projectRootPath: process.cwd(),
      providerId: PROVIDER_IDS.claudeCode,
      timeoutMs: 1000
    });

    const allowedIndex = command.args.indexOf("--allowedTools");
    const disallowedIndex = command.args.indexOf("--disallowedTools");
    expect(command.args[allowedIndex + 1]).toBe("Read,Glob,Grep");
    expect(command.args[disallowedIndex + 1]).toBe("Edit,Write,Bash,PowerShell,Agent");
  });

  it("ignores stageOutputFile when the task forbids repository tools", async () => {
    const adapter = createClaudeCodeAdapter();
    const command = await adapter.createExecutionCommand({
      instructions: {
        body: "Return JSON",
        format: "plain-text",
        metadata: {
          stageOutputFile: ".ai-factory/.forgepilot/stage-output/D15-Database.json",
          toolPolicy: "no-repository-tools"
        }
      },
      mode: "provider",
      model: "sonnet",
      outputJsonSchema: null,
      projectRootPath: process.cwd(),
      providerId: PROVIDER_IDS.claudeCode,
      timeoutMs: 1000
    });

    expect(command.args).not.toContain("--allowedTools");
    const disallowedIndex = command.args.indexOf("--disallowedTools");
    expect(command.args[disallowedIndex + 1]).toBe(
      "Read,Glob,Grep,Edit,Write,Bash,PowerShell,Agent"
    );
  });
});
