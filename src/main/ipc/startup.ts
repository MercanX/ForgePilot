import { stat } from "node:fs/promises";
import path from "node:path";

import electron from "electron";

import { assertPathInsideRoot, resolveDirectoryRealPath } from "@main/filesystem/pathGuard";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

const { shell } = electron;

export const registerStartupIpc = (): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.startup.openInputFile,
    requestSchema: ipcSchemaMap.startup.openInputFile.request,
    responseSchema: ipcSchemaMap.startup.openInputFile.response,
    handler: async ({ fileName, projectRootPath, runId }) => {
      const projectRoot = await resolveDirectoryRealPath(projectRootPath);
      const inputFilePath = assertPathInsideRoot(
        projectRoot,
        path.join(projectRoot, ".ai-factory-runs", runId, fileName)
      );
      const inputFileStats = await stat(inputFilePath);

      if (!inputFileStats.isFile()) {
        throw new Error("Startup input path must point to a file.");
      }

      const openError = await shell.openPath(inputFilePath);

      return {
        errorMessage: openError.length > 0 ? openError : null,
        opened: openError.length === 0,
        path: inputFilePath
      };
    }
  });
};
