import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "@shared/constants/channels";
import type { AppPingResponse } from "@shared/schemas/ipc";

const forgepilotApi = {
  app: {
    ping: (): Promise<AppPingResponse> => ipcRenderer.invoke(IPC_CHANNELS.app.ping, {})
  }
};

contextBridge.exposeInMainWorld("forgepilot", forgepilotApi);

export type ForgePilotApi = typeof forgepilotApi;
