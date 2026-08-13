import { createProviderRegistry, type ProviderRegistry } from "@main/providers/registry";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

export const registerProvidersIpc = (
  registry: ProviderRegistry = createProviderRegistry()
): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.providers.list,
    requestSchema: ipcSchemaMap.providers.list.request,
    responseSchema: ipcSchemaMap.providers.list.response,
    handler: () => registry.list()
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.providers.detect,
    requestSchema: ipcSchemaMap.providers.detect.request,
    responseSchema: ipcSchemaMap.providers.detect.response,
    handler: ({ providerId }) => registry.detect(providerId)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.providers.refresh,
    requestSchema: ipcSchemaMap.providers.refresh.request,
    responseSchema: ipcSchemaMap.providers.refresh.response,
    handler: () => registry.refresh()
  });
};
