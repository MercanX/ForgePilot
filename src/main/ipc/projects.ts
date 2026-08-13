import electron from "electron";

import {
  createProjectRepository,
  type ProjectRepository
} from "@services/projects/projectRepository";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

const { app, dialog } = electron;

export const registerProjectsIpc = (
  repository: ProjectRepository = createProjectRepository(app.getPath("userData"))
): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.projects.list,
    requestSchema: ipcSchemaMap.projects.list.request,
    responseSchema: ipcSchemaMap.projects.list.response,
    handler: () => repository.list()
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.projects.add,
    requestSchema: ipcSchemaMap.projects.add.request,
    responseSchema: ipcSchemaMap.projects.add.response,
    handler: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "dontAddToRecent"],
        title: "Select project folder"
      });

      if (result.canceled || !result.filePaths[0]) {
        return null;
      }

      return repository.add(result.filePaths[0]);
    }
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.projects.remove,
    requestSchema: ipcSchemaMap.projects.remove.request,
    responseSchema: ipcSchemaMap.projects.remove.response,
    handler: async ({ projectId }) => ({
      removed: await repository.remove(projectId)
    })
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.projects.open,
    requestSchema: ipcSchemaMap.projects.open.request,
    responseSchema: ipcSchemaMap.projects.open.response,
    handler: ({ projectId }) => repository.open(projectId)
  });
};
