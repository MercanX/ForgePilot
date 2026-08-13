import type { ProviderDetectionResult, ProviderId } from "@shared/schemas/provider";

import { createClaudeCodeAdapter } from "./claudeCodeAdapter";
import { createCodexAdapter } from "./codexAdapter";

type DetectableProviderAdapter = {
  readonly id: ProviderId;
  detect(): Promise<ProviderDetectionResult>;
};

export type ProviderRegistry = {
  detect(providerId: ProviderId): Promise<ProviderDetectionResult>;
  list(): Promise<ProviderDetectionResult[]>;
  refresh(): Promise<ProviderDetectionResult[]>;
};

export const createProviderRegistry = (
  adapters: DetectableProviderAdapter[] = [createClaudeCodeAdapter(), createCodexAdapter()]
): ProviderRegistry => {
  const adaptersById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  const list = async (): Promise<ProviderDetectionResult[]> =>
    Promise.all(adapters.map((adapter) => adapter.detect()));

  const detect = async (providerId: ProviderId): Promise<ProviderDetectionResult> => {
    const adapter = adaptersById.get(providerId);

    if (!adapter) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return adapter.detect();
  };

  return {
    detect,
    list,
    refresh: list
  };
};
