import { type ReactElement, useEffect } from "react";

import { useProviderStore } from "@renderer/stores/providerStore";
import type { ProviderDetectionResult } from "@shared/schemas/provider";

const statusLabel = (provider: ProviderDetectionResult): string => {
  if (!provider.installed) {
    return "Not installed";
  }

  if (provider.status === "authenticated") {
    return "Authenticated";
  }

  if (provider.status === "error") {
    return "Error";
  }

  return "Installed";
};

const providerDetail = (provider: ProviderDetectionResult): string => {
  if (!provider.installed) {
    return "CLI was not detected on PATH.";
  }

  if (provider.version?.rawOutput) {
    return provider.version.rawOutput;
  }

  return "CLI detected. Version output is unavailable.";
};

const ProviderCard = ({ provider }: { provider: ProviderDetectionResult }): ReactElement => (
  <article className={`provider-card provider-card-${provider.status}`}>
    <div>
      <h3>{provider.label}</h3>
      <p>{providerDetail(provider)}</p>
    </div>
    <span>{statusLabel(provider)}</span>
  </article>
);

export const ProviderPanel = (): ReactElement => {
  const errorMessage = useProviderStore((state) => state.errorMessage);
  const isLoading = useProviderStore((state) => state.isLoading);
  const providers = useProviderStore((state) => state.providers);
  const refreshProviders = useProviderStore((state) => state.refreshProviders);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  return (
    <section className="provider-panel" aria-labelledby="provider-panel-title">
      <div className="provider-panel-heading">
        <div>
          <p className="eyebrow">Environment check</p>
          <h2 id="provider-panel-title">Providers</h2>
        </div>
        <button type="button" disabled={isLoading} onClick={() => void refreshProviders()}>
          Check Again
        </button>
      </div>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      <div className="provider-grid">
        {providers.length === 0 ? (
          <p className="provider-empty">
            {isLoading ? "Checking providers..." : "No provider data yet."}
          </p>
        ) : (
          providers.map((provider) => <ProviderCard key={provider.id} provider={provider} />)
        )}
      </div>
    </section>
  );
};
