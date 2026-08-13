import { createCommandRunner, type CommandRunner } from "@main/process/commandRunner";
import { PROVIDER_DETECTION_TIMEOUT_MS } from "@shared/constants/timeouts";

export type GitDetectionResult = {
  installed: boolean;
  rawOutput: string | null;
  version: string | null;
};

export const detectGit = async (
  runner: CommandRunner = createCommandRunner()
): Promise<GitDetectionResult> => {
  const executablePath = await runner.findExecutable("git");

  if (!executablePath) {
    return {
      installed: false,
      rawOutput: null,
      version: null
    };
  }

  const result = await runner.run(executablePath, ["--version"], PROVIDER_DETECTION_TIMEOUT_MS);
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

  return {
    installed: true,
    rawOutput: rawOutput || null,
    version: rawOutput.match(/\d+(?:\.\d+){1,3}/)?.[0] ?? null
  };
};
