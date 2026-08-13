import { z } from "zod";

import { PROVIDER_IDS } from "@shared/constants/providerIds";
import { DEFAULT_PROVIDER_MODELS } from "@shared/constants/providerModels";

import { providerIdSchema } from "./provider";

export const providerModelSettingsSchema = z
  .object({
    [PROVIDER_IDS.claudeCode]: z
      .string()
      .min(1)
      .default(DEFAULT_PROVIDER_MODELS[PROVIDER_IDS.claudeCode]),
    [PROVIDER_IDS.codex]: z.string().min(1).default(DEFAULT_PROVIDER_MODELS[PROVIDER_IDS.codex])
  })
  .strict();

export const appSettingsSchema = z
  .object({
    activeProviderId: providerIdSchema.nullable().default(null),
    providerModels: providerModelSettingsSchema.default(DEFAULT_PROVIDER_MODELS)
  })
  .strict();

export const settingsSaveRequestSchema = appSettingsSchema;

export type AppSettings = z.infer<typeof appSettingsSchema>;
export type ProviderModelSettings = z.infer<typeof providerModelSettingsSchema>;
export type SettingsSaveRequest = z.infer<typeof settingsSaveRequestSchema>;
