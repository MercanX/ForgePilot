import { create } from "zustand";

import type { ProviderDetectionResult } from "@shared/schemas/provider";

type ProviderStoreState = {
  errorMessage: string | null;
  isLoading: boolean;
  providers: ProviderDetectionResult[];
  refreshProviders: () => Promise<void>;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Provider detection failed.";

export const useProviderStore = create<ProviderStoreState>((set) => ({
  errorMessage: null,
  isLoading: false,
  providers: [],

  refreshProviders: async () => {
    set({ errorMessage: null, isLoading: true });

    try {
      const providers = await window.forgepilot.providers.refresh();
      set({ isLoading: false, providers });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false });
    }
  }
}));
