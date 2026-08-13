import { create } from "zustand";

import { DEFAULT_PROVIDER_MODELS } from "@shared/constants/providerModels";
import type { AppSettings } from "@shared/schemas/settings";

type SettingsStoreState = {
  errorMessage: string | null;
  isLoading: boolean;
  settings: AppSettings;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
};

const DEFAULT_SETTINGS: AppSettings = {
  activeProviderId: null,
  providerModels: {
    ...DEFAULT_PROVIDER_MODELS
  }
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Settings action failed.";

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  errorMessage: null,
  isLoading: false,
  settings: DEFAULT_SETTINGS,

  loadSettings: async () => {
    set({ errorMessage: null, isLoading: true });

    try {
      const settings = await window.forgepilot.settings.get();
      set({ isLoading: false, settings });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false });
    }
  },

  saveSettings: async (settings) => {
    set({ errorMessage: null, isLoading: true });

    try {
      const savedSettings = await window.forgepilot.settings.save(settings);
      set({ isLoading: false, settings: savedSettings });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false });
    }
  }
}));
