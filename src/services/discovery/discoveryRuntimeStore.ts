import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const RUNTIME_DIR_SEGMENTS = [".ai-factory", ".forgepilot", "discovery-runtime-v2"];

const runtimeDir = (projectRootPath: string): string =>
  path.join(projectRootPath, ...RUNTIME_DIR_SEGMENTS);

const runtimePath = (projectRootPath: string, id: string): string => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error("Invalid Discovery runtime preparation id.");
  }

  return path.join(runtimeDir(projectRootPath), `${id}.json`);
};

export const saveDiscoveryRuntimePayload = async <T>(
  projectRootPath: string,
  kind: string,
  payload: T
): Promise<string> => {
  const id = randomUUID();
  const directory = runtimeDir(projectRootPath);
  const targetPath = runtimePath(projectRootPath, id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    targetPath,
    `${JSON.stringify({ kind, payload, schemaVersion: 1 }, null, 2)}\n`,
    "utf8"
  );
  return id;
};

export const loadDiscoveryRuntimePayload = async <T>(
  projectRootPath: string,
  id: string,
  expectedKind: string
): Promise<T> => {
  const document = JSON.parse(await readFile(runtimePath(projectRootPath, id), "utf8")) as unknown;

  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    throw new Error("Invalid Discovery runtime payload.");
  }

  const record = document as Record<string, unknown>;

  if (record.schemaVersion !== 1 || record.kind !== expectedKind || !("payload" in record)) {
    throw new Error(`Discovery runtime payload does not match ${expectedKind}.`);
  }

  return record.payload as T;
};

export const removeDiscoveryRuntimePayload = async (
  projectRootPath: string,
  id: string
): Promise<void> => {
  try {
    await rm(runtimePath(projectRootPath, id), { force: true });
  } catch {
    // Runtime cache cleanup is best-effort. Canonical Discovery artifacts are not stored here.
  }
};
