import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => {
      const noRepositoryTools =
        request.instructions.metadata.toolPolicy === "no-repository-tools";

      return [
        "-p",
        "--no-session-persistence",
        "--permission-mode",
        "default",
        "--output-format",
        "stream-json",
        "--verbose",
        ...(noRepositoryTools ? [] : ["--allowedTools", "Read,Glob,Grep"]),
        "--disallowedTools",
        noRepositoryTools
          ? "Read,Glob,Grep,Edit,Write,Bash,PowerShell,Agent"
          : "Edit,Write,Bash,PowerShell,Agent",
        ...(request.model ? ["--model", request.model] : [])
      ];
    },
    command: "claude",
    id: PROVIDER_IDS.claudeCode,
    label: "Claude Code",
    versionArgs: ["--version"]
  });
