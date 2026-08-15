import {
  finalizeBuildContextJob,
  finalizeIndexDocumentsJob,
  type GlossaryCandidateInput,
  type IndexDocumentsPreparation,
  type BuildContextPreparation,
  prepareBuildContextJob,
  prepareIndexDocumentsJob,
  runClassifyFilesJob,
  runMapDependenciesJob,
  runScanProjectJob
} from "../discovery/discoveryJobService";
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

const asPreparation = <T>(inputs: Record<string, unknown>, key: string): T => {
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
  "discovery.scan-project": (projectRootPath) => runScanProjectJob(projectRootPath),
  "discovery.classify-files": (projectRootPath) => runClassifyFilesJob(projectRootPath),
  "discovery.prepare-index-and-map": async (projectRootPath) => {
    const [preparation, mapDependencies] = await Promise.all([
      prepareIndexDocumentsJob(projectRootPath),
      runMapDependenciesJob(projectRootPath)
    ]);

    return { mapDependencies, preparation };
  },
  "discovery.finalize-index-documents": (projectRootPath, inputs) => {
    const preparation = asPreparation<IndexDocumentsPreparation>(inputs, "preparation");
    const candidates = Array.isArray(inputs.candidates)
      ? (inputs.candidates as GlossaryCandidateInput[])
      : [];

    return finalizeIndexDocumentsJob(projectRootPath, preparation, candidates);
  },
  "discovery.prepare-context": (projectRootPath) => prepareBuildContextJob(projectRootPath),
  "discovery.finalize-context": (projectRootPath, inputs) => {
    const preparation = asPreparation<BuildContextPreparation>(inputs, "preparation");

    return finalizeBuildContextJob(projectRootPath, preparation, inputs.patch);
  }
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
