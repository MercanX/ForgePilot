import { PROVIDER_IDS } from "./providerIds";

export const PROVIDER_MODEL_PRESETS = {
  [PROVIDER_IDS.claudeCode]: ["sonnet", "opus", "haiku"],
  [PROVIDER_IDS.codex]: ["gpt-5-codex", "gpt-5", "o3"]
} as const;

export const DEFAULT_PROVIDER_MODELS = {
  [PROVIDER_IDS.claudeCode]: "sonnet",
  [PROVIDER_IDS.codex]: "gpt-5-codex"
} as const;
