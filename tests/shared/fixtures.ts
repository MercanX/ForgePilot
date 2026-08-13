import { DEFAULT_JOB_TIMEOUT_MS } from "@shared/constants/timeouts";
import type { Finding } from "@shared/schemas/finding";
import type { Job, Task, TaskResult } from "@shared/schemas/job";
import type { LanguagePackManifest } from "@shared/schemas/language-pack";
import type { Project } from "@shared/schemas/project";
import type { Run, WorkflowStage } from "@shared/schemas/run";

export const IDS = {
  project: "11111111-1111-4111-8111-111111111111",
  run: "22222222-2222-4222-8222-222222222222",
  job: "33333333-3333-4333-8333-333333333333",
  task: "44444444-4444-4444-8444-444444444444",
  finding: "55555555-5555-4555-8555-555555555555"
} as const;

export const ISO_DATE = "2026-08-14T00:00:00.000Z";

export const projectFixture: Project = {
  id: IDS.project,
  name: "ForgePilot",
  rootPath: "C:\\Github\\ForgePilot",
  addedAt: ISO_DATE,
  lastOpenedAt: null
};

export const taskFixture: Task = {
  id: IDS.task,
  jobId: IDS.job,
  instructions: {
    body: "Run the requested AI Factory task.",
    format: "plain-text",
    metadata: {}
  },
  timeoutMs: DEFAULT_JOB_TIMEOUT_MS
};

export const findingFixture: Finding = {
  id: IDS.finding,
  runId: IDS.run,
  stageId: "analysis",
  agent: "Local Validator",
  severity: "info",
  status: "open",
  title: "Process exited successfully",
  description: "The provider process returned exit code 0.",
  recommendation: null,
  filePath: null,
  line: null,
  createdAt: ISO_DATE,
  syncedAt: null
};

export const jobFixture: Job = {
  id: IDS.job,
  runId: IDS.run,
  stageId: "analysis",
  providerId: "claude-code",
  status: "received",
  task: taskFixture,
  startedAt: null,
  finishedAt: null,
  exitCode: null
};

export const taskResultFixture: TaskResult = {
  taskId: IDS.task,
  jobId: IDS.job,
  providerId: "claude-code",
  status: "completed",
  exitCode: 0,
  outputChunks: [
    {
      stream: "stdout",
      text: "done",
      timestamp: ISO_DATE
    }
  ],
  findings: [findingFixture],
  startedAt: ISO_DATE,
  finishedAt: ISO_DATE
};

export const workflowStageFixture: WorkflowStage = {
  id: "analysis",
  name: "Analysis",
  status: "running",
  progress: 72,
  currentAgent: "Architecture Analyzer",
  currentOperation: "Analyzing architecture"
};

export const runFixture: Run = {
  id: IDS.run,
  projectId: IDS.project,
  workflowId: "software-factory-v1",
  workflowVersion: "1.0.0",
  providerId: "claude-code",
  status: "running",
  stages: [workflowStageFixture],
  jobs: [jobFixture],
  findings: [findingFixture],
  checkpoint: {
    stageId: "analysis",
    jobId: IDS.job,
    updatedAt: ISO_DATE
  },
  startedAt: ISO_DATE,
  finishedAt: null
};

export const languagePackManifestFixture: LanguagePackManifest = {
  id: "tr-TR",
  name: "Türkçe",
  version: "1.0.0",
  forgepilotProtocol: "1",
  direction: "ltr",
  fallback: "en-US",
  namespaces: ["common", "renderer"],
  checksum: "0123456789abcdef0123456789abcdef",
  signature: "abcdef0123456789abcdef0123456789"
};
