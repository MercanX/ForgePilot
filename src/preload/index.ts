import electron from "electron";

import { IPC_CHANNELS } from "@shared/constants/channels";
import type { AppPingResponse } from "@shared/schemas/ipc";

const { contextBridge, ipcRenderer } = electron;

const forgepilotApi = {
  app: {
    ping: (): Promise<AppPingResponse> => ipcRenderer.invoke(IPC_CHANNELS.app.ping, {})
  }
} as const;

contextBridge.exposeInMainWorld("forgepilot", Object.freeze(forgepilotApi));

export type ForgePilotApi = typeof forgepilotApi;
