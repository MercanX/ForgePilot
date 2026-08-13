import { APP_NAME, APP_VERSION } from "@shared/constants/app";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { appPingRequestSchema, appPingResponseSchema } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

export const registerAppIpc = (): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.app.ping,
    requestSchema: appPingRequestSchema,
    responseSchema: appPingResponseSchema,
    handler: () => ({
      ok: true as const,
      appName: APP_NAME,
      version: APP_VERSION,
      timestamp: new Date().toISOString()
    })
  });
};
