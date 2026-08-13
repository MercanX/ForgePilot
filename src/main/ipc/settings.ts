import electron from "electron";

import {
  createSettingsRepository,
  type SettingsRepository
} from "@services/settings/settingsRepository";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

const { app } = electron;

export const registerSettingsIpc = (
  repository: SettingsRepository = createSettingsRepository(app.getPath("userData"))
): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.settings.get,
    requestSchema: ipcSchemaMap.settings.get.request,
    responseSchema: ipcSchemaMap.settings.get.response,
    handler: () => repository.get()
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.settings.save,
    requestSchema: ipcSchemaMap.settings.save.request,
    responseSchema: ipcSchemaMap.settings.save.response,
    handler: (settings) => repository.save(settings)
  });
};
