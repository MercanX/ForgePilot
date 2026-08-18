import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

/**
 * Scope the Write permission to the stage-output directory only. Granting the
 * directory (not the single file) tolerates path-normalization differences
 * between Windows and the CLI's gitignore-style rule matching.
 */
const stageOutputWriteRule = (stageOutputFile: string): string => {
  const directorySegments = stageOutputFile.split("/").slice(0, -1);
  return directorySegments.length > 0
    ? `Write(${directorySegments.join("/")}/**)`
    : `Write(${stageOutputFile})`;
};

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => {
      const noRepositoryTools =
        request.instructions.metadata.toolPolicy === "no-repository-tools";
      const stageOutputFile =
        !noRepositoryTools && typeof request.instructions.metadata.stageOutputFile === "string"
          ? request.instructions.metadata.stageOutputFile
          : null;

      const allowedTools = stageOutputFile
        ? `Read,Glob,Grep,${stageOutputWriteRule(stageOutputFile)}`
        : "Read,Glob,Grep";
      // Deny rules win over allow rules, so `Write` must leave the disallow
      // list whenever the scoped stage-output Write rule is active. Any Write
      // outside the allowed pattern is still auto-denied in non-interactive -p.
      const disallowedTools = noRepositoryTools
        ? "Read,Glob,Grep,Edit,Write,Bash,PowerShell,Agent"
        : stageOutputFile
          ? "Edit,Bash,PowerShell,Agent"
          : "Edit,Write,Bash,PowerShell,Agent";

      return [
        "-p",
        "--no-session-persistence",
        "--permission-mode",
        "default",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(noRepositoryTools ? [] : ["--allowedTools", allowedTools]),
        "--disallowedTools",
        disallowedTools,
        ...(request.model ? ["--model", request.model] : [])
      ];
    },
    command: "claude",
    id: PROVIDER_IDS.claudeCode,
    label: "Claude Code",
    versionArgs: ["--version"]
  });
