import { createProviderRegistry } from "@main/providers/registry";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

const createResult = (id: typeof PROVIDER_IDS.codex): ProviderDetectionResult => ({
  errorMessage: null,
  id,
  installed: true,
  label: "Codex",
  status: "installed",
  version: {
    providerId: id,
    rawOutput: "codex 1.2.3",
    version: "1.2.3"
  }
});

describe("ProviderRegistry", () => {
  it("lists and detects registered providers", async () => {
    const result = createResult(PROVIDER_IDS.codex);
    const adapter = {
      detect: vi.fn(() => Promise.resolve(result)),
      id: PROVIDER_IDS.codex
    };
    const registry = createProviderRegistry([adapter]);

    await expect(registry.list()).resolves.toEqual([result]);
    await expect(registry.detect(PROVIDER_IDS.codex)).resolves.toEqual(result);
  });
});
