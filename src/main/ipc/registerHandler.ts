import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { z } from "zod";

type IpcHandlerDefinition<TRequest extends z.ZodType, TResponse extends z.ZodType> = {
  channel: string;
  requestSchema: TRequest;
  responseSchema: TResponse;
  handler: (
    request: z.infer<TRequest>,
    event: IpcMainInvokeEvent
  ) => Promise<z.infer<TResponse>> | z.infer<TResponse>;
};

export const defineIpcHandler = <TRequest extends z.ZodType, TResponse extends z.ZodType>(
  definition: IpcHandlerDefinition<TRequest, TResponse>
): void => {
  ipcMain.handle(definition.channel, async (event, rawRequest: unknown) => {
    const request = definition.requestSchema.parse(rawRequest);
    const response = await definition.handler(request, event);

    return definition.responseSchema.parse(response);
  });
};
