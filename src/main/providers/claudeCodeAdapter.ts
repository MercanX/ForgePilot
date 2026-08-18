import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => {
      const noRepositoryTools =
        request.instructions.metadata.toolPolicy === "no-repository-tools";
      const stageOutputFile =
        !noRepositoryTools && typeof request.instructions.metadata.stageOutputFile === "string"
          ? request.instructions.metadata.stageOutputFile
          : null;

      // Path-scoped rules such as Write(.ai-factory/**) never match on the
      // Windows CLI (verified empirically on Claude Code 2.1.234 with
      // relative, ./-prefixed, //-absolute, drive-absolute, ** and exact-file
      // patterns — every form was denied while bare `Write` was honored), so
      // stage-output delivery grants the unscoped Write tool. Edit/Bash stay
      // denied, the prompt restricts writes to the stage-output file, and the
      // Write tool itself refuses to overwrite files that were not Read first.
      const allowedTools = stageOutputFile ? "Read,Glob,Grep,Write" : "Read,Glob,Grep";
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
