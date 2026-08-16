import {
  type DiscoveryChecklistPolicy,
  type DiscoverySeverityPolicy,
  type D05SemanticCandidate,
  finalizeDetectGapsV2Job,
  prepareDetectGapsV2Job
} from "../discovery/discoveryValidationService";
import {
  type GlossaryCandidateInput,
  runClassifyFilesJob,
  runMapDependenciesJob,
  runScanProjectJob
} from "../discovery/discoveryJobService";
import { runMapModuleDependenciesJob } from "../discovery/discoveryModuleDependencyService";
import {
  finalizeGenerateReportV2Job,
  prepareGenerateReportV2Job
} from "../discovery/discoveryReportService";
import {
  type DiscoveryScorePolicy,
  runScoreAndGateV2Job
} from "../discovery/discoveryScoreGateService";
import {
  finalizeBuildContextV2Job,
  finalizeIndexDocumentsV2Job,
  prepareBuildContextV2Job,
  prepareIndexDocumentsV2Job
} from "../discovery/discoverySemanticPreparation";
import {
  runBuildFactoryManifestJob,
  runBuildSourceManifestJob,
  runCaptureGitStateJob,
  runPlaceInputsJob,
  runSealRunJob,
  runSelectRunJob,
  runStartupJob
} from "../startup/startupJobService";

export type LocalOperationHandler = (
  projectRootPath: string,
  inputs: Record<string, unknown>
) => Promise<unknown>;

export type LocalOperationRegistry = {
  execute: (
    operation: string,
    projectRootPath: string,
    inputs?: Record<string, unknown>
  ) => Promise<unknown>;
  has: (operation: string) => boolean;
  list: () => string[];
};

const requireString = (inputs: Record<string, unknown>, key: string): string => {
  const value = inputs[key];

  if (typeof value !== "string" || !value) {
    throw new Error(`Local operation input \"${key}\" must be a non-empty string.`);
  }

  return value;
};

const requireNumber = (inputs: Record<string, unknown>, key: string): number => {
  const value = inputs[key];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Local operation input \"${key}\" must be a finite number.`);
  }

  return value;
};

const requireObject = <T>(inputs: Record<string, unknown>, key: string): T => {
  const value = inputs[key];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Local operation input \"${key}\" must be an object.`);
  }

  return value as T;
};

const handlers: Record<string, LocalOperationHandler> = {
  "startup.check": (projectRootPath) => runStartupJob(projectRootPath),
  "startup.select-run": (projectRootPath, inputs) =>
    runSelectRunJob(projectRootPath, inputs.newRun === true),
  "startup.place-inputs": (projectRootPath, inputs) =>
    runPlaceInputsJob(projectRootPath, requireString(inputs, "runId")),
  "startup.capture-git-state": (projectRootPath, inputs) =>
    runCaptureGitStateJob(projectRootPath, requireString(inputs, "runId")),
  "startup.build-source-manifest": (projectRootPath, inputs) =>
    runBuildSourceManifestJob(projectRootPath, requireString(inputs, "runId")),
  "startup.build-factory-manifest": (projectRootPath, inputs) =>
    runBuildFactoryManifestJob(projectRootPath, requireString(inputs, "runId")),
  "startup.seal-run": (projectRootPath, inputs) =>
    runSealRunJob(projectRootPath, requireString(inputs, "runId")),

  // Discovery v2: full canonical data stays local. Only bounded semantic views
  // produced by the prepare operations are returned to Cloud/LLM.
  "discovery.scan-project": (projectRootPath) => runScanProjectJob(projectRootPath),
  "discovery.classify-files": (projectRootPath) => runClassifyFilesJob(projectRootPath),
  "discovery.prepare-index-documents-v2": (projectRootPath) =>
    prepareIndexDocumentsV2Job(projectRootPath),
  "discovery.finalize-index-documents-v2": (projectRootPath, inputs) =>
    finalizeIndexDocumentsV2Job(
      projectRootPath,
      requireString(inputs, "preparationId"),
      Array.isArray(inputs.candidates) ? (inputs.candidates as GlossaryCandidateInput[]) : []
    ),
  "discovery.map-dependencies": (projectRootPath) => runMapDependenciesJob(projectRootPath),
  "discovery.prepare-context-v2": (projectRootPath) => prepareBuildContextV2Job(projectRootPath),
  "discovery.finalize-context-v2": (projectRootPath, inputs) =>
    finalizeBuildContextV2Job(
      projectRootPath,
      requireString(inputs, "preparationId"),
      inputs.patch ?? {}
    ),
  "discovery.map-module-dependencies-v2": (projectRootPath) =>
    runMapModuleDependenciesJob(projectRootPath),
  "discovery.prepare-detect-gaps-v2": (projectRootPath, inputs) =>
    prepareDetectGapsV2Job(
      projectRootPath,
      requireObject<DiscoverySeverityPolicy>(inputs, "severityPolicy"),
      requireObject<DiscoveryChecklistPolicy>(inputs, "checklist")
    ),
  "discovery.finalize-detect-gaps-v2": (projectRootPath, inputs) =>
    finalizeDetectGapsV2Job(
      projectRootPath,
      requireString(inputs, "preparationId"),
      Array.isArray(inputs.candidates) ? (inputs.candidates as D05SemanticCandidate[]) : []
    ),
  "discovery.score-and-gate-v2": (projectRootPath, inputs) =>
    runScoreAndGateV2Job(
      projectRootPath,
      requireObject<DiscoveryScorePolicy>(inputs, "scorePolicy"),
      requireNumber(inputs, "minimumScore")
    ),
  "discovery.prepare-report-v2": (projectRootPath) => prepareGenerateReportV2Job(projectRootPath),
  "discovery.finalize-report-v2": (projectRootPath, inputs) =>
    finalizeGenerateReportV2Job(
      projectRootPath,
      requireString(inputs, "preparationId"),
      inputs.patch ?? null
    )
};

export const createLocalOperationRegistry = (
  overrides: Record<string, LocalOperationHandler> = {}
): LocalOperationRegistry => {
  const operations = { ...handlers, ...overrides };

  return {
    execute: async (operation, projectRootPath, inputs = {}) => {
      const handler = operations[operation];

      if (!handler) {
        throw new Error(`Unsupported local operation: ${operation}`);
      }

      return handler(projectRootPath, inputs);
    },
    has: (operation) => operation in operations,
    list: () => Object.keys(operations).sort()
  };
};
