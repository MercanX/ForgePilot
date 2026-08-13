import electron from "electron";

import { IPC_CHANNELS } from "@shared/constants/channels";
import type { AppPingResponse } from "@shared/schemas/ipc";
import type { Project, ProjectAddResponse, ProjectListResponse } from "@shared/schemas/project";

const { contextBridge, ipcRenderer } = electron;

const forgepilotApi = {
  app: {
    ping: (): Promise<AppPingResponse> => ipcRenderer.invoke(IPC_CHANNELS.app.ping, {})
  },
  projects: {
    list: (): Promise<ProjectListResponse> => ipcRenderer.invoke(IPC_CHANNELS.projects.list, {}),
    add: (): Promise<ProjectAddResponse> => ipcRenderer.invoke(IPC_CHANNELS.projects.add, {}),
    remove: (projectId: string): Promise<{ removed: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.projects.remove, { projectId }),
    open: (projectId: string): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.projects.open, { projectId })
  }
} as const;

contextBridge.exposeInMainWorld("forgepilot", Object.freeze(forgepilotApi));

export type ForgePilotApi = typeof forgepilotApi;
