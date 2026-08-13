import electron from "electron";

import {
  createTaskExecutionService,
  type TaskExecutionService
} from "@services/tasks/taskExecutionService";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";
import { taskExitEventSchema, taskOutputEventSchema } from "@shared/schemas/job";

import { defineIpcHandler } from "./registerHandler";

const { BrowserWindow } = electron;

const sendToAllWindows = (channel: string, payload: unknown): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
};

export const registerTasksIpc = (
  service: TaskExecutionService = createTaskExecutionService()
): void => {
  service.onOutput((event) => {
    const result = taskOutputEventSchema.safeParse(event);

    if (result.success) {
      sendToAllWindows(IPC_CHANNELS.tasks.output, result.data);
    }
  });

  service.onExit((event) => {
    const result = taskExitEventSchema.safeParse(event);

    if (result.success) {
      sendToAllWindows(IPC_CHANNELS.tasks.exit, result.data);
    }
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.tasks.start,
    requestSchema: ipcSchemaMap.tasks.start.request,
    responseSchema: ipcSchemaMap.tasks.start.response,
    handler: (request) => service.start(request)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.tasks.stop,
    requestSchema: ipcSchemaMap.tasks.stop.request,
    responseSchema: ipcSchemaMap.tasks.stop.response,
    handler: ({ taskId }) => ({
      stopped: service.stop(taskId)
    })
  });
};
