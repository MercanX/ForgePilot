import { createCommandRunner, selectExecutableCandidate } from "@main/process/commandRunner";

describe("commandRunner", () => {
  it("returns exit code zero for successful commands", async () => {
    const runner = createCommandRunner();
    const result = await runner.run(process.execPath, ["--version"], 5_000);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+\.\d+\.\d+/);
  });

  it("prefers real Windows executables over package-manager shims", () => {
    const selected = selectExecutableCandidate(
      [
        "C:\\Users\\User\\AppData\\Roaming\\npm\\codex",
        "C:\\Users\\User\\AppData\\Roaming\\npm\\codex.cmd",
        "C:\\Users\\User\\.vscode\\extensions\\openai.chatgpt\\bin\\codex.exe"
      ],
      "win32"
    );

    expect(selected).toBe("C:\\Users\\User\\.vscode\\extensions\\openai.chatgpt\\bin\\codex.exe");
  });
});
