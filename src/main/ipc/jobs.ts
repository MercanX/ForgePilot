import { createJobService, type JobService } from "@services/jobs/jobService";
import { IPC_CHANNELS } from "@shared/constants/channels";
import { ipcSchemaMap } from "@shared/schemas/ipc";
import { jobProviderDebugEventSchema } from "@shared/schemas/job";

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
      service.runOnce(
        request,
        (progressEvent) => {
          event.sender.send(IPC_CHANNELS.jobs.progress, progressEvent);
        },
        (debugEvent) => {
          const parsed = jobProviderDebugEventSchema.safeParse(debugEvent);
          if (parsed.success) {
            event.sender.send(IPC_CHANNELS.jobs.debug, parsed.data);
          }
        }
      )
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.retryProviderNow,
    requestSchema: ipcSchemaMap.jobs.retryProviderNow.request,
    responseSchema: ipcSchemaMap.jobs.retryProviderNow.response,
    handler: ({ projectId, stageId }) => service.retryProviderNow(projectId, stageId)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.repairState,
    requestSchema: ipcSchemaMap.jobs.repairState.request,
    responseSchema: ipcSchemaMap.jobs.repairState.response,
    handler: ({ projectRootPath, stageId }) => service.getRepairState(projectRootPath, stageId)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.repairImport,
    requestSchema: ipcSchemaMap.jobs.repairImport.request,
    responseSchema: ipcSchemaMap.jobs.repairImport.response,
    handler: (request, event) =>
      service.importRepairJson(
        request,
        (progressEvent) => event.sender.send(IPC_CHANNELS.jobs.progress, progressEvent),
        (debugEvent) => {
          const parsed = jobProviderDebugEventSchema.safeParse(debugEvent);
          if (parsed.success) event.sender.send(IPC_CHANNELS.jobs.debug, parsed.data);
        }
      )
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.repairValidate,
    requestSchema: ipcSchemaMap.jobs.repairValidate.request,
    responseSchema: ipcSchemaMap.jobs.repairValidate.response,
    handler: ({ projectRootPath, stageId, workingJson }) =>
      service.validateRepairJson(projectRootPath, stageId, workingJson)
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.repairManual,
    requestSchema: ipcSchemaMap.jobs.repairManual.request,
    responseSchema: ipcSchemaMap.jobs.repairManual.response,
    handler: (request, event) =>
      service.manualRepair(
        request,
        (progressEvent) => event.sender.send(IPC_CHANNELS.jobs.progress, progressEvent),
        (debugEvent) => {
          const parsed = jobProviderDebugEventSchema.safeParse(debugEvent);
          if (parsed.success) event.sender.send(IPC_CHANNELS.jobs.debug, parsed.data);
        }
      )
  });

  defineIpcHandler({
    channel: IPC_CHANNELS.jobs.repairSave,
    requestSchema: ipcSchemaMap.jobs.repairSave.request,
    responseSchema: ipcSchemaMap.jobs.repairSave.response,
    handler: (request, event) =>
      service.saveRepair(
        request,
        (progressEvent) => event.sender.send(IPC_CHANNELS.jobs.progress, progressEvent),
        (debugEvent) => {
          const parsed = jobProviderDebugEventSchema.safeParse(debugEvent);
          if (parsed.success) event.sender.send(IPC_CHANNELS.jobs.debug, parsed.data);
        }
      )
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
