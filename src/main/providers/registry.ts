import type { ProviderDetectionResult, ProviderId } from "@shared/schemas/provider";
import type { ProviderAdapter } from "@shared/types/provider-adapter";

import { createClaudeCodeAdapter } from "./claudeCodeAdapter";
import { createCodexAdapter } from "./codexAdapter";

type DetectableProviderAdapter = ProviderAdapter & {
  detect(): Promise<ProviderDetectionResult>;
};

export type ProviderRegistry = {
  detect(providerId: ProviderId): Promise<ProviderDetectionResult>;
  get(providerId: ProviderId): DetectableProviderAdapter;
  list(): Promise<ProviderDetectionResult[]>;
  refresh(): Promise<ProviderDetectionResult[]>;
};

export const createProviderRegistry = (
  adapters: DetectableProviderAdapter[] = [createClaudeCodeAdapter(), createCodexAdapter()]
): ProviderRegistry => {
  const adaptersById = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  const list = async (): Promise<ProviderDetectionResult[]> =>
    Promise.all(adapters.map((adapter) => adapter.detect()));

  const get = (providerId: ProviderId): DetectableProviderAdapter => {
    const adapter = adaptersById.get(providerId);

    if (!adapter) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return adapter;
  };

  const detect = async (providerId: ProviderId): Promise<ProviderDetectionResult> =>
    get(providerId).detect();

  return {
    detect,
    get,
    list,
    refresh: list
  };
};
