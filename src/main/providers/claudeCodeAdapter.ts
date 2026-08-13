import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createClaudeCodeAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    command: "claude",
    id: PROVIDER_IDS.claudeCode,
    label: "Claude Code",
    versionArgs: ["--version"]
  });
