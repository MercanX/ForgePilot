import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => [
      "-p",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--output-format",
      "json",
      ...(request.outputJsonSchema
        ? ["--json-schema", JSON.stringify(request.outputJsonSchema)]
        : []),
      ...(request.model ? ["--model", request.model] : [])
    ],
    command: "claude",
    id: PROVIDER_IDS.claudeCode,
    label: "Claude Code",
    versionArgs: ["--version"]
  });
