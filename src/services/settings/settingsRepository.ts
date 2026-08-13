import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { DEFAULT_PROVIDER_MODELS } from "@shared/constants/providerModels";
import { type AppSettings, appSettingsSchema } from "@shared/schemas/settings";

export type SettingsRepository = {
  get: () => Promise<AppSettings>;
  save: (settings: AppSettings) => Promise<AppSettings>;
};

const DEFAULT_SETTINGS: AppSettings = {
  activeProviderId: null,
  providerModels: {
    ...DEFAULT_PROVIDER_MODELS
  }
};

export const createSettingsRepository = (userDataPath: string): SettingsRepository => {
  const storagePath = join(userDataPath, "settings.json");

  const get = async (): Promise<AppSettings> => {
    try {
      const rawContent = await readFile(storagePath, "utf8");
      return appSettingsSchema.parse({ ...DEFAULT_SETTINGS, ...JSON.parse(rawContent) });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return DEFAULT_SETTINGS;
      }

      throw error;
    }
  };

  const save = async (settings: AppSettings): Promise<AppSettings> => {
    const parsedSettings = appSettingsSchema.parse(settings);
    await mkdir(dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(parsedSettings, null, 2)}\n`, "utf8");
    await rename(tempPath, storagePath);
    return parsedSettings;
  };

  return {
    get,
    save
  };
};
