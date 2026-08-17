import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { verifyStartupWorkspaceSnapshot } from "../startup/startupJobService";

import {
  startupScopeDocumentSchema,
  startupSealSchema,
  startupWorkspaceManifestSchema
} from "@shared/schemas/startup";

const DISCOVERY_DIR = path.join(".ai-factory", "020-Discovery");
const AUDITS_FILE = "AUDITS.json";
const D05_NAME = "D05-Project-Overview";
const D05_STAGE_FILE = "D05-Project-Overview.json";
const D10_NAME = "D10-Architecture";
const D10_STAGE_FILE = "D10-Architecture.json";
const D15_NAME = "D15-Database";
const D15_STAGE_FILE = "D15-Database.json";
const D20_NAME = "D20-Dependencies-Integrations";
const D20_STAGE_FILE = "D20-Dependencies-Integrations.json";
const D25_NAME = "D25-Backend";
const D25_STAGE_FILE = "D25-Backend.json";
const CHECK_IDS = Array.from({ length: 82 }, (_, index) => `OV-${String(index + 1).padStart(3, "0")}`);
const CHECK_ID_SET = new Set(CHECK_IDS);
const D10_CHECK_IDS = Array.from({ length: 82 }, (_, index) => `AR-${String(index + 1).padStart(3, "0")}`);
const D10_CHECK_ID_SET = new Set(D10_CHECK_IDS);
const D15_CHECK_IDS = Array.from({ length: 116 }, (_, index) => `DB-${String(index + 1).padStart(3, "0")}`);
const D15_CHECK_ID_SET = new Set(D15_CHECK_IDS);
const D20_CHECK_IDS = Array.from({ length: 102 }, (_, index) => `DI-${String(index + 1).padStart(3, "0")}`);
const D20_CHECK_ID_SET = new Set(D20_CHECK_IDS);
const D25_CHECK_IDS = Array.from({ length: 134 }, (_, index) => `BE-${String(index + 1).padStart(3, "0")}`);
const D25_CHECK_ID_SET = new Set(D25_CHECK_IDS);

const stableJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type AuthorizedDiscoveryStageEnvelope = {
  completedAt: string;
  result: Record<string, unknown>;
  stageDocument: Record<string, unknown>;
};

export const parseAuthorizedDiscoveryStageEnvelope = (
  resultInput: unknown,
  expected: { auditId: string; label: "D05" | "D10" | "D15" | "D20" | "D25"; substage: string; workspaceHash: string }
): AuthorizedDiscoveryStageEnvelope => {
  if (!isObject(resultInput)) {
    throw new Error(`${expected.label} provider result must be a JSON object.`);
  }
  if (resultInput.audit_id !== expected.auditId) {
    throw new Error(
      `${expected.label} provider result has unexpected audit_id: ${String(resultInput.audit_id)}; expected ${expected.auditId}.`
    );
  }
  if (resultInput.substage !== expected.substage) {
    throw new Error(
      `${expected.label} provider result has unexpected substage: ${String(resultInput.substage)}`
    );
  }
  if (resultInput.schema_version !== "1.0") {
    throw new Error(
      `${expected.label} provider result has unsupported schema_version: ${String(resultInput.schema_version)}`
    );
  }
  if (resultInput.workspace_hash !== expected.workspaceHash) {
    throw new Error(
      `${expected.label} provider result workspace_hash does not match the sealed Startup workspace.`
    );
  }
  if (typeof resultInput.completed_at !== "string" || !ISO_DATE_TIME.test(resultInput.completed_at) || Number.isNaN(Date.parse(resultInput.completed_at))) {
    throw new Error(`${expected.label} provider result completed_at must be an ISO 8601 date-time with timezone.`);
  }
  if (!isObject(resultInput.result)) {
    throw new Error(`${expected.label} provider result must contain the full result envelope.`);
  }
  if (resultInput.result.substage !== expected.substage) {
    throw new Error(
      `${expected.label} provider result.result has unexpected substage: ${String(resultInput.result.substage)}`
    );
  }
  if (typeof resultInput.result.result !== "string") {
    throw new Error(`${expected.label} provider result.result.result must contain the stage decision.`);
  }

  const completedAt = resultInput.completed_at;
  const result = resultInput.result;
  return {
    completedAt,
    result,
    stageDocument: {
      audit_id: expected.auditId,
      completed_at: completedAt,
      result,
      schema_version: "1.0",
      substage: expected.substage,
      workspace_hash: expected.workspaceHash
    }
  };
};

const readJson = async <T>(filePath: string, parse: (value: unknown) => T): Promise<T> =>
  parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);

const readJsonIfPresent = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stableJson(value), "utf8");
};

const discoveryRoot = (projectRootPath: string): string => path.join(projectRootPath, DISCOVERY_DIR);
const auditsIndexPath = (projectRootPath: string): string => path.join(discoveryRoot(projectRootPath), AUDITS_FILE);
const auditDir = (projectRootPath: string, auditId: string): string =>
  path.join(discoveryRoot(projectRootPath), "audits", auditId);
const auditFile = (projectRootPath: string, auditId: string, name: string): string =>
  path.join(auditDir(projectRootPath, auditId), name);
const stageFile = (
  projectRootPath: string,
  auditId: string,
  fileName: string = D05_STAGE_FILE
): string => path.join(auditDir(projectRootPath, auditId), "stages", fileName);

const startupPaths = (projectRootPath: string) => ({
  manifest: path.join(projectRootPath, ".ai-factory", "010-Startup", "WORKSPACE_MANIFEST.json"),
  scope: path.join(projectRootPath, ".ai-factory", "010-Startup", "SCOPE.json"),
  seal: path.join(projectRootPath, ".ai-factory", "010-Startup", "STARTUP_SEAL.json")
});

const normalizeRelativePath = (value: string): string => {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/g, "");
  if (!normalized || normalized === ".") {
    return ".";
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Discovery evidence path must be project-relative: ${value}`);
  }
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error(`Discovery evidence path escapes the project root: ${value}`);
  }
  return normalized;
};

const readStartupAuthority = async (projectRootPath: string) => {
  const paths = startupPaths(projectRootPath);
  const scope = await readJson(paths.scope, (value) => startupScopeDocumentSchema.parse(value));
  const manifest = await readJson(paths.manifest, (value) => startupWorkspaceManifestSchema.parse(value));
  const seal = await readJson(paths.seal, (value) => startupSealSchema.parse(value));

  if (scope.status !== "approved" || !scope.approved || !scope.scope_hash) {
    throw new Error("020-Discovery requires an approved 010-Startup scope.");
  }
  if (seal.status !== "READY_FOR_DISCOVERY") {
    throw new Error("020-Discovery requires a valid READY_FOR_DISCOVERY Startup seal.");
  }
  if (
    manifest.workspace_hash !== seal.workspace_hash ||
    manifest.manifest_hash !== seal.manifest_hash ||
    manifest.scope_hash !== seal.scope_hash ||
    scope.scope_hash !== seal.scope_hash
  ) {
    throw new Error("Startup scope/manifest/seal hashes do not agree. Re-run 010-Startup before Discovery.");
  }

  const current = await verifyStartupWorkspaceSnapshot(projectRootPath);
  if (!current.matches) {
    throw new Error(
      `Workspace changed after 010-Startup was sealed. Expected ${current.expected_workspace_hash}, current ${current.current_workspace_hash}. Restart 010-Startup before Discovery.`
    );
  }

  return { manifest, scope, seal };
};

type AuditIndexEntry = {
  audit_id: string;
  created_at: string;
  scope_hash: string;
  state: string;
  updated_at: string;
  workspace_hash: string;
};

type AuditIndex = {
  active_audit_id: string | null;
  audits: AuditIndexEntry[];
  schema_version: "1.0";
};

const parseAuditIndex = (value: Record<string, unknown> | null): AuditIndex => {
  if (!value || value.schema_version !== "1.0" || !Array.isArray(value.audits)) {
    return { active_audit_id: null, audits: [], schema_version: "1.0" };
  }
  const audits = value.audits.filter(isObject).flatMap((entry): AuditIndexEntry[] => {
    if (
      typeof entry.audit_id !== "string" ||
      typeof entry.created_at !== "string" ||
      typeof entry.scope_hash !== "string" ||
      typeof entry.state !== "string" ||
      typeof entry.updated_at !== "string" ||
      typeof entry.workspace_hash !== "string"
    ) {
      return [];
    }
    return [entry as AuditIndexEntry];
  });
  return {
    active_audit_id: typeof value.active_audit_id === "string" ? value.active_audit_id : null,
    audits,
    schema_version: "1.0"
  };
};

const nextAuditId = (index: AuditIndex): string => {
  const highest = index.audits.reduce((max, item) => {
    const match = /^AUD-(\d+)$/.exec(item.audit_id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `AUD-${String(highest + 1).padStart(3, "0")}`;
};

const ensureAudit = async (
  projectRootPath: string,
  scopeHash: string,
  workspaceHash: string
): Promise<string> => {
  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const active = index.audits.find((entry) => entry.audit_id === index.active_audit_id);
  const now = new Date().toISOString();

  if (active && active.workspace_hash === workspaceHash && active.scope_hash === scopeHash && active.state !== "COMPLETE") {
    return active.audit_id;
  }

  const latestCompleted = [...index.audits]
    .reverse()
    .find((entry) => entry.state === "COMPLETE");
  if (latestCompleted?.workspace_hash === workspaceHash && latestCompleted.scope_hash === scopeHash) {
    throw new Error(
      `The latest completed Full Discovery (${latestCompleted.audit_id}) already covers this sealed workspace. Re-seal 010-Startup after source changes before starting a new Full Discovery.`
    );
  }

  if (active && active.state !== "COMPLETE") {
    active.state = "PARTIAL";
    active.updated_at = now;
    const previousMeta = await readJsonIfPresent(
      auditFile(projectRootPath, active.audit_id, "AUDIT_META.json")
    );
    if (previousMeta) {
      const limitations = (Array.isArray(previousMeta.limitations) ? previousMeta.limitations : []).filter(
        (item): item is string => typeof item === "string"
      );
      await writeJson(auditFile(projectRootPath, active.audit_id, "AUDIT_META.json"), {
        ...previousMeta,
        final_state: "PARTIAL",
        limitations: [
          ...limitations,
          "Source snapshot changed before this audit was completed; evidence was not mixed across workspace hashes."
        ],
        updated_at: now
      });
    }
  }

  const auditId = nextAuditId(index);
  index.active_audit_id = auditId;
  index.audits.push({
    audit_id: auditId,
    created_at: now,
    scope_hash: scopeHash,
    state: "RUNNING",
    updated_at: now,
    workspace_hash: workspaceHash
  });
  await writeJson(auditsIndexPath(projectRootPath), index);

  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    audit_id: auditId,
    contract_version: "D05-project-overview-v1",
    final_state: "RUNNING",
    limitations: [],
    previous_audit_id: index.audits.length > 1 ? index.audits.at(-2)?.audit_id ?? null : null,
    provider_runs: [],
    schema_version: "1.0",
    scope_hash: scopeHash,
    started_at: now,
    sub_stages: {
      [D05_NAME]: { completed_at: null, result: null, status: "READY" },
      [D10_NAME]: { completed_at: null, result: null, status: "WAITING_FOR_D05" },
      [D15_NAME]: { completed_at: null, result: null, status: "WAITING_FOR_D05_D10" },
      [D20_NAME]: { completed_at: null, result: null, status: "WAITING_FOR_D05_D10" },
      [D25_NAME]: { completed_at: null, result: null, status: "WAITING_FOR_D05_D10_D15_D20" }
    },
    updated_at: now,
    workspace_hash: workspaceHash
  });
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    audit_id: auditId,
    project_overview: null,
    schema_version: "1.0"
  });
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    audit_id: auditId,
    findings: [],
    schema_version: "1.0",
    strengths: []
  });
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    audit_id: auditId,
    schema_version: "1.0",
    sub_stages: {}
  });
  return auditId;
};

const invalidateDependentStage = async (
  projectRootPath: string,
  auditId: string,
  options: {
    stageName: string;
    stageFileName: string;
    profileKey: string;
    waitingStatus: string;
  }
): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId, options.stageFileName), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  const nextProfile = { ...profile };
  delete nextProfile[options.profileKey];
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), nextProfile);

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutStage = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== options.stageName)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: withoutStage(findings.findings),
    strengths: withoutStage(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[options.stageName];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverage,
    sub_stages: subStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[options.stageName] = { completed_at: null, result: null, status: options.waitingStatus };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });
};

const resetD05 = async (projectRootPath: string, auditId: string): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    project_overview: null
  });

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const filterOrigin = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== D05_NAME)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: filterOrigin(findings.findings),
    strengths: filterOrigin(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[D05_NAME];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverage,
    sub_stages: subStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D05_NAME] = { completed_at: null, result: null, status: "READY" };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });

  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D10_NAME,
    stageFileName: D10_STAGE_FILE,
    profileKey: "architecture",
    waitingStatus: "WAITING_FOR_D05"
  });
  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D15_NAME,
    stageFileName: D15_STAGE_FILE,
    profileKey: "database",
    waitingStatus: "WAITING_FOR_D05_D10"
  });
  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D20_NAME,
    stageFileName: D20_STAGE_FILE,
    profileKey: "dependencies_integrations",
    waitingStatus: "WAITING_FOR_D05_D10"
  });
  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D25_NAME,
    stageFileName: D25_STAGE_FILE,
    profileKey: "backend",
    waitingStatus: "WAITING_FOR_D05_D10_D15_D20"
  });
};

export type D05StatusResult = {
  audit_id: string;
  discovery_context: Record<string, unknown>;
  scope_hash: string;
  startup_scope: Record<string, unknown>;
  startup_seal: Record<string, unknown>;
  state: "completed" | "ready";
  workspace_hash: string;
};

export const runD05StatusJob = async (
  projectRootPath: string,
  reset: boolean
): Promise<D05StatusResult> => {
  const { scope, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);

  if (reset) {
    await resetD05(projectRootPath, auditId);
  }

  const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId));
  const result = saved && isObject(saved.result) ? saved.result : null;
  const completed = result && result.result !== "BLOCKED";

  return {
    audit_id: auditId,
    discovery_context: {
      audit_id: auditId,
      completed_substages: completed ? [D05_NAME] : []
    },
    scope_hash: scope.scope_hash ?? seal.scope_hash,
    startup_scope: {
      approved: scope.approved,
      scope_hash: scope.scope_hash
    },
    startup_seal: {
      file_count: seal.file_count,
      manifest_hash: seal.manifest_hash,
      scope_hash: seal.scope_hash,
      status: seal.status,
      workspace_hash: seal.workspace_hash
    },
    state: completed ? "completed" : "ready",
    workspace_hash: seal.workspace_hash
  };
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const evidenceArraysFromResult = (result: Record<string, unknown>): unknown[][] => {
  const arrays: unknown[][] = [];
  const collectEvidence = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collectEvidence(item);
      return;
    }
    if (!isObject(value)) return;
    if (Array.isArray(value.evidence)) arrays.push(value.evidence);
    for (const [key, nested] of Object.entries(value)) {
      if (key !== "evidence") collectEvidence(nested);
    }
  };
  collectEvidence(result);
  return arrays;
};

const D05_RUNTIME_EVIDENCE_PATHS = new Set([
  "@startup/scope",
  "@startup/seal",
  "@startup/workspace-manifest",
  "@discovery/context"
]);

const validateEvidence = (
  result: Record<string, unknown>,
  manifestPaths: Set<string>,
  stageLabel: "D05" | "D10" | "D15" | "D20"
): void => {
  const manifestList = [...manifestPaths];
  for (const evidenceArray of evidenceArraysFromResult(result)) {
    for (const raw of evidenceArray) {
      if (!isObject(raw) || typeof raw.path !== "string") {
        throw new Error(`${stageLabel} evidence entries must contain a valid evidence path.`);
      }

      const rawPath = raw.path.trim();
      if (D05_RUNTIME_EVIDENCE_PATHS.has(rawPath)) {
        continue;
      }

      const relativePath = normalizeRelativePath(rawPath);
      const isManifestFile = manifestPaths.has(relativePath);
      const directoryPrefix = relativePath.endsWith("/") ? relativePath : `${relativePath}/`;
      const isApprovedDirectory = manifestList.some((path) => path.startsWith(directoryPrefix));

      if (!isManifestFile && !isApprovedDirectory) {
        throw new Error(
          `${stageLabel} evidence is outside the approved Startup manifest/runtime authority: ${relativePath}`
        );
      }
    }
  }
};

const validateChecklist = (result: Record<string, unknown>): void => {
  const checklist = asArray(result.checklist);
  const seen = new Set<string>();
  const canonicalIds = {
    findings: new Set(
      asArray(result.findings)
        .filter(isObject)
        .map((finding) => finding.id)
        .filter((id): id is string => typeof id === "string")
    ),
    unknowns: new Set(
      asArray(result.unknowns)
        .filter(isObject)
        .map((unknown) => unknown.id)
        .filter((id): id is string => typeof id === "string")
    ),
    contradictions: new Set(
      asArray(result.contradictions)
        .filter(isObject)
        .map((contradiction) => contradiction.id)
        .filter((id): id is string => typeof id === "string")
    ),
    strengths: new Set(
      asArray(result.strengths)
        .filter(isObject)
        .map((strength) => strength.id)
        .filter((id): id is string => typeof id === "string")
    )
  };

  const validateReferenceArray = (
    checkId: string,
    fieldName: string,
    value: unknown,
    validIds: Set<string>
  ): string[] => {
    const ids = asArray(value).filter((id): id is string => typeof id === "string");
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new Error(`${checkId} ${fieldName} references unknown canonical id: ${invalid}`);
    }
    return ids;
  };

  for (const item of checklist) {
    if (!isObject(item) || typeof item.check_id !== "string" || typeof item.status !== "string") {
      throw new Error("D05 checklist contains an invalid disposition record.");
    }
    if (!CHECK_ID_SET.has(item.check_id)) {
      throw new Error(`D05 checklist contains an unknown check id: ${item.check_id}`);
    }
    if (seen.has(item.check_id)) {
      throw new Error(`D05 checklist contains a duplicate check id: ${item.check_id}`);
    }
    seen.add(item.check_id);

    const evidence = asArray(item.evidence);
    const findingIds = validateReferenceArray(
      item.check_id,
      "finding_ids",
      item.finding_ids,
      canonicalIds.findings
    );
    validateReferenceArray(item.check_id, "unknown_ids", item.unknown_ids, canonicalIds.unknowns);
    validateReferenceArray(
      item.check_id,
      "contradiction_ids",
      item.contradiction_ids,
      canonicalIds.contradictions
    );
    validateReferenceArray(item.check_id, "strength_ids", item.strength_ids, canonicalIds.strengths);
    const notes = typeof item.notes === "string" ? item.notes.trim() : "";

    if (item.status === "CHECKED_OK" && evidence.length === 0) {
      throw new Error(`${item.check_id} cannot be CHECKED_OK without evidence.`);
    }
    if (item.status === "FINDING" && findingIds.length === 0) {
      throw new Error(`${item.check_id} is FINDING but is not linked to a valid finding id.`);
    }
    if (["UNKNOWN", "NOT_INSPECTED_WITH_REASON"].includes(item.status) && !notes) {
      throw new Error(`${item.check_id} requires an explicit note for status ${item.status}.`);
    }
  }

  const missing = CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`D05 checklist is incomplete; missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`);
  }
};

const validateFindingsAndStrengths = (result: Record<string, unknown>): void => {
  const findingIds = new Set<string>();
  const findingKeys = new Set<string>();

  for (const raw of asArray(result.findings)) {
    if (!isObject(raw)) throw new Error("D05 finding is not an object.");

    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const findingKey = typeof raw.finding_key === "string" ? raw.finding_key.trim() : "";
    if (!id) throw new Error("D05 finding id is required.");
    if (!findingKey) throw new Error(`D05 finding ${id} is missing finding_key.`);
    if (findingIds.has(id)) throw new Error(`D05 contains duplicate finding id: ${id}`);
    if (findingKeys.has(findingKey)) throw new Error(`D05 contains duplicate finding_key: ${findingKey}`);
    findingIds.add(id);
    findingKeys.add(findingKey);

    const evidence = asArray(raw.evidence);
    if (evidence.length === 0) {
      throw new Error(`D05 finding ${id} has no evidence.`);
    }
  }

  const strengthIds = new Set<string>();
  for (const raw of asArray(result.strengths)) {
    if (!isObject(raw)) throw new Error("D05 strength is not an object.");
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) throw new Error("D05 strength id is required.");
    if (strengthIds.has(id)) throw new Error(`D05 contains duplicate strength id: ${id}`);
    strengthIds.add(id);
    if (asArray(raw.evidence).length === 0) {
      throw new Error(`D05 strength ${id} has no evidence.`);
    }
  }
};

const summarizeCoverage = (checklist: unknown[]) => {
  const counts: Record<string, number> = {};
  for (const raw of checklist) {
    if (!isObject(raw) || typeof raw.status !== "string") continue;
    counts[raw.status] = (counts[raw.status] ?? 0) + 1;
  }
  return counts;
};

export const runSaveD05ResultJob = async (
  projectRootPath: string,
  resultInput: unknown
): Promise<Record<string, unknown>> => {
  const { manifest, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);
  const manifestPaths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
  const { completedAt, result, stageDocument } = parseAuthorizedDiscoveryStageEnvelope(resultInput, {
    auditId,
    label: "D05",
    substage: D05_NAME,
    workspaceHash: seal.workspace_hash
  });

  validateChecklist(result);
  validateFindingsAndStrengths(result);
  validateEvidence(result, manifestPaths, "D05");

  const now = new Date().toISOString();
  await writeJson(stageFile(projectRootPath, auditId), stageDocument);

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    project_overview: {
      actors_and_interfaces: result.actors_and_interfaces,
      audit_applicability: result.audit_applicability,
      components: result.components,
      configuration_model: result.configuration_model,
      contradictions: result.contradictions,
      data_and_integrations: result.data_and_integrations,
      documentation_assessment: result.documentation_assessment,
      repository_identity: result.repository_identity,
      runtime_entry_points: result.runtime_entry_points,
      scope_assessment: result.scope_assessment,
      summary: result.summary,
      technologies: result.technologies,
      unknowns: result.unknowns
    }
  });

  const findingsDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutD05 = (value: unknown): unknown[] =>
    asArray(value).filter((item) => !isObject(item) || item.origin_substage !== D05_NAME);
  const findings = asArray(result.findings).map((item) =>
    isObject(item)
      ? {
          ...item,
          first_seen_audit: auditId,
          last_seen_audit: auditId,
          origin_substage: D05_NAME
        }
      : item
  );
  const strengths = asArray(result.strengths).map((item) =>
    isObject(item)
      ? {
          ...item,
          first_seen_audit: auditId,
          last_seen_audit: auditId,
          origin_substage: D05_NAME
        }
      : item
  );
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findingsDoc,
    findings: [...withoutD05(findingsDoc.findings), ...findings],
    strengths: [...withoutD05(findingsDoc.strengths), ...strengths]
  });

  const checklist = asArray(result.checklist);
  const coverageDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const coverageStages = isObject(coverageDoc.sub_stages) ? { ...coverageDoc.sub_stages } : {};
  coverageStages[D05_NAME] = {
    checklist,
    counts: summarizeCoverage(checklist),
    result: result.result,
    summary: result.summary,
    updated_at: now
  };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverageDoc,
    sub_stages: coverageStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D05_NAME] = {
    completed_at: completedAt,
    finding_count: findings.length,
    result: result.result,
    status: result.result === "BLOCKED" ? "BLOCKED" : "COMPLETED",
    unknown_count: asArray(result.unknowns).length
  };
  const d10MetaStage = metaStages[D10_NAME];
  if (result.result !== "BLOCKED" && !isObject(d10MetaStage)) {
    metaStages[D10_NAME] = { completed_at: null, result: null, status: "READY" };
  } else if (
    result.result !== "BLOCKED" &&
    isObject(d10MetaStage) &&
    d10MetaStage.status === "WAITING_FOR_D05"
  ) {
    metaStages[D10_NAME] = { ...d10MetaStage, status: "READY" };
  }
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    sub_stages: metaStages,
    updated_at: now
  });

  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const entry = index.audits.find((item) => item.audit_id === auditId);
  if (entry) {
    entry.updated_at = now;
    entry.state = "RUNNING";
    await writeJson(auditsIndexPath(projectRootPath), index);
  }

  return {
    audit_id: auditId,
    checklist_count: checklist.length,
    finding_count: findings.length,
    result: result.result,
    saved: true,
    stage_file: `.ai-factory/020-Discovery/audits/${auditId}/stages/${D05_STAGE_FILE}`,
    unknown_count: asArray(result.unknowns).length
  };
};


const resetD10 = async (projectRootPath: string, auditId: string): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId, D10_STAGE_FILE), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  const nextProfile = { ...profile };
  delete nextProfile.architecture;
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), nextProfile);

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const filterOrigin = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== D10_NAME)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: filterOrigin(findings.findings),
    strengths: filterOrigin(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[D10_NAME];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverage,
    sub_stages: subStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D10_NAME] = { completed_at: null, result: null, status: "READY" };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });

  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D15_NAME,
    stageFileName: D15_STAGE_FILE,
    profileKey: "database",
    waitingStatus: "WAITING_FOR_D05_D10"
  });
  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D20_NAME,
    stageFileName: D20_STAGE_FILE,
    profileKey: "dependencies_integrations",
    waitingStatus: "WAITING_FOR_D05_D10"
  });
  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D25_NAME,
    stageFileName: D25_STAGE_FILE,
    profileKey: "backend",
    waitingStatus: "WAITING_FOR_D05_D10_D15_D20"
  });
};

const buildD10DiscoveryContext = (d05Result: Record<string, unknown>, auditId: string) => ({
  audit_id: auditId,
  completed_substages: [D05_NAME],
  prior_d05: {
    substage: d05Result.substage,
    result: d05Result.result,
    summary: d05Result.summary,
    repository_identity: d05Result.repository_identity,
    technologies: d05Result.technologies,
    runtime_entry_points: d05Result.runtime_entry_points,
    components: d05Result.components,
    configuration_model: d05Result.configuration_model,
    data_and_integrations: d05Result.data_and_integrations,
    actors_and_interfaces: d05Result.actors_and_interfaces,
    scope_assessment: d05Result.scope_assessment,
    audit_applicability: d05Result.audit_applicability,
    findings: d05Result.findings,
    strengths: d05Result.strengths,
    unknowns: d05Result.unknowns,
    contradictions: d05Result.contradictions,
    handoff: d05Result.handoff
  }
});

export type D10StatusResult = {
  audit_id: string;
  discovery_context: Record<string, unknown>;
  prerequisite_d05: "completed";
  scope_hash: string;
  startup_scope: Record<string, unknown>;
  startup_seal: Record<string, unknown>;
  state: "completed" | "ready";
  workspace_hash: string;
};

export const runD10StatusJob = async (
  projectRootPath: string,
  reset: boolean
): Promise<D10StatusResult> => {
  const { scope, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);
  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;

  if (!d05Result || d05Result.result === "BLOCKED") {
    throw new Error("D10 Architecture requires a completed D05 Project Overview for the same sealed workspace. Run D05 first.");
  }

  if (reset) {
    await resetD10(projectRootPath, auditId);
  }

  const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D10_STAGE_FILE));
  const result = saved && isObject(saved.result) ? saved.result : null;
  const completed = Boolean(result && result.result !== "BLOCKED");

  return {
    audit_id: auditId,
    discovery_context: {
      ...buildD10DiscoveryContext(d05Result, auditId),
      completed_substages: completed ? [D05_NAME, D10_NAME] : [D05_NAME]
    },
    prerequisite_d05: "completed",
    scope_hash: scope.scope_hash ?? seal.scope_hash,
    startup_scope: {
      approved: scope.approved,
      scope_hash: scope.scope_hash
    },
    startup_seal: {
      file_count: seal.file_count,
      manifest_hash: seal.manifest_hash,
      scope_hash: seal.scope_hash,
      status: seal.status,
      workspace_hash: seal.workspace_hash
    },
    state: completed ? "completed" : "ready",
    workspace_hash: seal.workspace_hash
  };
};

const validateD10Checklist = (result: Record<string, unknown>): void => {
  const checklist = asArray(result.checklist);
  const seen = new Set<string>();
  const canonicalIds = {
    findings: new Set(
      asArray(result.findings)
        .filter(isObject)
        .map((finding) => finding.id)
        .filter((id): id is string => typeof id === "string")
    ),
    unknowns: new Set(
      asArray(result.unknowns)
        .filter(isObject)
        .map((unknown) => unknown.id)
        .filter((id): id is string => typeof id === "string")
    ),
    contradictions: new Set(
      asArray(result.contradictions)
        .filter(isObject)
        .map((contradiction) => contradiction.id)
        .filter((id): id is string => typeof id === "string")
    ),
    strengths: new Set(
      asArray(result.strengths)
        .filter(isObject)
        .map((strength) => strength.id)
        .filter((id): id is string => typeof id === "string")
    )
  };

  const validateReferenceArray = (
    checkId: string,
    fieldName: string,
    value: unknown,
    validIds: Set<string>
  ): string[] => {
    const ids = asArray(value).filter((id): id is string => typeof id === "string");
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new Error(`${checkId} ${fieldName} references unknown canonical id: ${invalid}`);
    }
    return ids;
  };

  for (const item of checklist) {
    if (!isObject(item) || typeof item.check_id !== "string" || typeof item.status !== "string") {
      throw new Error("D10 checklist contains an invalid disposition record.");
    }
    if (!D10_CHECK_ID_SET.has(item.check_id)) {
      throw new Error(`D10 checklist contains an unknown check id: ${item.check_id}`);
    }
    if (seen.has(item.check_id)) {
      throw new Error(`D10 checklist contains a duplicate check id: ${item.check_id}`);
    }
    seen.add(item.check_id);

    const evidence = asArray(item.evidence);
    const findingIds = validateReferenceArray(item.check_id, "finding_ids", item.finding_ids, canonicalIds.findings);
    validateReferenceArray(item.check_id, "unknown_ids", item.unknown_ids, canonicalIds.unknowns);
    validateReferenceArray(item.check_id, "contradiction_ids", item.contradiction_ids, canonicalIds.contradictions);
    validateReferenceArray(item.check_id, "strength_ids", item.strength_ids, canonicalIds.strengths);
    const notes = typeof item.notes === "string" ? item.notes.trim() : "";

    if (item.status === "CHECKED_OK" && evidence.length === 0) {
      throw new Error(`${item.check_id} cannot be CHECKED_OK without evidence.`);
    }
    if (item.status === "FINDING" && findingIds.length === 0) {
      throw new Error(`${item.check_id} is FINDING but is not linked to a valid finding id.`);
    }
    if (["UNKNOWN", "NOT_INSPECTED_WITH_REASON"].includes(item.status) && !notes) {
      throw new Error(`${item.check_id} requires an explicit note for status ${item.status}.`);
    }
  }

  const missing = D10_CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`D10 checklist is incomplete; missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`);
  }
};

const validateD10CanonicalRecords = (result: Record<string, unknown>): void => {
  const findingIds = new Set<string>();
  const findingKeys = new Set<string>();
  for (const raw of asArray(result.findings)) {
    if (!isObject(raw)) throw new Error("D10 finding is not an object.");
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const findingKey = typeof raw.finding_key === "string" ? raw.finding_key.trim() : "";
    if (!/^AR-F\d{3}$/.test(id)) throw new Error(`D10 finding id must match AR-F###: ${id || "<missing>"}`);
    if (!findingKey) throw new Error(`D10 finding ${id} is missing finding_key.`);
    if (findingIds.has(id)) throw new Error(`D10 contains duplicate finding id: ${id}`);
    if (findingKeys.has(findingKey)) throw new Error(`D10 contains duplicate finding_key: ${findingKey}`);
    findingIds.add(id);
    findingKeys.add(findingKey);
    if (asArray(raw.evidence).length === 0) throw new Error(`D10 finding ${id} has no evidence.`);
  }

  const validateUniqueRecords = (field: string, pattern: RegExp): void => {
    const ids = new Set<string>();
    for (const raw of asArray(result[field])) {
      if (!isObject(raw)) throw new Error(`D10 ${field} record is not an object.`);
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!pattern.test(id)) throw new Error(`D10 ${field} id has an invalid format: ${id || "<missing>"}`);
      if (ids.has(id)) throw new Error(`D10 contains duplicate ${field} id: ${id}`);
      ids.add(id);
      if (["strengths"].includes(field) && asArray(raw.evidence).length === 0) {
        throw new Error(`D10 ${field} ${id} has no evidence.`);
      }
    }
  };

  validateUniqueRecords("strengths", /^AR-S\d{3}$/);
  validateUniqueRecords("unknowns", /^AR-U\d{3}$/);
  validateUniqueRecords("contradictions", /^AR-C\d{3}$/);
};

const validateD10Evidence = (result: Record<string, unknown>, manifestPaths: Set<string>): void => {
  validateEvidence(result, manifestPaths, "D10");
};

export const runSaveD10ResultJob = async (
  projectRootPath: string,
  resultInput: unknown
): Promise<Record<string, unknown>> => {
  const { manifest, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);
  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;
  if (!d05Result || d05Result.result === "BLOCKED") {
    throw new Error("D10 Architecture cannot be saved before D05 Project Overview is completed for this audit.");
  }

  const manifestPaths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
  const { completedAt, result, stageDocument } = parseAuthorizedDiscoveryStageEnvelope(resultInput, {
    auditId,
    label: "D10",
    substage: D10_NAME,
    workspaceHash: seal.workspace_hash
  });
  validateD10Checklist(result);
  validateD10CanonicalRecords(result);
  validateD10Evidence(result, manifestPaths);

  const now = new Date().toISOString();
  await writeJson(stageFile(projectRootPath, auditId, D10_STAGE_FILE), stageDocument);

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    architecture: {
      architecture_model: result.architecture_model,
      architecture_quality: result.architecture_quality,
      cross_cutting_concerns: result.cross_cutting_concerns,
      decision_alignment: result.decision_alignment,
      dependency_model: result.dependency_model,
      scope_assessment: result.scope_assessment,
      state_and_communication: result.state_and_communication,
      summary: result.summary,
      unknowns: result.unknowns,
      contradictions: result.contradictions
    }
  });

  const findingsDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutD10 = (value: unknown): unknown[] =>
    asArray(value).filter((item) => !isObject(item) || item.origin_substage !== D10_NAME);
  const findings = asArray(result.findings).map((item) =>
    isObject(item)
      ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D10_NAME }
      : item
  );
  const strengths = asArray(result.strengths).map((item) =>
    isObject(item)
      ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D10_NAME }
      : item
  );
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findingsDoc,
    findings: [...withoutD10(findingsDoc.findings), ...findings],
    strengths: [...withoutD10(findingsDoc.strengths), ...strengths]
  });

  const checklist = asArray(result.checklist);
  const coverageDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const coverageStages = isObject(coverageDoc.sub_stages) ? { ...coverageDoc.sub_stages } : {};
  coverageStages[D10_NAME] = {
    checklist,
    counts: summarizeCoverage(checklist),
    result: result.result,
    summary: result.summary,
    updated_at: now
  };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverageDoc,
    sub_stages: coverageStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D10_NAME] = {
    completed_at: completedAt,
    finding_count: findings.length,
    result: result.result,
    status: result.result === "BLOCKED" ? "BLOCKED" : "COMPLETED",
    unknown_count: asArray(result.unknowns).length
  };
  const d15MetaStage = metaStages[D15_NAME];
  if (result.result !== "BLOCKED" && !isObject(d15MetaStage)) {
    metaStages[D15_NAME] = { completed_at: null, result: null, status: "READY" };
  } else if (
    result.result !== "BLOCKED" &&
    isObject(d15MetaStage) &&
    d15MetaStage.status === "WAITING_FOR_D05_D10"
  ) {
    metaStages[D15_NAME] = { ...d15MetaStage, status: "READY" };
  }
  const d20MetaStage = metaStages[D20_NAME];
  if (result.result !== "BLOCKED" && !isObject(d20MetaStage)) {
    metaStages[D20_NAME] = { completed_at: null, result: null, status: "READY" };
  } else if (
    result.result !== "BLOCKED" &&
    isObject(d20MetaStage) &&
    d20MetaStage.status === "WAITING_FOR_D05_D10"
  ) {
    metaStages[D20_NAME] = { ...d20MetaStage, status: "READY" };
  }
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    sub_stages: metaStages,
    updated_at: now
  });

  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const entry = index.audits.find((item) => item.audit_id === auditId);
  if (entry) {
    entry.updated_at = now;
    entry.state = "RUNNING";
    await writeJson(auditsIndexPath(projectRootPath), index);
  }

  return {
    audit_id: auditId,
    checklist_count: checklist.length,
    finding_count: findings.length,
    result: result.result,
    saved: true,
    stage_file: `.ai-factory/020-Discovery/audits/${auditId}/stages/${D10_STAGE_FILE}`,
    unknown_count: asArray(result.unknowns).length
  };
};

const resetD15 = async (projectRootPath: string, auditId: string): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId, D15_STAGE_FILE), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  const nextProfile = { ...profile };
  delete nextProfile.database;
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), nextProfile);

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const filterOrigin = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== D15_NAME)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: filterOrigin(findings.findings),
    strengths: filterOrigin(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[D15_NAME];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverage,
    sub_stages: subStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D15_NAME] = { completed_at: null, result: null, status: "READY" };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });

  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D25_NAME,
    stageFileName: D25_STAGE_FILE,
    profileKey: "backend",
    waitingStatus: "WAITING_FOR_D05_D10_D15_D20"
  });
};

const buildD15DiscoveryContext = (
  d05Result: Record<string, unknown>,
  d10Result: Record<string, unknown>,
  auditId: string
) => ({
  audit_id: auditId,
  completed_substages: [D05_NAME, D10_NAME],
  prior_d05: {
    substage: d05Result.substage,
    result: d05Result.result,
    summary: d05Result.summary,
    technologies: d05Result.technologies,
    components: d05Result.components,
    configuration_model: d05Result.configuration_model,
    data_and_integrations: d05Result.data_and_integrations,
    scope_assessment: d05Result.scope_assessment,
    findings: d05Result.findings,
    unknowns: d05Result.unknowns,
    contradictions: d05Result.contradictions,
    handoff: d05Result.handoff
  },
  prior_d10: {
    substage: d10Result.substage,
    result: d10Result.result,
    summary: d10Result.summary,
    architecture_model: d10Result.architecture_model,
    dependency_model: d10Result.dependency_model,
    state_and_communication: d10Result.state_and_communication,
    cross_cutting_concerns: d10Result.cross_cutting_concerns,
    architecture_quality: d10Result.architecture_quality,
    scope_assessment: d10Result.scope_assessment,
    findings: d10Result.findings,
    unknowns: d10Result.unknowns,
    contradictions: d10Result.contradictions,
    handoff: d10Result.handoff
  }
});

export type D15StatusResult = {
  audit_id: string;
  discovery_context: Record<string, unknown>;
  prerequisite_d05: "completed";
  prerequisite_d10: "completed";
  scope_hash: string;
  startup_scope: Record<string, unknown>;
  startup_seal: Record<string, unknown>;
  state: "completed" | "ready";
  workspace_hash: string;
};

export const runD15StatusJob = async (
  projectRootPath: string,
  reset: boolean
): Promise<D15StatusResult> => {
  const { scope, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);

  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;
  if (!d05Result || d05Result.result === "BLOCKED") {
    throw new Error("D15 Database requires a completed D05 Project Overview for the same sealed workspace. Run D05 first.");
  }

  const d10Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D10_STAGE_FILE));
  const d10Result = d10Saved && isObject(d10Saved.result) ? d10Saved.result : null;
  if (!d10Result || d10Result.result === "BLOCKED") {
    throw new Error("D15 Database requires a completed D10 Architecture for the same sealed workspace. Run D10 first.");
  }

  if (reset) {
    await resetD15(projectRootPath, auditId);
  }

  const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D15_STAGE_FILE));
  const result = saved && isObject(saved.result) ? saved.result : null;
  const completed = Boolean(result && result.result !== "BLOCKED");

  return {
    audit_id: auditId,
    discovery_context: {
      ...buildD15DiscoveryContext(d05Result, d10Result, auditId),
      completed_substages: completed ? [D05_NAME, D10_NAME, D15_NAME] : [D05_NAME, D10_NAME]
    },
    prerequisite_d05: "completed",
    prerequisite_d10: "completed",
    scope_hash: scope.scope_hash ?? seal.scope_hash,
    startup_scope: {
      approved: scope.approved,
      scope_hash: scope.scope_hash
    },
    startup_seal: {
      file_count: seal.file_count,
      manifest_hash: seal.manifest_hash,
      scope_hash: seal.scope_hash,
      status: seal.status,
      workspace_hash: seal.workspace_hash
    },
    state: completed ? "completed" : "ready",
    workspace_hash: seal.workspace_hash
  };
};

const validateD15Checklist = (result: Record<string, unknown>): void => {
  const checklist = asArray(result.checklist);
  const seen = new Set<string>();
  const canonicalIds = {
    findings: new Set(asArray(result.findings).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    unknowns: new Set(asArray(result.unknowns).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    contradictions: new Set(asArray(result.contradictions).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    strengths: new Set(asArray(result.strengths).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string"))
  };

  const validateReferenceArray = (checkId: string, fieldName: string, value: unknown, validIds: Set<string>): string[] => {
    const ids = asArray(value).filter((id): id is string => typeof id === "string");
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) throw new Error(`${checkId} ${fieldName} references unknown canonical id: ${invalid}`);
    return ids;
  };

  for (const item of checklist) {
    if (!isObject(item) || typeof item.check_id !== "string" || typeof item.status !== "string") {
      throw new Error("D15 checklist contains an invalid disposition record.");
    }
    if (!D15_CHECK_ID_SET.has(item.check_id)) throw new Error(`D15 checklist contains an unknown check id: ${item.check_id}`);
    if (seen.has(item.check_id)) throw new Error(`D15 checklist contains a duplicate check id: ${item.check_id}`);
    seen.add(item.check_id);

    const evidence = asArray(item.evidence);
    const findingIds = validateReferenceArray(item.check_id, "finding_ids", item.finding_ids, canonicalIds.findings);
    validateReferenceArray(item.check_id, "unknown_ids", item.unknown_ids, canonicalIds.unknowns);
    validateReferenceArray(item.check_id, "contradiction_ids", item.contradiction_ids, canonicalIds.contradictions);
    validateReferenceArray(item.check_id, "strength_ids", item.strength_ids, canonicalIds.strengths);
    const notes = typeof item.notes === "string" ? item.notes.trim() : "";

    if (item.status === "CHECKED_OK" && evidence.length === 0) throw new Error(`${item.check_id} cannot be CHECKED_OK without evidence.`);
    if (item.status === "FINDING" && findingIds.length === 0) throw new Error(`${item.check_id} is FINDING but is not linked to a valid finding id.`);
    if (["UNKNOWN", "NOT_INSPECTED_WITH_REASON"].includes(item.status) && !notes) {
      throw new Error(`${item.check_id} requires an explicit note for status ${item.status}.`);
    }
  }

  const missing = D15_CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`D15 checklist is incomplete; missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`);
  }
};

const validateD15CanonicalRecords = (result: Record<string, unknown>): void => {
  const findingIds = new Set<string>();
  const findingKeys = new Set<string>();
  for (const raw of asArray(result.findings)) {
    if (!isObject(raw)) throw new Error("D15 finding is not an object.");
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const findingKey = typeof raw.finding_key === "string" ? raw.finding_key.trim() : "";
    if (!/^DB-F\d{3}$/.test(id)) throw new Error(`D15 finding id must match DB-F###: ${id || "<missing>"}`);
    if (!findingKey) throw new Error(`D15 finding ${id} is missing finding_key.`);
    if (findingIds.has(id)) throw new Error(`D15 contains duplicate finding id: ${id}`);
    if (findingKeys.has(findingKey)) throw new Error(`D15 contains duplicate finding_key: ${findingKey}`);
    findingIds.add(id); findingKeys.add(findingKey);
    if (asArray(raw.evidence).length === 0) throw new Error(`D15 finding ${id} has no evidence.`);
  }

  const validateUniqueRecords = (field: string, pattern: RegExp): void => {
    const ids = new Set<string>();
    for (const raw of asArray(result[field])) {
      if (!isObject(raw)) throw new Error(`D15 ${field} record is not an object.`);
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!pattern.test(id)) throw new Error(`D15 ${field} id has an invalid format: ${id || "<missing>"}`);
      if (ids.has(id)) throw new Error(`D15 contains duplicate ${field} id: ${id}`);
      ids.add(id);
      if (field === "strengths" && asArray(raw.evidence).length === 0) throw new Error(`D15 ${field} ${id} has no evidence.`);
    }
  };
  validateUniqueRecords("strengths", /^DB-S\d{3}$/);
  validateUniqueRecords("unknowns", /^DB-U\d{3}$/);
  validateUniqueRecords("contradictions", /^DB-C\d{3}$/);
};

const validateD15Evidence = (result: Record<string, unknown>, manifestPaths: Set<string>): void => {
  validateEvidence(result, manifestPaths, "D15");
};

export const runSaveD15ResultJob = async (
  projectRootPath: string,
  resultInput: unknown
): Promise<Record<string, unknown>> => {
  const { manifest, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);

  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;
  if (!d05Result || d05Result.result === "BLOCKED") throw new Error("D15 Database cannot be saved before D05 is completed.");
  const d10Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D10_STAGE_FILE));
  const d10Result = d10Saved && isObject(d10Saved.result) ? d10Saved.result : null;
  if (!d10Result || d10Result.result === "BLOCKED") throw new Error("D15 Database cannot be saved before D10 is completed.");

  const manifestPaths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
  const { completedAt, result, stageDocument } = parseAuthorizedDiscoveryStageEnvelope(resultInput, {
    auditId,
    label: "D15",
    substage: D15_NAME,
    workspaceHash: seal.workspace_hash
  });
  validateD15Checklist(result);
  validateD15CanonicalRecords(result);
  validateD15Evidence(result, manifestPaths);

  const now = new Date().toISOString();
  await writeJson(stageFile(projectRootPath, auditId, D15_STAGE_FILE), stageDocument);

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    database: {
      database_model: result.database_model,
      schema_model: result.schema_model,
      migration_model: result.migration_model,
      access_model: result.access_model,
      consistency_and_transactions: result.consistency_and_transactions,
      data_lifecycle: result.data_lifecycle,
      database_quality: result.database_quality,
      scope_assessment: result.scope_assessment,
      summary: result.summary,
      unknowns: result.unknowns,
      contradictions: result.contradictions
    }
  });

  const findingsDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutD15 = (value: unknown): unknown[] => asArray(value).filter((item) => !isObject(item) || item.origin_substage !== D15_NAME);
  const findings = asArray(result.findings).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D15_NAME } : item);
  const strengths = asArray(result.strengths).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D15_NAME } : item);
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findingsDoc,
    findings: [...withoutD15(findingsDoc.findings), ...findings],
    strengths: [...withoutD15(findingsDoc.strengths), ...strengths]
  });

  const checklist = asArray(result.checklist);
  const coverageDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const coverageStages = isObject(coverageDoc.sub_stages) ? { ...coverageDoc.sub_stages } : {};
  coverageStages[D15_NAME] = { checklist, counts: summarizeCoverage(checklist), result: result.result, summary: result.summary, updated_at: now };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), { ...coverageDoc, sub_stages: coverageStages });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D15_NAME] = { completed_at: completedAt, finding_count: findings.length, result: result.result, status: result.result === "BLOCKED" ? "BLOCKED" : "COMPLETED", unknown_count: asArray(result.unknowns).length };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), { ...meta, sub_stages: metaStages, updated_at: now });

  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const entry = index.audits.find((item) => item.audit_id === auditId);
  if (entry) { entry.updated_at = now; entry.state = "RUNNING"; await writeJson(auditsIndexPath(projectRootPath), index); }

  return {
    audit_id: auditId,
    checklist_count: checklist.length,
    finding_count: findings.length,
    result: result.result,
    saved: true,
    stage_file: `.ai-factory/020-Discovery/audits/${auditId}/stages/${D15_STAGE_FILE}`,
    unknown_count: asArray(result.unknowns).length
  };
};

const resetD20 = async (projectRootPath: string, auditId: string): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId, D20_STAGE_FILE), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  const nextProfile = { ...profile };
  delete nextProfile.dependencies_integrations;
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), nextProfile);

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const filterOrigin = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== D20_NAME)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: filterOrigin(findings.findings),
    strengths: filterOrigin(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[D20_NAME];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), {
    ...coverage,
    sub_stages: subStages
  });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D20_NAME] = { completed_at: null, result: null, status: "READY" };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });

  await invalidateDependentStage(projectRootPath, auditId, {
    stageName: D25_NAME,
    stageFileName: D25_STAGE_FILE,
    profileKey: "backend",
    waitingStatus: "WAITING_FOR_D05_D10_D15_D20"
  });
};

const buildD20DiscoveryContext = (
  d05Result: Record<string, unknown>,
  d10Result: Record<string, unknown>,
  auditId: string
) => ({
  audit_id: auditId,
  completed_substages: [D05_NAME, D10_NAME],
  prior_d05: {
    substage: d05Result.substage,
    result: d05Result.result,
    summary: d05Result.summary,
    technologies: d05Result.technologies,
    components: d05Result.components,
    configuration_model: d05Result.configuration_model,
    data_and_integrations: d05Result.data_and_integrations,
    scope_assessment: d05Result.scope_assessment,
    findings: d05Result.findings,
    unknowns: d05Result.unknowns,
    contradictions: d05Result.contradictions,
    handoff: d05Result.handoff
  },
  prior_d10: {
    substage: d10Result.substage,
    result: d10Result.result,
    summary: d10Result.summary,
    architecture_model: d10Result.architecture_model,
    dependency_model: d10Result.dependency_model,
    state_and_communication: d10Result.state_and_communication,
    cross_cutting_concerns: d10Result.cross_cutting_concerns,
    architecture_quality: d10Result.architecture_quality,
    scope_assessment: d10Result.scope_assessment,
    findings: d10Result.findings,
    unknowns: d10Result.unknowns,
    contradictions: d10Result.contradictions,
    handoff: d10Result.handoff
  }
});

export type D20StatusResult = {
  audit_id: string;
  discovery_context: Record<string, unknown>;
  prerequisite_d05: "completed";
  prerequisite_d10: "completed";
  scope_hash: string;
  startup_scope: Record<string, unknown>;
  startup_seal: Record<string, unknown>;
  state: "completed" | "ready";
  workspace_hash: string;
};

export const runD20StatusJob = async (
  projectRootPath: string,
  reset: boolean
): Promise<D20StatusResult> => {
  const { scope, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);

  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;
  if (!d05Result || d05Result.result === "BLOCKED") {
    throw new Error("D20 Dependencies / Integrations requires a completed D05 Project Overview for the same sealed workspace. Run D05 first.");
  }

  const d10Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D10_STAGE_FILE));
  const d10Result = d10Saved && isObject(d10Saved.result) ? d10Saved.result : null;
  if (!d10Result || d10Result.result === "BLOCKED") {
    throw new Error("D20 Dependencies / Integrations requires a completed D10 Architecture for the same sealed workspace. Run D10 first.");
  }

  if (reset) await resetD20(projectRootPath, auditId);

  const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D20_STAGE_FILE));
  const result = saved && isObject(saved.result) ? saved.result : null;
  const completed = Boolean(result && result.result !== "BLOCKED");

  return {
    audit_id: auditId,
    discovery_context: {
      ...buildD20DiscoveryContext(d05Result, d10Result, auditId),
      completed_substages: completed ? [D05_NAME, D10_NAME, D20_NAME] : [D05_NAME, D10_NAME]
    },
    prerequisite_d05: "completed",
    prerequisite_d10: "completed",
    scope_hash: scope.scope_hash ?? seal.scope_hash,
    startup_scope: { approved: scope.approved, scope_hash: scope.scope_hash },
    startup_seal: {
      file_count: seal.file_count,
      manifest_hash: seal.manifest_hash,
      scope_hash: seal.scope_hash,
      status: seal.status,
      workspace_hash: seal.workspace_hash
    },
    state: completed ? "completed" : "ready",
    workspace_hash: seal.workspace_hash
  };
};

const validateD20Checklist = (result: Record<string, unknown>): void => {
  const checklist = asArray(result.checklist);
  const seen = new Set<string>();
  const canonicalIds = {
    findings: new Set(asArray(result.findings).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    unknowns: new Set(asArray(result.unknowns).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    contradictions: new Set(asArray(result.contradictions).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    strengths: new Set(asArray(result.strengths).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string"))
  };
  const validateReferenceArray = (checkId: string, fieldName: string, value: unknown, validIds: Set<string>): string[] => {
    const ids = asArray(value).filter((id): id is string => typeof id === "string");
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) throw new Error(`${checkId} ${fieldName} references unknown canonical id: ${invalid}`);
    return ids;
  };

  for (const item of checklist) {
    if (!isObject(item) || typeof item.check_id !== "string" || typeof item.status !== "string") {
      throw new Error("D20 checklist contains an invalid disposition record.");
    }
    if (!D20_CHECK_ID_SET.has(item.check_id)) throw new Error(`D20 checklist contains an unknown check id: ${item.check_id}`);
    if (seen.has(item.check_id)) throw new Error(`D20 checklist contains a duplicate check id: ${item.check_id}`);
    seen.add(item.check_id);
    const evidence = asArray(item.evidence);
    const findingIds = validateReferenceArray(item.check_id, "finding_ids", item.finding_ids, canonicalIds.findings);
    validateReferenceArray(item.check_id, "unknown_ids", item.unknown_ids, canonicalIds.unknowns);
    validateReferenceArray(item.check_id, "contradiction_ids", item.contradiction_ids, canonicalIds.contradictions);
    validateReferenceArray(item.check_id, "strength_ids", item.strength_ids, canonicalIds.strengths);
    const notes = typeof item.notes === "string" ? item.notes.trim() : "";
    if (item.status === "CHECKED_OK" && evidence.length === 0) throw new Error(`${item.check_id} cannot be CHECKED_OK without evidence.`);
    if (item.status === "FINDING" && findingIds.length === 0) throw new Error(`${item.check_id} is FINDING but is not linked to a valid finding id.`);
    if (["UNKNOWN", "NOT_INSPECTED_WITH_REASON"].includes(item.status) && !notes) throw new Error(`${item.check_id} requires an explicit note for status ${item.status}.`);
  }
  const missing = D20_CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`D20 checklist is incomplete; missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`);
};

const validateD20CanonicalRecords = (result: Record<string, unknown>): void => {
  const findingIds = new Set<string>();
  const findingKeys = new Set<string>();
  for (const raw of asArray(result.findings)) {
    if (!isObject(raw)) throw new Error("D20 finding is not an object.");
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const findingKey = typeof raw.finding_key === "string" ? raw.finding_key.trim() : "";
    if (!/^DI-F\d{3}$/.test(id)) throw new Error(`D20 finding id must match DI-F###: ${id || "<missing>"}`);
    if (!findingKey) throw new Error(`D20 finding ${id} is missing finding_key.`);
    if (findingIds.has(id)) throw new Error(`D20 contains duplicate finding id: ${id}`);
    if (findingKeys.has(findingKey)) throw new Error(`D20 contains duplicate finding_key: ${findingKey}`);
    findingIds.add(id); findingKeys.add(findingKey);
    if (asArray(raw.evidence).length === 0) throw new Error(`D20 finding ${id} has no evidence.`);
  }
  const validateUniqueRecords = (field: string, pattern: RegExp): void => {
    const ids = new Set<string>();
    for (const raw of asArray(result[field])) {
      if (!isObject(raw)) throw new Error(`D20 ${field} record is not an object.`);
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!pattern.test(id)) throw new Error(`D20 ${field} id has an invalid format: ${id || "<missing>"}`);
      if (ids.has(id)) throw new Error(`D20 contains duplicate ${field} id: ${id}`);
      ids.add(id);
      if (field === "strengths" && asArray(raw.evidence).length === 0) throw new Error(`D20 ${field} ${id} has no evidence.`);
    }
  };
  validateUniqueRecords("strengths", /^DI-S\d{3}$/);
  validateUniqueRecords("unknowns", /^DI-U\d{3}$/);
  validateUniqueRecords("contradictions", /^DI-C\d{3}$/);
};

const validateD20Evidence = (result: Record<string, unknown>, manifestPaths: Set<string>): void => {
  validateEvidence(result, manifestPaths, "D20");
};

export const runSaveD20ResultJob = async (
  projectRootPath: string,
  resultInput: unknown
): Promise<Record<string, unknown>> => {
  const { manifest, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);
  const d05Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D05_STAGE_FILE));
  const d05Result = d05Saved && isObject(d05Saved.result) ? d05Saved.result : null;
  if (!d05Result || d05Result.result === "BLOCKED") throw new Error("D20 Dependencies / Integrations cannot be saved before D05 is completed.");
  const d10Saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D10_STAGE_FILE));
  const d10Result = d10Saved && isObject(d10Saved.result) ? d10Saved.result : null;
  if (!d10Result || d10Result.result === "BLOCKED") throw new Error("D20 Dependencies / Integrations cannot be saved before D10 is completed.");

  const manifestPaths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
  const { completedAt, result, stageDocument } = parseAuthorizedDiscoveryStageEnvelope(resultInput, {
    auditId,
    label: "D20",
    substage: D20_NAME,
    workspaceHash: seal.workspace_hash
  });
  validateD20Checklist(result);
  validateD20CanonicalRecords(result);
  validateD20Evidence(result, manifestPaths);

  const now = new Date().toISOString();
  await writeJson(stageFile(projectRootPath, auditId, D20_STAGE_FILE), stageDocument);

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    dependencies_integrations: {
      dependency_model: result.dependency_model,
      integration_model: result.integration_model,
      usage_model: result.usage_model,
      version_and_resolution: result.version_and_resolution,
      failure_and_resilience: result.failure_and_resilience,
      coupling_model: result.coupling_model,
      embedded_vendor_model: result.embedded_vendor_model,
      dependency_quality: result.dependency_quality,
      scope_assessment: result.scope_assessment,
      summary: result.summary,
      unknowns: result.unknowns,
      contradictions: result.contradictions
    }
  });

  const findingsDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutD20 = (value: unknown): unknown[] => asArray(value).filter((item) => !isObject(item) || item.origin_substage !== D20_NAME);
  const findings = asArray(result.findings).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D20_NAME } : item);
  const strengths = asArray(result.strengths).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D20_NAME } : item);
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findingsDoc,
    findings: [...withoutD20(findingsDoc.findings), ...findings],
    strengths: [...withoutD20(findingsDoc.strengths), ...strengths]
  });

  const checklist = asArray(result.checklist);
  const coverageDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const coverageStages = isObject(coverageDoc.sub_stages) ? { ...coverageDoc.sub_stages } : {};
  coverageStages[D20_NAME] = { checklist, counts: summarizeCoverage(checklist), result: result.result, summary: result.summary, updated_at: now };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), { ...coverageDoc, sub_stages: coverageStages });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D20_NAME] = { completed_at: completedAt, finding_count: findings.length, result: result.result, status: result.result === "BLOCKED" ? "BLOCKED" : "COMPLETED", unknown_count: asArray(result.unknowns).length };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), { ...meta, sub_stages: metaStages, updated_at: now });

  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const entry = index.audits.find((item) => item.audit_id === auditId);
  if (entry) { entry.updated_at = now; entry.state = "RUNNING"; await writeJson(auditsIndexPath(projectRootPath), index); }

  return {
    audit_id: auditId,
    checklist_count: checklist.length,
    finding_count: findings.length,
    result: result.result,
    saved: true,
    stage_file: `.ai-factory/020-Discovery/audits/${auditId}/stages/${D20_STAGE_FILE}`,
    unknown_count: asArray(result.unknowns).length
  };
};

const resetD25 = async (projectRootPath: string, auditId: string): Promise<void> => {
  await rm(stageFile(projectRootPath, auditId, D25_STAGE_FILE), { force: true });

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  const nextProfile = { ...profile };
  delete nextProfile.backend;
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), nextProfile);

  const findings = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const filterOrigin = (value: unknown): unknown[] =>
    Array.isArray(value)
      ? value.filter((item) => !isObject(item) || item.origin_substage !== D25_NAME)
      : [];
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findings,
    findings: filterOrigin(findings.findings),
    strengths: filterOrigin(findings.strengths)
  });

  const coverage = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const subStages = isObject(coverage.sub_stages) ? { ...coverage.sub_stages } : {};
  delete subStages[D25_NAME];
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), { ...coverage, sub_stages: subStages });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D25_NAME] = { completed_at: null, result: null, status: "READY" };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), {
    ...meta,
    final_state: "RUNNING",
    sub_stages: metaStages,
    updated_at: new Date().toISOString()
  });
};

const buildD25DiscoveryContext = (
  d05Result: Record<string, unknown>,
  d10Result: Record<string, unknown>,
  d15Result: Record<string, unknown>,
  d20Result: Record<string, unknown>,
  auditId: string
) => ({
  audit_id: auditId,
  completed_substages: [D05_NAME, D10_NAME, D15_NAME, D20_NAME],
  prior_d05: {
    substage: d05Result.substage,
    result: d05Result.result,
    summary: d05Result.summary,
    runtime_entry_points: d05Result.runtime_entry_points,
    components: d05Result.components,
    configuration_model: d05Result.configuration_model,
    actors_and_interfaces: d05Result.actors_and_interfaces,
    scope_assessment: d05Result.scope_assessment,
    findings: d05Result.findings,
    unknowns: d05Result.unknowns,
    contradictions: d05Result.contradictions
  },
  prior_d10: {
    substage: d10Result.substage,
    result: d10Result.result,
    summary: d10Result.summary,
    architecture_model: d10Result.architecture_model,
    dependency_model: d10Result.dependency_model,
    state_and_communication: d10Result.state_and_communication,
    cross_cutting_concerns: d10Result.cross_cutting_concerns,
    architecture_quality: d10Result.architecture_quality,
    scope_assessment: d10Result.scope_assessment,
    findings: d10Result.findings,
    unknowns: d10Result.unknowns,
    contradictions: d10Result.contradictions
  },
  prior_d15: {
    substage: d15Result.substage,
    result: d15Result.result,
    summary: d15Result.summary,
    database_model: d15Result.database_model,
    schema_model: d15Result.schema_model,
    migration_model: d15Result.migration_model,
    access_model: d15Result.access_model,
    consistency_and_transactions: d15Result.consistency_and_transactions,
    data_lifecycle: d15Result.data_lifecycle,
    scope_assessment: d15Result.scope_assessment,
    findings: d15Result.findings,
    unknowns: d15Result.unknowns,
    contradictions: d15Result.contradictions
  },
  prior_d20: {
    substage: d20Result.substage,
    result: d20Result.result,
    summary: d20Result.summary,
    dependency_model: d20Result.dependency_model,
    integration_model: d20Result.integration_model,
    usage_model: d20Result.usage_model,
    failure_and_resilience: d20Result.failure_and_resilience,
    coupling_model: d20Result.coupling_model,
    scope_assessment: d20Result.scope_assessment,
    findings: d20Result.findings,
    unknowns: d20Result.unknowns,
    contradictions: d20Result.contradictions
  }
});

export type D25StatusResult = {
  audit_id: string;
  discovery_context: Record<string, unknown>;
  prerequisite_d05: "completed";
  prerequisite_d10: "completed";
  prerequisite_d15: "completed";
  prerequisite_d20: "completed";
  scope_hash: string;
  startup_scope: Record<string, unknown>;
  startup_seal: Record<string, unknown>;
  state: "completed" | "ready";
  workspace_hash: string;
};

export const runD25StatusJob = async (
  projectRootPath: string,
  reset: boolean
): Promise<D25StatusResult> => {
  const { scope, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);

  const readCompleted = async (file: string, label: string): Promise<Record<string, unknown>> => {
    const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, file));
    const result = saved && isObject(saved.result) ? saved.result : null;
    if (!result || result.result === "BLOCKED") {
      throw new Error(`D25 Backend requires completed ${label} for the same sealed workspace.`);
    }
    return result;
  };
  const d05Result = await readCompleted(D05_STAGE_FILE, "D05 Project Overview");
  const d10Result = await readCompleted(D10_STAGE_FILE, "D10 Architecture");
  const d15Result = await readCompleted(D15_STAGE_FILE, "D15 Database");
  const d20Result = await readCompleted(D20_STAGE_FILE, "D20 Dependencies / Integrations");

  if (reset) await resetD25(projectRootPath, auditId);

  const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, D25_STAGE_FILE));
  const result = saved && isObject(saved.result) ? saved.result : null;
  const completed = Boolean(result && result.result !== "BLOCKED");

  return {
    audit_id: auditId,
    discovery_context: {
      ...buildD25DiscoveryContext(d05Result, d10Result, d15Result, d20Result, auditId),
      completed_substages: completed
        ? [D05_NAME, D10_NAME, D15_NAME, D20_NAME, D25_NAME]
        : [D05_NAME, D10_NAME, D15_NAME, D20_NAME]
    },
    prerequisite_d05: "completed",
    prerequisite_d10: "completed",
    prerequisite_d15: "completed",
    prerequisite_d20: "completed",
    scope_hash: scope.scope_hash ?? seal.scope_hash,
    startup_scope: { approved: scope.approved, scope_hash: scope.scope_hash },
    startup_seal: {
      file_count: seal.file_count,
      manifest_hash: seal.manifest_hash,
      scope_hash: seal.scope_hash,
      status: seal.status,
      workspace_hash: seal.workspace_hash
    },
    state: completed ? "completed" : "ready",
    workspace_hash: seal.workspace_hash
  };
};

const validateD25Checklist = (result: Record<string, unknown>): void => {
  const checklist = asArray(result.checklist);
  const seen = new Set<string>();
  const canonicalIds = {
    findings: new Set(asArray(result.findings).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    unknowns: new Set(asArray(result.unknowns).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    contradictions: new Set(asArray(result.contradictions).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string")),
    strengths: new Set(asArray(result.strengths).filter(isObject).map((x) => x.id).filter((id): id is string => typeof id === "string"))
  };
  const validateReferenceArray = (checkId: string, fieldName: string, value: unknown, validIds: Set<string>): string[] => {
    const ids = asArray(value).filter((id): id is string => typeof id === "string");
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) throw new Error(`${checkId} ${fieldName} references unknown canonical id: ${invalid}`);
    return ids;
  };

  for (const item of checklist) {
    if (!isObject(item) || typeof item.check_id !== "string" || typeof item.status !== "string") {
      throw new Error("D25 checklist contains an invalid disposition record.");
    }
    if (!D25_CHECK_ID_SET.has(item.check_id)) throw new Error(`D25 checklist contains an unknown check id: ${item.check_id}`);
    if (seen.has(item.check_id)) throw new Error(`D25 checklist contains a duplicate check id: ${item.check_id}`);
    seen.add(item.check_id);
    const evidence = asArray(item.evidence);
    const findingIds = validateReferenceArray(item.check_id, "finding_ids", item.finding_ids, canonicalIds.findings);
    validateReferenceArray(item.check_id, "unknown_ids", item.unknown_ids, canonicalIds.unknowns);
    validateReferenceArray(item.check_id, "contradiction_ids", item.contradiction_ids, canonicalIds.contradictions);
    validateReferenceArray(item.check_id, "strength_ids", item.strength_ids, canonicalIds.strengths);
    const notes = typeof item.notes === "string" ? item.notes.trim() : "";
    if (item.status === "CHECKED_OK" && evidence.length === 0) throw new Error(`${item.check_id} cannot be CHECKED_OK without evidence.`);
    if (item.status === "FINDING" && findingIds.length === 0) throw new Error(`${item.check_id} is FINDING but is not linked to a valid finding id.`);
    if (["UNKNOWN", "NOT_INSPECTED_WITH_REASON"].includes(item.status) && !notes) throw new Error(`${item.check_id} requires an explicit note for status ${item.status}.`);
  }
  const missing = D25_CHECK_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`D25 checklist is incomplete; missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "..." : ""}`);
};

const validateD25CanonicalRecords = (result: Record<string, unknown>): void => {
  const findingIds = new Set<string>();
  const findingKeys = new Set<string>();
  for (const raw of asArray(result.findings)) {
    if (!isObject(raw)) throw new Error("D25 finding is not an object.");
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const findingKey = typeof raw.finding_key === "string" ? raw.finding_key.trim() : "";
    if (!/^BE-F\d{3}$/.test(id)) throw new Error(`D25 finding id must match BE-F###: ${id || "<missing>"}`);
    if (!findingKey) throw new Error(`D25 finding ${id} is missing finding_key.`);
    if (findingIds.has(id)) throw new Error(`D25 contains duplicate finding id: ${id}`);
    if (findingKeys.has(findingKey)) throw new Error(`D25 contains duplicate finding_key: ${findingKey}`);
    findingIds.add(id); findingKeys.add(findingKey);
    if (asArray(raw.evidence).length === 0) throw new Error(`D25 finding ${id} has no evidence.`);
  }
  const validateUniqueRecords = (field: string, pattern: RegExp): void => {
    const ids = new Set<string>();
    for (const raw of asArray(result[field])) {
      if (!isObject(raw)) throw new Error(`D25 ${field} record is not an object.`);
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!pattern.test(id)) throw new Error(`D25 ${field} id has an invalid format: ${id || "<missing>"}`);
      if (ids.has(id)) throw new Error(`D25 contains duplicate ${field} id: ${id}`);
      ids.add(id);
      if (field === "strengths" && asArray(raw.evidence).length === 0) throw new Error(`D25 ${field} ${id} has no evidence.`);
    }
  };
  validateUniqueRecords("strengths", /^BE-S\d{3}$/);
  validateUniqueRecords("unknowns", /^BE-U\d{3}$/);
  validateUniqueRecords("contradictions", /^BE-C\d{3}$/);
};

const validateD25Evidence = (result: Record<string, unknown>, manifestPaths: Set<string>): void => {
  validateEvidence(result, manifestPaths, "D25");
};

export const runSaveD25ResultJob = async (
  projectRootPath: string,
  resultInput: unknown
): Promise<Record<string, unknown>> => {
  const { manifest, seal } = await readStartupAuthority(projectRootPath);
  const auditId = await ensureAudit(projectRootPath, seal.scope_hash, seal.workspace_hash);
  for (const [file, label] of [
    [D05_STAGE_FILE, "D05 Project Overview"],
    [D10_STAGE_FILE, "D10 Architecture"],
    [D15_STAGE_FILE, "D15 Database"],
    [D20_STAGE_FILE, "D20 Dependencies / Integrations"]
  ] as const) {
    const saved = await readJsonIfPresent(stageFile(projectRootPath, auditId, file));
    const prior = saved && isObject(saved.result) ? saved.result : null;
    if (!prior || prior.result === "BLOCKED") throw new Error(`D25 Backend cannot be saved before ${label} is completed.`);
  }

  const manifestPaths = new Set(manifest.files.map((file) => file.path.replaceAll("\\", "/")));
  const { completedAt, result, stageDocument } = parseAuthorizedDiscoveryStageEnvelope(resultInput, {
    auditId,
    label: "D25",
    substage: D25_NAME,
    workspaceHash: seal.workspace_hash
  });
  validateD25Checklist(result);
  validateD25CanonicalRecords(result);
  validateD25Evidence(result, manifestPaths);

  const now = new Date().toISOString();
  await writeJson(stageFile(projectRootPath, auditId, D25_STAGE_FILE), stageDocument);

  const profile = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"))) ?? {};
  await writeJson(auditFile(projectRootPath, auditId, "PROJECT_PROFILE.json"), {
    ...profile,
    backend: {
      backend_surface: result.backend_surface,
      request_handling_model: result.request_handling_model,
      application_logic_model: result.application_logic_model,
      validation_model: result.validation_model,
      access_control_model: result.access_control_model,
      data_interaction_model: result.data_interaction_model,
      state_change_model: result.state_change_model,
      error_and_result_model: result.error_and_result_model,
      async_and_side_effect_model: result.async_and_side_effect_model,
      backend_quality: result.backend_quality,
      scope_assessment: result.scope_assessment,
      summary: result.summary,
      unknowns: result.unknowns,
      contradictions: result.contradictions
    }
  });

  const findingsDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "FINDINGS.json"))) ?? {};
  const withoutD25 = (value: unknown): unknown[] => asArray(value).filter((item) => !isObject(item) || item.origin_substage !== D25_NAME);
  const findings = asArray(result.findings).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D25_NAME } : item);
  const strengths = asArray(result.strengths).map((item) => isObject(item) ? { ...item, first_seen_audit: auditId, last_seen_audit: auditId, origin_substage: D25_NAME } : item);
  await writeJson(auditFile(projectRootPath, auditId, "FINDINGS.json"), {
    ...findingsDoc,
    findings: [...withoutD25(findingsDoc.findings), ...findings],
    strengths: [...withoutD25(findingsDoc.strengths), ...strengths]
  });

  const checklist = asArray(result.checklist);
  const coverageDoc = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"))) ?? {};
  const coverageStages = isObject(coverageDoc.sub_stages) ? { ...coverageDoc.sub_stages } : {};
  coverageStages[D25_NAME] = { checklist, counts: summarizeCoverage(checklist), result: result.result, summary: result.summary, updated_at: now };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_COVERAGE.json"), { ...coverageDoc, sub_stages: coverageStages });

  const meta = (await readJsonIfPresent(auditFile(projectRootPath, auditId, "AUDIT_META.json"))) ?? {};
  const metaStages = isObject(meta.sub_stages) ? { ...meta.sub_stages } : {};
  metaStages[D25_NAME] = { completed_at: completedAt, finding_count: findings.length, result: result.result, status: result.result === "BLOCKED" ? "BLOCKED" : "COMPLETED", unknown_count: asArray(result.unknowns).length };
  await writeJson(auditFile(projectRootPath, auditId, "AUDIT_META.json"), { ...meta, sub_stages: metaStages, updated_at: now });

  const index = parseAuditIndex(await readJsonIfPresent(auditsIndexPath(projectRootPath)));
  const entry = index.audits.find((item) => item.audit_id === auditId);
  if (entry) { entry.updated_at = now; entry.state = "RUNNING"; await writeJson(auditsIndexPath(projectRootPath), index); }

  return {
    audit_id: auditId,
    checklist_count: checklist.length,
    finding_count: findings.length,
    result: result.result,
    saved: true,
    stage_file: `.ai-factory/020-Discovery/audits/${auditId}/stages/${D25_STAGE_FILE}`,
    unknown_count: asArray(result.unknowns).length
  };
};

