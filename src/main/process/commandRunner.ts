import { execFile } from "node:child_process";

export type CommandResult = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export type CommandRunner = {
  findExecutable(command: string): Promise<string | null>;
  run(command: string, args: string[], timeoutMs: number): Promise<CommandResult>;
};

const normalizeOutput = (value: string | Buffer): string =>
  Buffer.isBuffer(value) ? value.toString("utf8") : value;

export const selectExecutableCandidate = (
  candidates: string[],
  platform: NodeJS.Platform = process.platform
): string | null => {
  const cleanCandidates = candidates.map((candidate) => candidate.trim()).filter(Boolean);

  if (cleanCandidates.length === 0) {
    return null;
  }

  if (platform !== "win32") {
    return cleanCandidates[0] ?? null;
  }

  return (
    cleanCandidates.find((candidate) => candidate.toLowerCase().endsWith(".exe")) ??
    cleanCandidates.find((candidate) => /\.(cmd|bat|ps1)$/i.test(candidate)) ??
    cleanCandidates[0] ??
    null
  );
};

export const createCommandRunner = (): CommandRunner => {
  const run = async (command: string, args: string[], timeoutMs: number): Promise<CommandResult> =>
    new Promise((resolve) => {
      execFile(
        command,
        args,
        {
          shell: false,
          timeout: timeoutMs,
          windowsHide: true
        },
        (error, stdout, stderr) => {
          const exitCode =
            error && "code" in error && typeof error.code === "number" ? error.code : 0;

          resolve({
            exitCode,
            stderr: normalizeOutput(stderr),
            stdout: normalizeOutput(stdout)
          });
        }
      );
    });

  const findExecutable = async (command: string): Promise<string | null> => {
    const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
    const result = await run(lookupCommand, [command], 2_000);

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }

    return selectExecutableCandidate(result.stdout.split(/\r?\n/));
  };

  return {
    findExecutable,
    run
  };
};
