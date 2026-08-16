import { type ReactElement, useEffect } from "react";

import { ProviderPanel } from "@renderer/components/ProviderPanel";
import { useJobStore } from "@renderer/stores/jobStore";
import { useProviderStore } from "@renderer/stores/providerStore";
import { useSettingsStore } from "@renderer/stores/settingsStore";
import { PROVIDER_IDS } from "@shared/constants/providerIds";
import { PROVIDER_MODEL_PRESETS } from "@shared/constants/providerModels";
import type { ProviderId } from "@shared/schemas/provider";

const PROVIDER_OPTIONS = [
  { id: PROVIDER_IDS.claudeCode, label: "Claude Code" },
  { id: PROVIDER_IDS.codex, label: "Codex" }
] as const;

export const SettingsPage = (): ReactElement => {
  const providers = useProviderStore((state) => state.providers);
  const refreshProviders = useProviderStore((state) => state.refreshProviders);
  const cloudMessage = useJobStore((state) => state.cloudMessage);
  const checkCloud = useJobStore((state) => state.checkCloud);
  const errorMessage = useSettingsStore((state) => state.errorMessage);
  const isLoading = useSettingsStore((state) => state.isLoading);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const settings = useSettingsStore((state) => state.settings);
  const activeProviderId = settings.activeProviderId ?? PROVIDER_IDS.claudeCode;
  const activeProvider =
    providers.find((provider) => provider.id === activeProviderId) ??
    providers.find((provider) => provider.installed) ??
    null;
  const activeModel = activeProvider ? settings.providerModels[activeProvider.id] : null;
  const cloudConnected = cloudMessage.toLowerCase().includes("connected");

  useEffect(() => {
    void loadSettings();
    void refreshProviders();
    void checkCloud();
  }, [checkCloud, loadSettings, refreshProviders]);

  const updateProvider = (providerId: ProviderId): void => {
    void saveSettings({
      ...settings,
      activeProviderId: providerId
    });
  };

  const updateModel = (providerId: ProviderId, model: string): void => {
    void saveSettings({
      ...settings,
      providerModels: {
        ...settings.providerModels,
        [providerId]: model
      }
    });
  };

  return (
    <div className="settings-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1 id="workspace-title">Settings</h1>
        </div>
      </header>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <section className="settings-section" aria-labelledby="runtime-settings-title">
        <h2 id="runtime-settings-title">Runtime status</h2>
        <dl className="settings-status-grid">
          <div className={cloudConnected ? "summary-card-connected" : "summary-card-warning"}>
            <dt>Cloud</dt>
            <dd>{cloudMessage}</dd>
          </div>
          <div className={activeProvider ? "summary-card-connected" : "summary-card-warning"}>
            <dt>Provider</dt>
            <dd>{activeProvider?.label ?? "Not selected"}</dd>
          </div>
          <div className={activeModel ? "summary-card-connected" : "summary-card-warning"}>
            <dt>Model</dt>
            <dd>{activeModel ?? "No model selected"}</dd>
          </div>
        </dl>
      </section>

      <section className="settings-section" aria-labelledby="provider-settings-title">
        <h2 id="provider-settings-title">Provider</h2>
        <div className="settings-grid">
          <label>
            Active provider
            <select
              value={activeProviderId}
              disabled={isLoading}
              onChange={(event) => updateProvider(event.target.value as ProviderId)}
            >
              {PROVIDER_OPTIONS.map((provider) => {
                const detectedProvider = providers.find((item) => item.id === provider.id);
                return (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                    {detectedProvider?.installed ? "" : " (not installed)"}
                  </option>
                );
              })}
            </select>
          </label>

          {PROVIDER_OPTIONS.map((provider) => (
            <label key={provider.id}>
              {provider.label} model
              <input
                list={`${provider.id}-models`}
                value={settings.providerModels[provider.id]}
                disabled={isLoading}
                onChange={(event) => updateModel(provider.id, event.target.value)}
              />
              <datalist id={`${provider.id}-models`}>
                {PROVIDER_MODEL_PRESETS[provider.id].map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>
          ))}
        </div>
      </section>

      <ProviderPanel />
    </div>
  );
};
