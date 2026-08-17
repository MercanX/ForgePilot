import { access, readFile } from "node:fs/promises";
import path from "node:path";

const MANIFEST_RELATIVE_PATH = path.join(
  ".ai-factory",
  "020-Discovery",
  "STAGE-EXECUTION-MANIFEST.json"
);

type ManifestStage = {
  id: string;
  substage: string;
  display_name: string;
  order: number;
  folder: string;
  implementation_status: "available" | "not_ready";
  description: string;
  hard: string[];
  soft: string[];
};

type ManifestDocument = {
  schema_version: "1.0";
  policy: "dependency-aware-selectable";
  description: string;
  stages: ManifestStage[];
};

export type DiscoveryStageCatalogEntry = ManifestStage & {
  package_present: boolean;
  available: boolean;
  availability_message: string | null;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error(`Invalid Discovery stage manifest ${label}.`);
  }
  return value;
};

const parseManifest = (value: unknown): ManifestDocument => {
  if (!isObject(value) || value.schema_version !== "1.0" || value.policy !== "dependency-aware-selectable") {
    throw new Error("Invalid Discovery stage execution manifest header.");
  }
  if (typeof value.description !== "string" || !Array.isArray(value.stages)) {
    throw new Error("Invalid Discovery stage execution manifest body.");
  }

  const stages = value.stages.map((raw, index): ManifestStage => {
    if (!isObject(raw)) {
      throw new Error(`Invalid Discovery stage manifest entry at index ${index}.`);
    }
    const status = raw.implementation_status;
    if (status !== "available" && status !== "not_ready") {
      throw new Error(`Invalid implementation_status for Discovery stage at index ${index}.`);
    }
    for (const key of ["id", "substage", "display_name", "folder", "description"] as const) {
      if (typeof raw[key] !== "string" || raw[key].length === 0) {
        throw new Error(`Invalid ${key} for Discovery stage at index ${index}.`);
      }
    }
    if (typeof raw.order !== "number" || !Number.isFinite(raw.order)) {
      throw new Error(`Invalid order for Discovery stage at index ${index}.`);
    }

    return {
      id: raw.id as string,
      substage: raw.substage as string,
      display_name: raw.display_name as string,
      order: raw.order,
      folder: raw.folder as string,
      implementation_status: status,
      description: raw.description as string,
      hard: parseStringArray(raw.hard, `${String(raw.id)}.hard`),
      soft: parseStringArray(raw.soft, `${String(raw.id)}.soft`)
    };
  });

  const ids = new Set<string>();
  for (const stage of stages) {
    if (ids.has(stage.id)) {
      throw new Error(`Duplicate Discovery stage id in manifest: ${stage.id}`);
    }
    ids.add(stage.id);
  }

  const knownIds = new Set(["010-startup", ...ids]);
  for (const stage of stages) {
    for (const dependency of [...stage.hard, ...stage.soft]) {
      if (!knownIds.has(dependency)) {
        throw new Error(`Unknown Discovery dependency ${dependency} referenced by ${stage.id}.`);
      }
      if (dependency === stage.id) {
        throw new Error(`Discovery stage ${stage.id} cannot depend on itself.`);
      }
    }
  }

  const hardById = new Map(stages.map((stage) => [stage.id, stage.hard]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stageId: string): void => {
    if (visited.has(stageId) || stageId === "010-startup") return;
    if (visiting.has(stageId)) {
      throw new Error(`HARD Discovery dependency cycle detected at ${stageId}.`);
    }
    visiting.add(stageId);
    for (const dependency of hardById.get(stageId) ?? []) visit(dependency);
    visiting.delete(stageId);
    visited.add(stageId);
  };
  for (const stage of stages) visit(stage.id);

  return {
    schema_version: "1.0",
    policy: "dependency-aware-selectable",
    description: value.description,
    stages: stages.sort((left, right) => left.order - right.order)
  };
};

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const loadDiscoveryStageCatalog = async (
  projectRootPath: string
): Promise<DiscoveryStageCatalogEntry[]> => {
  const manifestPath = path.join(projectRootPath, MANIFEST_RELATIVE_PATH);

  let manifest: ManifestDocument;
  try {
    manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return Promise.all(
    manifest.stages.map(async (stage): Promise<DiscoveryStageCatalogEntry> => {
      const packagePresent = await exists(
        path.join(projectRootPath, ".ai-factory", "020-Discovery", stage.folder)
      );
      const available = stage.implementation_status === "available" && packagePresent;
      const availabilityMessage = available
        ? null
        : stage.implementation_status !== "available"
          ? "Stage package is defined but not implemented yet."
          : "Stage package is not installed in this project."

      return {
        ...stage,
        package_present: packagePresent,
        available,
        availability_message: availabilityMessage
      };
    })
  );
};
