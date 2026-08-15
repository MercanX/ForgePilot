import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      ...(request.model ? ["--model", request.model] : [])
    ],
    command: "claude",
    id: PROVIDER_IDS.claudeCode,
    label: "Claude Code",
    versionArgs: ["--version"]
  });
