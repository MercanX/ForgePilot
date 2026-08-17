import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { StageRepairState } from "@shared/schemas/repair";

export const MAX_AUTO_REPAIR_ATTEMPTS = 5;

export type RepairAuthority = {
  audit_id?: string;
  schema_version?: string;
  substage?: string;
  workspace_hash?: string;
};

export type RepairPendingDirective =
  | {
      kind: "provider";
      jobId?: string;
      providerResultSubmitted?: boolean;
      taskId?: string;
    }
  | { kind: "local"; operation: string };

export type StageRepairRecord = {
  authority: RepairAuthority;
  autoAttempts: number;
  changedPaths: string[];
  directiveId: string;
  executionId: string;
  manualAttempts: number;
  maxAutoAttempts: number;
  originalOutput: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  pending: RepairPendingDirective;
  schemaVersion: 1;
  stageId: string;
  updatedAt: string;
  validationErrors: string[];
  workingOutput: Record<string, unknown>;
};

export type StageRepairStore = {
  clear: (stageId: string) => Promise<void>;
  get: (stageId: string) => Promise<StageRepairRecord | null>;
  save: (record: StageRepairRecord) => Promise<void>;
  toPublicState: (stageId: string) => Promise<StageRepairState>;
};

const repairDirectory = (projectRootPath: string): string =>
  path.join(projectRootPath, ".ai-factory", ".forgepilot", "stage-repair");

const safeStageName = (stageId: string): string =>
  stageId.replace(/[^a-zA-Z0-9._-]+/g, "_");

const repairPath = (projectRootPath: string, stageId: string): string =>
  path.join(repairDirectory(projectRootPath), `${safeStageName(stageId)}.json`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseRecord = (value: unknown): StageRepairRecord | null => {
  if (!isObject(value) || value.schemaVersion !== 1) return null;
  if (
    typeof value.stageId !== "string" ||
    typeof value.executionId !== "string" ||
    typeof value.directiveId !== "string" ||
    !isObject(value.originalOutput) ||
    !isObject(value.workingOutput) ||
    !isObject(value.outputSchema) ||
    !isObject(value.authority) ||
    !isObject(value.pending) ||
    !Array.isArray(value.validationErrors) ||
    !Array.isArray(value.changedPaths)
  ) {
    return null;
  }

  const pending = value.pending;
  if (pending.kind === "provider") {
    if (
      (pending.jobId !== undefined && typeof pending.jobId !== "string") ||
      (pending.taskId !== undefined && typeof pending.taskId !== "string") ||
      (pending.providerResultSubmitted !== undefined &&
        typeof pending.providerResultSubmitted !== "boolean")
    ) {
      return null;
    }
  } else if (!(pending.kind === "local" && typeof pending.operation === "string")) {
    return null;
  }

  return value as unknown as StageRepairRecord;
};

export const createStageRepairStore = (projectRootPath: string): StageRepairStore => {
  const get = async (stageId: string): Promise<StageRepairRecord | null> => {
    try {
      return parseRecord(JSON.parse(await readFile(repairPath(projectRootPath, stageId), "utf8")) as unknown);
    } catch {
      return null;
    }
  };

  const save = async (record: StageRepairRecord): Promise<void> => {
    const target = repairPath(projectRootPath, record.stageId);
    const temporary = `${target}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      temporary,
      `${JSON.stringify({ ...record, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
    await rename(temporary, target);
  };

  return {
    clear: async (stageId) => {
      await rm(repairPath(projectRootPath, stageId), { force: true });
    },
    get,
    save,
    toPublicState: async (stageId) => {
      const record = await get(stageId);
      if (!record) {
        return {
          available: false,
          autoAttempts: 0,
          canSave: false,
          changedPaths: [],
          manualAttempts: 0,
          maxAutoAttempts: MAX_AUTO_REPAIR_ATTEMPTS,
          stageId,
          status: null,
          updatedAt: null,
          validationErrors: [],
          workingJson: null
        };
      }

      return {
        available: true,
        autoAttempts: record.autoAttempts,
        canSave: record.validationErrors.length === 0,
        changedPaths: record.changedPaths,
        manualAttempts: record.manualAttempts,
        maxAutoAttempts: record.maxAutoAttempts,
        stageId,
        status: record.validationErrors.length === 0 ? "ready_to_save" : "needs_manual",
        updatedAt: record.updatedAt,
        validationErrors: record.validationErrors,
        workingJson: JSON.stringify(record.workingOutput, null, 2)
      };
    }
  };
};
