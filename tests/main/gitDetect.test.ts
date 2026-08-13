import { detectGit } from "@main/environment/gitDetect";
import type { CommandRunner } from "@main/process/commandRunner";

describe("gitDetect", () => {
  it("reports missing git without throwing", async () => {
    const runner: CommandRunner = {
      findExecutable: () => Promise.resolve(null),
      run: () => Promise.resolve({ exitCode: 1, stderr: "", stdout: "" })
    };

    await expect(detectGit(runner)).resolves.toEqual({
      installed: false,
      rawOutput: null,
      version: null
    });
  });

  it("parses git version output", async () => {
    const runner: CommandRunner = {
      findExecutable: () => Promise.resolve("C:/Program Files/Git/bin/git.exe"),
      run: () =>
        Promise.resolve({ exitCode: 0, stderr: "", stdout: "git version 2.51.0.windows.1\n" })
    };

    await expect(detectGit(runner)).resolves.toEqual({
      installed: true,
      rawOutput: "git version 2.51.0.windows.1",
      version: "2.51.0"
    });
  });
});
