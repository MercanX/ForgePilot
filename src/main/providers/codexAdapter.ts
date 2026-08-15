import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createCodexAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    buildExecutionArgs: (request) => [
      "exec",
      "--ephemeral",
      "--ask-for-approval",
      "never",
      "--sandbox",
      "read-only",
      "-C",
      request.projectRootPath,
      ...(request.model ? ["--model", request.model] : []),
      "-"
    ],
    command: "codex",
    id: PROVIDER_IDS.codex,
    label: "Codex",
    versionArgs: ["--version"]
  });
