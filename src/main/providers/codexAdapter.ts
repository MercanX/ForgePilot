import { PROVIDER_IDS } from "@shared/constants/providerIds";

import { CliProviderAdapter } from "./cliProviderAdapter";

export const createCodexAdapter = (): CliProviderAdapter =>
  new CliProviderAdapter({
    command: "codex",
    id: PROVIDER_IDS.codex,
    label: "Codex",
    versionArgs: ["--version"]
  });
