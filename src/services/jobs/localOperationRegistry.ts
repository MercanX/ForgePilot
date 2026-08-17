import {
  runD05StatusJob,
  runD10StatusJob,
  runD15StatusJob,
  runSaveD05ResultJob,
  runSaveD10ResultJob,
  runSaveD15ResultJob
} from "../discovery/discoverySubstageService";
import {
  runBuildWorkspaceManifestJob,
  runSaveScopeProposalJob,
  runScopeStatusJob,
  runSealWorkspaceJob
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

const handlers: Record<string, LocalOperationHandler> = {
  "startup.scope-status": (projectRootPath, inputs) =>
    runScopeStatusJob(projectRootPath, inputs.reset === true),
  "startup.save-scope-proposal": (projectRootPath, inputs) =>
    runSaveScopeProposalJob(projectRootPath, inputs.proposal),
  "startup.build-workspace-manifest": (projectRootPath) =>
    runBuildWorkspaceManifestJob(projectRootPath),
  "startup.seal-workspace": (projectRootPath) => runSealWorkspaceJob(projectRootPath),

  "discovery.d05-status": (projectRootPath, inputs) =>
    runD05StatusJob(projectRootPath, inputs.reset === true),
  "discovery.save-d05-result": (projectRootPath, inputs) =>
    runSaveD05ResultJob(projectRootPath, inputs.result),

  "discovery.d10-status": (projectRootPath, inputs) =>
    runD10StatusJob(projectRootPath, inputs.reset === true),
  "discovery.save-d10-result": (projectRootPath, inputs) =>
    runSaveD10ResultJob(projectRootPath, inputs.result),

  "discovery.d15-status": (projectRootPath, inputs) =>
    runD15StatusJob(projectRootPath, inputs.reset === true),
  "discovery.save-d15-result": (projectRootPath, inputs) =>
    runSaveD15ResultJob(projectRootPath, inputs.result)
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
