import { resolveDirectoryRealPath } from "@main/filesystem/pathGuard";
import { approveStartupScope, readStartupState } from "@services/startup/startupJobService";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

export const registerStartupIpc = (): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.startup.getState,
    requestSchema: ipcSchemaMap.startup.getState.request,
    responseSchema: ipcSchemaMap.startup.getState.response,
    handler: async ({ projectRootPath }) => {
      const projectRoot = await resolveDirectoryRealPath(projectRootPath);
      return readStartupState(projectRoot);
    }
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.startup.approveScope,
    requestSchema: ipcSchemaMap.startup.approveScope.request,
    responseSchema: ipcSchemaMap.startup.approveScope.response,
    handler: async ({ approved, projectRootPath }) => {
      const projectRoot = await resolveDirectoryRealPath(projectRootPath);
      return { scope: await approveStartupScope(projectRoot, approved) };
    }
  });
};
