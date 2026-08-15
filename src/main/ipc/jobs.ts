import { createJobService, type JobService } from "@services/jobs/jobService";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";

import { defineIpcHandler } from "./registerHandler";

export const registerJobsIpc = (service: JobService = createJobService()): void => {
  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.status,
    requestSchema: ipcSchemaMap.jobs.status.request,
    responseSchema: ipcSchemaMap.jobs.status.response,
    handler: (request) => service.getStatus(request)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.runOnce,
    requestSchema: ipcSchemaMap.jobs.runOnce.request,
    responseSchema: ipcSchemaMap.jobs.runOnce.response,
    handler: (request, event) =>
      service.runOnce(request, (progressEvent) => {
        event.sender.send(IPC_CHANNELS.jobs.progress, progressEvent);
      })
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.request,
    requestSchema: ipcSchemaMap.jobs.request.request,
    responseSchema: ipcSchemaMap.jobs.request.response,
    handler: (request) => service.requestJob(request, "http://localhost:4317")
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.get,
    requestSchema: ipcSchemaMap.jobs.get.request,
    responseSchema: ipcSchemaMap.jobs.get.response,
    handler: ({ jobId }) => service.getTask(jobId, "http://localhost:4317")
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.workflow,
    requestSchema: ipcSchemaMap.jobs.workflow.request,
    responseSchema: ipcSchemaMap.jobs.workflow.response,
    handler: ({ projectId, rootPath }) => service.getWorkflow(projectId, rootPath, "http://localhost:4317")
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.heartbeat,
    requestSchema: ipcSchemaMap.jobs.heartbeat.request,
    responseSchema: ipcSchemaMap.jobs.heartbeat.response,
    handler: () => ({ accepted: true as const })
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.submitResult,
    requestSchema: ipcSchemaMap.jobs.submitResult.request,
    responseSchema: ipcSchemaMap.jobs.submitResult.response,
    handler: (request) => service.submitResult(request, "http://localhost:4317")
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.fail,
    requestSchema: ipcSchemaMap.jobs.fail.request,
    responseSchema: ipcSchemaMap.jobs.fail.response,
    handler: (request) => service.fail(request, "http://localhost:4317")
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.syncFindings,
    requestSchema: ipcSchemaMap.jobs.syncFindings.request,
    responseSchema: ipcSchemaMap.jobs.syncFindings.response,
    handler: ({ findings, runId }) => service.syncFindings(runId, findings, "http://localhost:4317")
  });
};
