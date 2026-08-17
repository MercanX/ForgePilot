import electron from "electron";

import { IPC_CHANNELS } from "@shared/constants/channels";
import type {
  CloudConnectionStatus,
  CloudStatusRequest,
  JobRunProgressEvent,
  JobRunRequest,
  JobRunResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import type {
  AppPingResponse,
  StartupApproveScopeRequest,
  StartupApproveScopeResponse,
  StartupGetStateRequest
} from "@shared/schemas/ipc";
import type {
  JobProviderDebugEvent,
  TaskExecutionRequest,
  TaskExitEvent,
  TaskOutputEvent,
  TaskStartResponse
} from "@shared/schemas/job";
import type { Project, ProjectAddResponse, ProjectListResponse } from "@shared/schemas/project";
import type {
  StageRepairActionRequest,
  StageRepairImportRequest,
  StageRepairState
} from "@shared/schemas/repair";
import type { ProviderDetectionResult, ProviderId } from "@shared/schemas/provider";
import type { AppSettings } from "@shared/schemas/settings";
import type { StartupState } from "@shared/schemas/startup";

const { contextBridge, ipcRenderer } = electron;

type Unsubscribe = () => void;

const subscribe = <TPayload>(
  channel: string,
  callback: (payload: TPayload) => void
): Unsubscribe => {
  const listener = (_event: Electron.IpcRendererEvent, payload: TPayload): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

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
  },
  providers: {
    list: (): Promise<ProviderDetectionResult[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.providers.list, {}),
    detect: (providerId: ProviderId): Promise<ProviderDetectionResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.providers.detect, { providerId }),
    refresh: (): Promise<ProviderDetectionResult[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.providers.refresh, {})
  },
  tasks: {
    start: (request: TaskExecutionRequest): Promise<TaskStartResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.tasks.start, request),
    stop: (taskId: string): Promise<{ stopped: boolean }> =>
      ipcRenderer.invoke(IPC_CHANNELS.tasks.stop, { taskId }),
    onOutput: (callback: (event: TaskOutputEvent) => void): Unsubscribe =>
      subscribe(IPC_CHANNELS.tasks.output, callback),
    onExit: (callback: (event: TaskExitEvent) => void): Unsubscribe =>
      subscribe(IPC_CHANNELS.tasks.exit, callback)
  },
  jobs: {
    status: (request: CloudStatusRequest): Promise<CloudConnectionStatus> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.status, request),
    workflow: (projectId: string, rootPath: string): Promise<WorkflowResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.workflow, { projectId, rootPath }),
    runOnce: (request: JobRunRequest): Promise<JobRunResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.runOnce, request),
    repairState: (projectRootPath: string, stageId: string): Promise<StageRepairState> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.repairState, { projectRootPath, stageId }),
    repairImport: (request: StageRepairImportRequest): Promise<StageRepairState> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.repairImport, request),
    repairValidate: (projectRootPath: string, stageId: string, workingJson: string): Promise<StageRepairState> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.repairValidate, { projectRootPath, stageId, workingJson }),
    repairManual: (request: StageRepairActionRequest): Promise<StageRepairState> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.repairManual, request),
    repairSave: (request: StageRepairActionRequest): Promise<JobRunResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.jobs.repairSave, request),
    onProgress: (callback: (event: JobRunProgressEvent) => void): Unsubscribe =>
      subscribe(IPC_CHANNELS.jobs.progress, callback),
    onDebug: (callback: (event: JobProviderDebugEvent) => void): Unsubscribe =>
      subscribe(IPC_CHANNELS.jobs.debug, callback)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.settings.get, {}),
    save: (settings: AppSettings): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.settings.save, settings)
  },
  startup: {
    getState: (request: StartupGetStateRequest): Promise<StartupState> =>
      ipcRenderer.invoke(IPC_CHANNELS.startup.getState, request),
    approveScope: (request: StartupApproveScopeRequest): Promise<StartupApproveScopeResponse> =>
      ipcRenderer.invoke(IPC_CHANNELS.startup.approveScope, request)
  }
} as const;

contextBridge.exposeInMainWorld("forgepilot", Object.freeze(forgepilotApi));

export type ForgePilotApi = typeof forgepilotApi;
