import {
  DESKTOP_PROTOCOL_VERSION,
  SUPPORTED_CAPABILITIES
} from "@shared/constants/protocolVersion";
import type {
  CloudConnectionStatus,
  CloudStatusRequest,
  FailJobRequest,
  GetTaskResponse,
  HandshakeResponse,
  JobRunProgressEvent,
  JobRunRequest,
  JobRunResponse,
  RequestJobRequest,
  RequestJobResponse,
  SubmitResultResponse,
  SyncFindingsResponse,
  WorkflowResponse
} from "@shared/schemas/cloud-api";
import {
  getTaskResponseSchema,
  handshakeResponseSchema,
  requestJobResponseSchema,
  submitResultResponseSchema,
  syncFindingsResponseSchema,
  workflowResponseSchema
} from "@shared/schemas/cloud-api";
import type { TaskResult } from "@shared/schemas/job";

import { createHttpClient, type HttpClient } from "../api/httpClient";
import { createProjectWorkflowState } from "./projectWorkflowState";
import {
  createStageExecutionService,
  type StageExecutionService
} from "./stageExecutionService";

export type JobRunProgressListener = (event: JobRunProgressEvent) => void;

export type JobService = {
  fail: (request: FailJobRequest, serverUrl: string) => Promise<{ accepted: true }>;
  getStatus: (request: CloudStatusRequest) => Promise<CloudConnectionStatus>;
  getTask: (jobId: string, serverUrl: string) => Promise<GetTaskResponse>;
  getWorkflow: (projectId: string, rootPath: string, serverUrl: string) => Promise<WorkflowResponse>;
  requestJob: (request: RequestJobRequest, serverUrl: string) => Promise<RequestJobResponse>;
  runOnce: (request: JobRunRequest, onProgress?: JobRunProgressListener) => Promise<JobRunResponse>;
  submitResult: (result: TaskResult, serverUrl: string) => Promise<SubmitResultResponse>;
  syncFindings: (
    runId: string,
    findings: TaskResult["findings"],
    serverUrl: string
  ) => Promise<SyncFindingsResponse>;
};

type JobServiceOptions = {
  createClient?: (serverUrl: string) => HttpClient;
  desktopVersion?: string;
  stageExecutionService?: StageExecutionService;
};

const createClientFactory =
  (options: JobServiceOptions): ((serverUrl: string) => HttpClient) =>
  (serverUrl) =>
    options.createClient?.(serverUrl) ?? createHttpClient(serverUrl);

export const createJobService = (options: JobServiceOptions = {}): JobService => {
  const createClient = createClientFactory(options);
  const desktopVersion = options.desktopVersion ?? "0.4.0";
  const stageExecutionService =
    options.stageExecutionService ?? createStageExecutionService({ createClient });

  const handshake = async (serverUrl: string): Promise<HandshakeResponse> => {
    const response = await createClient(serverUrl).post(
      "/session/handshake",
      {
        desktopVersion,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        supportedCapabilities: [...SUPPORTED_CAPABILITIES]
      },
      handshakeResponseSchema
    );

    if (response.protocolVersion !== DESKTOP_PROTOCOL_VERSION) {
      throw new Error(
        `Cloud protocol mismatch. Desktop requires protocol ${DESKTOP_PROTOCOL_VERSION}, ` +
          `but server ${response.serverVersion} reports protocol ${response.protocolVersion}. ` +
          "Start the mock cloud/server shipped with this ForgePilot build."
      );
    }

    if (response.status === "update-required") {
      throw new Error(
        response.message ??
          `Cloud server ${response.serverVersion} requires a ForgePilot update.`
      );
    }

    return response;
  };

  const getStatus = async (request: CloudStatusRequest): Promise<CloudConnectionStatus> => {
    try {
      const response = await handshake(request.serverUrl);
      return {
        connected: true,
        message: response.message ?? response.status,
        serverVersion: response.serverVersion
      };
    } catch (error) {
      return {
        connected: false,
        message: error instanceof Error ? error.message : "Cloud connection failed.",
        serverVersion: null
      };
    }
  };

  // Cloud owns the stage catalog and execution directives. The project-local
  // JSON is the sole authority for stage completion/readiness. Deleting the
  // project's .ai-factory folder therefore resets the visible workflow state.
  const getWorkflow = async (
    projectId: string,
    rootPath: string,
    serverUrl: string
  ): Promise<WorkflowResponse> => {
    const cloudWorkflow = await createClient(serverUrl).get(
      `/workflows/current?projectId=${encodeURIComponent(projectId)}`,
      workflowResponseSchema
    );

    return createProjectWorkflowState(rootPath).mergeWorkflow(cloudWorkflow);
  };

  const requestJob = async (
    request: RequestJobRequest,
    serverUrl: string
  ): Promise<RequestJobResponse> =>
    createClient(serverUrl).post("/jobs/request", request, requestJobResponseSchema);

  const getTask = async (jobId: string, serverUrl: string): Promise<GetTaskResponse> =>
    createClient(serverUrl).get(`/jobs/${encodeURIComponent(jobId)}`, getTaskResponseSchema);

  const submitResult = async (
    result: TaskResult,
    serverUrl: string
  ): Promise<SubmitResultResponse> =>
    createClient(serverUrl).post(
      `/jobs/${encodeURIComponent(result.jobId)}/result`,
      result,
      submitResultResponseSchema
    );

  const fail = async (request: FailJobRequest, serverUrl: string): Promise<{ accepted: true }> =>
    createClient(serverUrl).post(
      `/jobs/${encodeURIComponent(request.jobId)}/fail`,
      request,
      syncFindingsResponseSchema
    );

  const syncFindings = async (
    runId: string,
    findings: TaskResult["findings"],
    serverUrl: string
  ): Promise<SyncFindingsResponse> =>
    createClient(serverUrl).post(
      "/findings/sync",
      { findings, runId },
      syncFindingsResponseSchema
    );

  const emit = (
    request: JobRunRequest,
    onProgress: JobRunProgressListener | undefined,
    event: Omit<JobRunProgressEvent, "projectId" | "stageId">
  ): void => {
    onProgress?.({
      ...event,
      projectId: request.project.id,
      stageId: request.stageId
    });
  };

  const runOnce = async (
    request: JobRunRequest,
    onProgress?: JobRunProgressListener
  ): Promise<JobRunResponse> => {
    emit(request, onProgress, {
      message: "Connecting to the cloud session.",
      progress: 4,
      status: "started",
      stepId: "cloud-handshake"
    });
    await handshake(request.serverUrl);
    emit(request, onProgress, {
      message: "Cloud session is connected.",
      progress: 8,
      status: "completed",
      stepId: "cloud-handshake"
    });

    emit(request, onProgress, {
      message: "Loading the current workflow.",
      progress: 12,
      status: "started",
      stepId: "load-workflow"
    });
    const workflow = await getWorkflow(
      request.project.id,
      request.project.rootPath,
      request.serverUrl
    );
    emit(request, onProgress, {
      message: "Workflow loaded from cloud.",
      progress: 16,
      status: "completed",
      stepId: "load-workflow"
    });

    const requestedStage = request.stageId
      ? workflow.stages.find((stage) => stage.id === request.stageId)
      : workflow.stages.find((stage) => stage.status === "ready" || stage.status === "running");

    if (!requestedStage) {
      throw new Error(
        request.stageId
          ? `Stage is not present in the cloud workflow: ${request.stageId}`
          : "Cloud workflow does not contain a runnable stage."
      );
    }

    if (requestedStage.status === "waiting") {
      throw new Error(`Stage is not ready: ${requestedStage.id}`);
    }

    if (requestedStage.status === "completed" && !request.newRun) {
      throw new Error(`Stage is already completed: ${requestedStage.id}`);
    }

    const projectState = createProjectWorkflowState(request.project.rootPath);
    await projectState.beginStage(workflow.stages, requestedStage.id, request.newRun);

    let stateWrites = Promise.resolve();
    const persistProgress: JobRunProgressListener = (event) => {
      onProgress?.(event);
      stateWrites = stateWrites
        .then(() => projectState.recordProgress(event))
        .catch(() => undefined);
    };

    try {
      const response = await stageExecutionService.run(
        { ...request, stageId: requestedStage.id },
        persistProgress
      );
      await stateWrites;
      await projectState.finishStage(response);
      return response;
    } catch (error) {
      await stateWrites;
      await projectState.failStage(
        requestedStage.id,
        error instanceof Error ? error.message : "Stage execution failed."
      );
      throw error;
    }
  };

  return {
    fail,
    getStatus,
    getTask,
    getWorkflow,
    requestJob,
    runOnce,
    submitResult,
    syncFindings
  };
};
