import electron, { type IpcMainInvokeEvent } from "electron";

import type { z } from "zod";

const { ipcMain } = electron;

export class IpcHandlerError extends Error {
  public constructor(
    message: string,
    public readonly channel: string
  ) {
    super(message);
    this.name = "IpcHandlerError";
  }
}

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
    const requestResult = definition.requestSchema.safeParse(rawRequest);

    if (!requestResult.success) {
      throw new IpcHandlerError("Invalid IPC request payload.", definition.channel);
    }

    const response = await definition.handler(requestResult.data, event);
    const responseResult = definition.responseSchema.safeParse(response);

    if (!responseResult.success) {
      throw new IpcHandlerError("Invalid IPC response payload.", definition.channel);
    }

    return responseResult.data;
  });
};
