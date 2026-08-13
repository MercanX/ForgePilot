import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { createSettingsRepository } from "@services/settings/settingsRepository";
import { PROVIDER_IDS } from "@shared/constants/providerIds";

describe("settingsRepository", () => {
  it("persists active provider and model preferences", async () => {
    const userDataPath = join(process.cwd(), "node_modules", ".tmp-settings", crypto.randomUUID());
    await mkdir(userDataPath, { recursive: true });
    const repository = createSettingsRepository(userDataPath);

    const savedSettings = await repository.save({
      activeProviderId: PROVIDER_IDS.codex,
      providerModels: {
        [PROVIDER_IDS.claudeCode]: "sonnet",
        [PROVIDER_IDS.codex]: "gpt-5"
      }
    });

    expect(savedSettings.activeProviderId).toBe(PROVIDER_IDS.codex);
    await expect(createSettingsRepository(userDataPath).get()).resolves.toEqual(savedSettings);
  });
});
