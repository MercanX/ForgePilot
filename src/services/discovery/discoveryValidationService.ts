import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { extractCanonicalText, type FileFormat } from "./discoveryJobService";
import {
  loadDiscoveryRuntimePayload,
  removeDiscoveryRuntimePayload,
  saveDiscoveryRuntimePayload
} from "./discoveryRuntimeStore";
import {
  DISCOVERY_CONTRACT_VERSION,
  DISCOVERY_SEMANTIC_BUDGET,
  type SemanticBudgetReport
} from "./discoverySemanticPreparation";

const REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const CONTEXT_SEGMENTS = [".ai-factory", "context", "project"];
const MAX_PAYLOAD_BYTES = DISCOVERY_SEMANTIC_BUDGET.maxPayloadUtf8Bytes;
const MAX_STRUCTURED_RECORDS = DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords;
const MAX_SOURCE_ITEMS = DISCOVERY_SEMANTIC_BUDGET.maxSourceItems;

const PRE_GATE_ARTIFACTS = [
  ".ai-factory/020-Discovery/reports/FILE_INVENTORY.json",
  ".ai-factory/020-Discovery/reports/FOLDER_STRUCTURE.json",
  ".ai-factory/020-Discovery/reports/CLASSIFIED_FILES.json",
  ".ai-factory/020-Discovery/reports/UNKNOWN_FILES.json",
  ".ai-factory/020-Discovery/reports/DOCUMENT_INDEX.json",
  ".ai-factory/020-Discovery/reports/DOCUMENT_STRUCTURE.json",
  ".ai-factory/020-Discovery/reports/DOCUMENT_REFERENCES.json",
  ".ai-factory/020-Discovery/reports/MISSING_DOCUMENTS.json",
  ".ai-factory/020-Discovery/reports/DOMAIN_GLOSSARY.json",
  ".ai-factory/020-Discovery/reports/DEPENDENCY_MAP.json",
  ".ai-factory/020-Discovery/reports/TECHNOLOGY_STACK.json",
  ".ai-factory/context/project/PROJECT_CONTEXT.json",
  ".ai-factory/020-Discovery/reports/MODULE_MAP_BASE.json",
  ".ai-factory/context/project/MODULE_MAP.json"
] as const;

export const DISCOVERY_GAP_KINDS = [
  "mandatory_output_missing",
  "output_schema_invalid",
  "inventory_inconsistent",
  "document_index_inconsistent",
  "dependency_map_inconsistent",
  "evidence_missing",
  "evidence_excerpt_is_note",
  "evidence_line_mismatch",
  "secret_unmasked",
  "vcs_status_inferred",
  "duplicate_finding",
  "absence_judged",
  "absence_scope_undeclared",
  "unknown_not_marked"
] as const;

export type DiscoveryGapKind = (typeof DISCOVERY_GAP_KINDS)[number];
export type DiscoverySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DiscoveryGapDimension = "presence" | "schema" | "consistency" | "evidence" | "security";

const DIMENSION_BY_KIND: Record<DiscoveryGapKind, DiscoveryGapDimension> = {
  mandatory_output_missing: "presence",
  output_schema_invalid: "schema",
  inventory_inconsistent: "consistency",
  document_index_inconsistent: "consistency",
  dependency_map_inconsistent: "consistency",
  evidence_missing: "evidence",
  evidence_excerpt_is_note: "evidence",
  evidence_line_mismatch: "evidence",
  secret_unmasked: "security",
  vcs_status_inferred: "evidence",
  duplicate_finding: "consistency",
  absence_judged: "evidence",
  absence_scope_undeclared: "evidence",
  unknown_not_marked: "consistency"
};

export type DiscoverySeverityPolicy = {
  base: Record<string, unknown>;
};

export type DiscoveryChecklistPolicyItem = {
  id: string;
  obligation: "mandatory" | "reporting" | "post_gate" | "human";
  predicate: string;
};

export type DiscoveryChecklistPolicy = {
  items: DiscoveryChecklistPolicyItem[];
};

type CheckResult = "pass" | "finding" | "skipped" | "blocked";

type CheckRecord = {
  id: string;
  family: string;
  result: CheckResult;
  gap_ids: string[];
  reason: string | null;
};

type GapEvidence = Record<string, unknown>;

type GapDraft = {
  candidate_key: string;
  dimension: DiscoveryGapDimension;
  evidence: GapEvidence[];
  kind: DiscoveryGapKind;
  message: string;
  target: string;
};

type CoverageLimitation = {
  source: string;
  pointer: string;
  observation: string;
  reason: "no_matching_gap_kind";
};

type SemanticTarget = {
  target: string;
  value: string;
  locator: { source: string; line?: number; field?: string } | null;
};

type D05RuntimePayload = {
  artifactValidation: { expected_pre_gate: 14; present: number; missing: number; invalid: number };
  checklist: {
    items: Array<{
      id: string;
      obligation: DiscoveryChecklistPolicyItem["obligation"];
      status: "pass" | "fail" | "blocked" | "skipped" | "pending_human";
      reason: string | null;
    }>;
    summary: {
      mandatory_pass: number;
      mandatory_fail: number;
      mandatory_blocked: number;
      reporting_pass: number;
      reporting_fail: number;
      post_gate_skipped: number;
      human_pending: number;
    };
  };
  checks: CheckRecord[];
  coverageLimitations: CoverageLimitation[];
  deterministicCandidates: GapDraft[];
  severityPolicy: Record<DiscoveryGapKind, DiscoverySeverity>;
  semanticTargets: SemanticTarget[];
};

export type D05SemanticCandidate = {
  kind?: unknown;
  target?: unknown;
  locator?: unknown;
  candidate_keys?: unknown;
  reason?: unknown;
};

export type DetectGapsV2PreparationResult = {
  contract_version: typeof DISCOVERY_CONTRACT_VERSION;
  preparationId: string;
  semanticNeeded: boolean;
  semanticPayload: {
    semantic_task_id: "D05_SEMANTIC_GAPS";
    contract_version: typeof DISCOVERY_CONTRACT_VERSION;
    preliminary_candidates: Array<{
      candidate_key: string;
      kind: DiscoveryGapKind;
      target: string;
      message: string;
    }>;
    semantic_targets: SemanticTarget[];
    checklist: D05RuntimePayload["checklist"];
    budget: SemanticBudgetReport;
  };
  summary: {
    deterministic_candidate_count: number;
    missing_artifact_count: number;
    invalid_artifact_count: number;
    semantic_target_count: number;
  };
};

export type DetectGapsV2Result = {
  gap_count: number;
  issue_count: number;
  warning_count: number;
  semantic_candidate_count: number;
  semantic_accepted_count: number;
  semantic_rejected_count: number;
};

const metadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: DISCOVERY_CONTRACT_VERSION
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const artifactAbsolute = (projectRootPath: string, relativePath: string): string =>
  path.join(projectRootPath, ...relativePath.split("/"));

const reportsDir = (projectRootPath: string): string => path.join(projectRootPath, ...REPORTS_SEGMENTS);
const contextDir = (projectRootPath: string): string => path.join(projectRootPath, ...CONTEXT_SEGMENTS);

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, "utf8"));

const deepEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

const stringPaths = (value: unknown, field: string): string[] | null => {
  if (!isObject(value) || !Array.isArray(value[field])) return null;
  const result: string[] = [];
  for (const item of value[field] as unknown[]) {
    if (!isObject(item) || !isString(item.path)) return null;
    result.push(item.path);
  }
  return result;
};

const filePathArray = (value: unknown): string[] | null => {
  if (!isObject(value) || !Array.isArray(value.files)) return null;
  const result: string[] = [];
  for (const item of value.files) {
    if (typeof item === "string") result.push(item);
    else if (isObject(item) && isString(item.path)) result.push(item.path);
    else return null;
  }
  return result;
};

const requiredTopLevelArray = (value: unknown, field: string): boolean =>
  isObject(value) && Array.isArray(value[field]);

const validateArtifactShape = (relativePath: string, value: unknown): boolean => {
  const name = path.posix.basename(relativePath);
  switch (name) {
    case "FILE_INVENTORY.json":
      return requiredTopLevelArray(value, "files") && isObject(value) && isObject(value.totals);
    case "FOLDER_STRUCTURE.json":
      return requiredTopLevelArray(value, "directories") && isObject(value) && Array.isArray(value.files);
    case "CLASSIFIED_FILES.json":
    case "UNKNOWN_FILES.json":
      return requiredTopLevelArray(value, "files");
    case "DOCUMENT_INDEX.json":
    case "DOCUMENT_STRUCTURE.json":
      return requiredTopLevelArray(value, "documents");
    case "DOCUMENT_REFERENCES.json":
      return requiredTopLevelArray(value, "references");
    case "MISSING_DOCUMENTS.json":
      return requiredTopLevelArray(value, "missing");
    case "DOMAIN_GLOSSARY.json":
      return requiredTopLevelArray(value, "terms");
    case "DEPENDENCY_MAP.json":
      return (
        isObject(value) &&
        Array.isArray(value.manifests) &&
        Array.isArray(value.parsed_manifests) &&
        Array.isArray(value.unparsed_manifests) &&
        Array.isArray(value.packages)
      );
    case "TECHNOLOGY_STACK.json":
      return requiredTopLevelArray(value, "stack");
    case "PROJECT_CONTEXT.json":
      return isObject(value) && isObject(value.project) && Array.isArray(value.modules);
    case "MODULE_MAP_BASE.json":
      return requiredTopLevelArray(value, "modules");
    case "MODULE_MAP.json":
      return (
        isObject(value) &&
        Array.isArray(value.modules) &&
        Array.isArray(value.dependency_edges) &&
        isObject(value.analysis_coverage)
      );
    default:
      return false;
  }
};

const severityPolicyFrom = (raw: DiscoverySeverityPolicy): Record<DiscoveryGapKind, DiscoverySeverity> => {
  const allowed = new Set<DiscoverySeverity>(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  const result = {} as Record<DiscoveryGapKind, DiscoverySeverity>;
  for (const kind of DISCOVERY_GAP_KINDS) {
    const value = raw.base[kind];
    if (typeof value !== "string" || !allowed.has(value as DiscoverySeverity)) {
      throw new Error(`D05 severity policy is missing a valid base severity for ${kind}.`);
    }
    result[kind] = value as DiscoverySeverity;
  }
  for (const kind of Object.keys(raw.base)) {
    if (!DISCOVERY_GAP_KINDS.includes(kind as DiscoveryGapKind)) {
      throw new Error(`D05 severity policy contains an unknown gap kind: ${kind}.`);
    }
  }
  return result;
};

const canonicalEvidenceKey = (evidence: GapEvidence[]): string => JSON.stringify(evidence);
const canonicalCandidateKey = (draft: Omit<GapDraft, "candidate_key">): string => {
  const digest = createHash("sha256")
    .update(`${draft.kind}\n${draft.target}\n${canonicalEvidenceKey(draft.evidence)}\n${draft.message}`)
    .digest("hex")
    .slice(0, 12);
  return `CK-${digest}`;
};

const makeDraft = (
  kind: DiscoveryGapKind,
  target: string,
  message: string,
  evidence: GapEvidence[]
): GapDraft => {
  const base = { dimension: DIMENSION_BY_KIND[kind], evidence, kind, message, target };
  return { ...base, candidate_key: canonicalCandidateKey(base) };
};

const addUniqueDraft = (drafts: GapDraft[], draft: GapDraft): void => {
  const exact = drafts.find(
    (candidate) =>
      candidate.kind === draft.kind &&
      candidate.target === draft.target &&
      candidate.message === draft.message &&
      canonicalEvidenceKey(candidate.evidence) === canonicalEvidenceKey(draft.evidence)
  );
  if (!exact) drafts.push(draft);
};

const check = (
  checks: CheckRecord[],
  id: string,
  family: string,
  result: CheckResult,
  reason: string | null = null
): CheckRecord => {
  const record: CheckRecord = { id, family, result, gap_ids: [], reason };
  checks.push(record);
  return record;
};

const structuralEvidence = (
  source: string,
  pointer: string,
  expected: string,
  observed: string
): GapEvidence => ({ type: "structural", source, pointer, expected, observed, redacted: false });

const setMismatch = (left: string[], right: string[]): { missing: string[]; extra: string[] } => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    missing: [...leftSet].filter((item) => !rightSet.has(item)).sort(),
    extra: [...rightSet].filter((item) => !leftSet.has(item)).sort()
  };
};

const buildChecklist = (
  policy: DiscoveryChecklistPolicy,
  checks: CheckRecord[]
): D05RuntimePayload["checklist"] => {
  if (!isObject(policy) || !Array.isArray(policy.items)) {
    throw new Error("D05 checklist policy must contain items[].");
  }
  const ids = new Set<string>();
  const byCheck = new Map(checks.map((entry) => [entry.id, entry]));
  const items: D05RuntimePayload["checklist"]["items"] = [];

  for (const raw of policy.items) {
    if (!raw || !isString(raw.id) || !isString(raw.predicate)) {
      throw new Error("D05 checklist item is invalid.");
    }
    if (ids.has(raw.id)) throw new Error(`Duplicate D05 checklist id: ${raw.id}`);
    ids.add(raw.id);

    if (raw.obligation === "post_gate") {
      items.push({ id: raw.id, obligation: raw.obligation, status: "skipped", reason: "post_gate" });
      continue;
    }
    if (raw.obligation === "human") {
      items.push({ id: raw.id, obligation: raw.obligation, status: "pending_human", reason: null });
      continue;
    }
    if (raw.obligation !== "mandatory" && raw.obligation !== "reporting") {
      throw new Error(`Unknown D05 checklist obligation: ${String(raw.obligation)}`);
    }

    if (!raw.predicate.startsWith("check:")) {
      throw new Error(`Unsupported D05 checklist predicate: ${raw.predicate}`);
    }
    const checkId = raw.predicate.slice("check:".length);
    const source = byCheck.get(checkId);
    if (!source) throw new Error(`D05 checklist references unknown check: ${checkId}`);

    if (raw.obligation === "mandatory") {
      const status = source.result === "pass" ? "pass" : source.result === "finding" ? "fail" : "blocked";
      items.push({ id: raw.id, obligation: raw.obligation, status, reason: null });
    } else {
      items.push({
        id: raw.id,
        obligation: raw.obligation,
        status: source.result === "pass" ? "pass" : "fail",
        reason: null
      });
    }
  }

  const summary = {
    mandatory_pass: items.filter((item) => item.obligation === "mandatory" && item.status === "pass").length,
    mandatory_fail: items.filter((item) => item.obligation === "mandatory" && item.status === "fail").length,
    mandatory_blocked: items.filter((item) => item.obligation === "mandatory" && item.status === "blocked").length,
    reporting_pass: items.filter((item) => item.obligation === "reporting" && item.status === "pass").length,
    reporting_fail: items.filter((item) => item.obligation === "reporting" && item.status === "fail").length,
    post_gate_skipped: items.filter((item) => item.obligation === "post_gate" && item.status === "skipped").length,
    human_pending: items.filter((item) => item.obligation === "human" && item.status === "pending_human").length
  };
  return { items, summary };
};

const tryReadDocumentLine = async (
  projectRootPath: string,
  documentIndex: unknown,
  source: string,
  line: number
): Promise<string | null> => {
  if (!isObject(documentIndex) || !Array.isArray(documentIndex.documents)) return null;
  const entry = documentIndex.documents.find(
    (candidate) => isObject(candidate) && candidate.path === source && typeof candidate.format === "string"
  );
  if (!isObject(entry)) return null;
  try {
    const text = await extractCanonicalText(
      artifactAbsolute(projectRootPath, source),
      (entry.format as FileFormat | null) ?? null
    );
    return text.split("\n")[line - 1] ?? null;
  } catch {
    return null;
  }
};

const evidenceSourceExists = async (projectRootPath: string, source: string): Promise<boolean> => {
  try {
    await access(artifactAbsolute(projectRootPath, source));
    return true;
  } catch {
    return false;
  }
};

const secretPatterns: Array<{ type: string; pattern: RegExp }> = [
  { type: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i },
  { type: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: "github_token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { type: "credential_like", pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password)\b\s*[:=]\s*["']?[A-Za-z0-9_\-\/+=]{12,}/i }
];

const findSecretPointer = (value: unknown, pointer = ""): { pointer: string; secretType: string } | null => {
  if (typeof value === "string") {
    if (/^\[REDACTED(?::[^\]]+)?\]$/i.test(value.trim())) return null;
    const hit = secretPatterns.find((entry) => entry.pattern.test(value));
    return hit ? { pointer: pointer || "/", secretType: hit.type } : null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const hit = findSecretPointer(value[index], `${pointer}/${index}`);
      if (hit) return hit;
    }
    return null;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key === "metadata") continue;
      const hit = findSecretPointer(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
      if (hit) return hit;
    }
  }
  return null;
};

const boundedPayload = <T extends Record<string, unknown>>(
  value: T,
  sourceItems: number,
  structuredRecords: number,
  truncated: boolean
): T & { budget: SemanticBudgetReport } => {
  const budgetBase = {
    max_payload_utf8_bytes: MAX_PAYLOAD_BYTES,
    max_source_items: MAX_SOURCE_ITEMS,
    max_excerpt_utf8_bytes_per_source: DISCOVERY_SEMANTIC_BUDGET.maxExcerptUtf8BytesPerSource,
    max_structured_records: MAX_STRUCTURED_RECORDS,
    source_items: sourceItems,
    structured_records: structuredRecords,
    truncated
  };
  let actualBytes = Buffer.byteLength(
    JSON.stringify({ ...value, budget: { ...budgetBase, actual_payload_utf8_bytes: 0 } }),
    "utf8"
  );
  actualBytes = Buffer.byteLength(
    JSON.stringify({ ...value, budget: { ...budgetBase, actual_payload_utf8_bytes: actualBytes } }),
    "utf8"
  );
  if (actualBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`D05 semantic payload exceeded ${MAX_PAYLOAD_BYTES} bytes after deterministic bounding.`);
  }
  if (structuredRecords > MAX_STRUCTURED_RECORDS) {
    throw new Error("D05 semantic payload exceeded the structured-record budget.");
  }
  return {
    ...value,
    budget: { ...budgetBase, actual_payload_utf8_bytes: actualBytes }
  };
};

const compactText = (value: string, maxChars: number): string =>
  value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;

const semanticTargetsFromProjectContext = (projectContext: unknown): SemanticTarget[] => {
  if (!isObject(projectContext)) return [];
  const targets: SemanticTarget[] = [];
  const push = (target: string, value: unknown, evidence: unknown): void => {
    if (typeof value !== "string" || !value.trim() || value === "UNKNOWN") return;
    let locator: SemanticTarget["locator"] = null;
    if (isObject(evidence) && isString(evidence.source)) {
      locator = { source: evidence.source };
      if (typeof evidence.line === "number" && Number.isInteger(evidence.line) && evidence.line > 0) {
        locator.line = evidence.line;
      } else if (isString(evidence.field)) {
        locator.field = evidence.field;
      }
    }
    targets.push({ target, value, locator });
  };

  const project = isObject(projectContext.project) ? projectContext.project : {};
  const projectEvidence = isObject(project.evidence) ? project.evidence : {};
  push("PROJECT_CONTEXT.json#/project/type", project.type, projectEvidence.type);
  push("PROJECT_CONTEXT.json#/project/purpose", project.purpose, projectEvidence.purpose);
  const domain = isObject(projectContext.business_domain) ? projectContext.business_domain : {};
  push("PROJECT_CONTEXT.json#/business_domain/name", domain.name, domain.name_evidence);
  if (Array.isArray(projectContext.modules)) {
    for (const module of projectContext.modules) {
      if (!isObject(module) || !isString(module.id)) continue;
      push(`PROJECT_CONTEXT.json#/modules/${module.id}/description`, module.description, module.description_evidence);
    }
  }
  return targets.sort((a, b) => a.target.localeCompare(b.target));
};

export const prepareDetectGapsV2Job = async (
  projectRootPath: string,
  severityPolicyInput: DiscoverySeverityPolicy,
  checklistPolicy: DiscoveryChecklistPolicy
): Promise<DetectGapsV2PreparationResult> => {
  const severityPolicy = severityPolicyFrom(severityPolicyInput);
  const documents = new Map<string, unknown>();
  const invalidArtifacts = new Set<string>();
  const missingArtifacts = new Set<string>();
  const drafts: GapDraft[] = [];
  const checks: CheckRecord[] = [];
  const coverageLimitations: CoverageLimitation[] = [];

  for (const relativePath of PRE_GATE_ARTIFACTS) {
    try {
      const value = await readJson(artifactAbsolute(projectRootPath, relativePath));
      documents.set(relativePath, value);
      if (!validateArtifactShape(relativePath, value)) {
        invalidArtifacts.add(relativePath);
        addUniqueDraft(
          drafts,
          makeDraft(
            "output_schema_invalid",
            relativePath,
            "Discovery artifact does not satisfy its local output contract.",
            [structuralEvidence(relativePath, "/", "valid producing-rule output shape", "invalid shape")]
          )
        );
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        missingArtifacts.add(relativePath);
        addUniqueDraft(
          drafts,
          makeDraft(
            "mandatory_output_missing",
            relativePath,
            "Required pre-gate artifact is missing.",
            [
              {
                type: "absence",
                required_path: relativePath,
                checked_parent: path.posix.dirname(relativePath),
                requirement: "pre_gate_output_catalog"
              }
            ]
          )
        );
      } else {
        invalidArtifacts.add(relativePath);
        addUniqueDraft(
          drafts,
          makeDraft(
            "output_schema_invalid",
            relativePath,
            "Discovery artifact is unreadable or invalid JSON.",
            [structuralEvidence(relativePath, "/", "readable JSON", "unreadable or invalid JSON")]
          )
        );
      }
    }
  }

  check(
    checks,
    "CHK-PRE-GATE-PRESENCE",
    "presence",
    missingArtifacts.size === 0 ? "pass" : "finding"
  );
  check(
    checks,
    "CHK-PRE-GATE-SCHEMA",
    "schema",
    invalidArtifacts.size === 0 ? "pass" : "finding"
  );

  const usable = (relativePath: string): unknown | null =>
    missingArtifacts.has(relativePath) || invalidArtifacts.has(relativePath)
      ? null
      : (documents.get(relativePath) ?? null);

  const inventory = usable(PRE_GATE_ARTIFACTS[0]);
  const folders = usable(PRE_GATE_ARTIFACTS[1]);
  const classified = usable(PRE_GATE_ARTIFACTS[2]);
  const unknownFiles = usable(PRE_GATE_ARTIFACTS[3]);
  const documentIndex = usable(PRE_GATE_ARTIFACTS[4]);
  const documentStructure = usable(PRE_GATE_ARTIFACTS[5]);
  const documentReferences = usable(PRE_GATE_ARTIFACTS[6]);
  const missingDocuments = usable(PRE_GATE_ARTIFACTS[7]);
  const glossary = usable(PRE_GATE_ARTIFACTS[8]);
  const dependencyMap = usable(PRE_GATE_ARTIFACTS[9]);
  const projectContext = usable(PRE_GATE_ARTIFACTS[11]);
  const moduleBase = usable(PRE_GATE_ARTIFACTS[12]);
  const moduleMap = usable(PRE_GATE_ARTIFACTS[13]);

  let inventoryFinding = false;
  if (inventory && folders && classified && unknownFiles) {
    const inventoryPaths = stringPaths(inventory, "files") ?? [];
    const folderFilePaths = filePathArray(folders) ?? [];
    const classifiedPaths = stringPaths(classified, "files") ?? [];
    const classifiedUnknown = isObject(classified) && Array.isArray(classified.unknown)
      ? classified.unknown.filter((entry): entry is string => typeof entry === "string")
      : [];
    const unknownPaths = stringPaths(unknownFiles, "files") ?? [];
    const folderDirectories = stringPaths(folders, "directories") ?? [];
    const totals = isObject(inventory) && isObject(inventory.totals) ? inventory.totals : {};

    const compareSets = (target: string, source: string, left: string[], right: string[], expected: string): void => {
      const mismatch = setMismatch(left, right);
      if (mismatch.missing.length || mismatch.extra.length) {
        inventoryFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft(
            "inventory_inconsistent",
            target,
            "Inventory path sets are inconsistent.",
            [
              structuralEvidence(
                source,
                "/files",
                expected,
                `missing=${mismatch.missing.length}; extra=${mismatch.extra.length}`
              )
            ]
          )
        );
      }
    };
    compareSets("FILE_INVENTORY.json", "FOLDER_STRUCTURE.json", inventoryPaths, folderFilePaths, "same file path set as FILE_INVENTORY.json.files[]");
    compareSets("FILE_INVENTORY.json", "CLASSIFIED_FILES.json", inventoryPaths, classifiedPaths, "same file path set as FILE_INVENTORY.json.files[]");
    compareSets("UNKNOWN_FILES.json", "CLASSIFIED_FILES.json", sortedUnique(classifiedUnknown), sortedUnique(unknownPaths), "same unknown path set as CLASSIFIED_FILES.json.unknown[]");

    if (new Set(inventoryPaths).size !== inventoryPaths.length || new Set(folderDirectories).size !== folderDirectories.length) {
      inventoryFinding = true;
      addUniqueDraft(
        drafts,
        makeDraft("inventory_inconsistent", "FILE_INVENTORY.json", "Inventory contains duplicate paths.", [
          structuralEvidence("FILE_INVENTORY.json", "/files", "unique paths", "duplicates detected")
        ])
      );
    }
    if (
      typeof totals.files !== "number" ||
      totals.files !== inventoryPaths.length ||
      typeof totals.directories !== "number" ||
      totals.directories !== folderDirectories.length
    ) {
      inventoryFinding = true;
      addUniqueDraft(
        drafts,
        makeDraft("inventory_inconsistent", "FILE_INVENTORY.json", "Inventory totals do not match canonical arrays.", [
          structuralEvidence(
            "FILE_INVENTORY.json",
            "/totals",
            `files=${inventoryPaths.length}, directories=${folderDirectories.length}`,
            JSON.stringify(totals)
          )
        ])
      );
    }
    check(checks, "CHK-INVENTORY-CONSISTENCY", "inventory", inventoryFinding ? "finding" : "pass");
  } else {
    check(checks, "CHK-INVENTORY-CONSISTENCY", "inventory", "skipped", "required_artifact_unavailable");
  }

  let docFinding = false;
  if (classified && documentIndex && documentStructure && documentReferences && missingDocuments && glossary) {
    const classifiedDocs = isObject(classified) && Array.isArray(classified.files)
      ? classified.files
          .filter((entry) => isObject(entry) && entry.kind === "documentation" && isString(entry.path))
          .map((entry) => (entry as Record<string, unknown>).path as string)
      : [];
    const indexedDocs = stringPaths(documentIndex, "documents") ?? [];
    const structuredDocs = stringPaths(documentStructure, "documents") ?? [];
    const mismatches = [
      { source: "DOCUMENT_INDEX.json", left: classifiedDocs, right: indexedDocs, expected: "all classified documentation files" },
      { source: "DOCUMENT_STRUCTURE.json", left: indexedDocs, right: structuredDocs, expected: "all indexed documents" }
    ];
    for (const item of mismatches) {
      const mismatch = setMismatch(item.left, item.right);
      if (mismatch.missing.length || mismatch.extra.length) {
        docFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft("document_index_inconsistent", item.source, "Document index sets are inconsistent.", [
            structuralEvidence(item.source, "/documents", item.expected, `missing=${mismatch.missing.length}; extra=${mismatch.extra.length}`)
          ])
        );
      }
    }
    const referenceRecords = isObject(documentReferences) ? asArray(documentReferences.references) : [];
    if (referenceRecords.some((entry) => !isObject(entry) || !isString(entry.source) || !indexedDocs.includes(entry.source))) {
      docFinding = true;
      addUniqueDraft(
        drafts,
        makeDraft("document_index_inconsistent", "DOCUMENT_REFERENCES.json", "Document reference source is not in DOCUMENT_INDEX.json.", [
          structuralEvidence("DOCUMENT_REFERENCES.json", "/references", "every reference source is indexed", "unindexed source detected")
        ])
      );
    }
    const broken = referenceRecords.filter((entry) => isObject(entry) && entry.status === "broken");
    const missing = isObject(missingDocuments) ? asArray(missingDocuments.missing) : [];
    if (missing.length !== broken.length) {
      docFinding = true;
      addUniqueDraft(
        drafts,
        makeDraft("document_index_inconsistent", "MISSING_DOCUMENTS.json", "Missing-document traceability does not match broken references.", [
          structuralEvidence("MISSING_DOCUMENTS.json", "/missing", `count=${broken.length}`, `count=${missing.length}`)
        ])
      );
    }
    check(checks, "CHK-DOCUMENT-CONSISTENCY", "documents", docFinding ? "finding" : "pass");
  } else {
    check(checks, "CHK-DOCUMENT-CONSISTENCY", "documents", "skipped", "required_artifact_unavailable");
  }

  let dependencyFinding = false;
  if (classified && dependencyMap) {
    const manifestPaths = isObject(classified) && Array.isArray(classified.files)
      ? classified.files
          .filter((entry) => isObject(entry) && entry.kind === "manifest" && isString(entry.path))
          .map((entry) => (entry as Record<string, unknown>).path as string)
      : [];
    const manifests = isObject(dependencyMap) && Array.isArray(dependencyMap.manifests)
      ? dependencyMap.manifests.filter((entry): entry is string => typeof entry === "string")
      : [];
    const parsed = isObject(dependencyMap) && Array.isArray(dependencyMap.parsed_manifests)
      ? dependencyMap.parsed_manifests.filter((entry): entry is string => typeof entry === "string")
      : [];
    const unparsed = isObject(dependencyMap) && Array.isArray(dependencyMap.unparsed_manifests)
      ? dependencyMap.unparsed_manifests.filter((entry): entry is string => typeof entry === "string")
      : [];
    const setDiff = setMismatch(manifestPaths, manifests);
    const partition = sortedUnique([...parsed, ...unparsed]);
    const partitionDiff = setMismatch(sortedUnique(manifests), partition);
    const overlap = parsed.filter((entry) => unparsed.includes(entry));
    if (setDiff.missing.length || setDiff.extra.length || partitionDiff.missing.length || partitionDiff.extra.length || overlap.length) {
      dependencyFinding = true;
      addUniqueDraft(
        drafts,
        makeDraft("dependency_map_inconsistent", "DEPENDENCY_MAP.json", "Dependency manifest coverage is inconsistent with classified manifests.", [
          structuralEvidence(
            "DEPENDENCY_MAP.json",
            "/manifests",
            "classified manifest set with disjoint parsed/unparsed partition",
            `manifest_diff=${setDiff.missing.length + setDiff.extra.length}; partition_diff=${partitionDiff.missing.length + partitionDiff.extra.length}; overlap=${overlap.length}`
          )
        ])
      );
    }
    check(checks, "CHK-DEPENDENCY-CONSISTENCY", "dependencies", dependencyFinding ? "finding" : "pass");
    coverageLimitations.push({
      source: "DEPENDENCY_MAP.json",
      pointer: "/parsed_manifests",
      observation: "D05 validates manifest set/partition locally; independent parser replay remains bounded to D09 producer tests.",
      reason: "no_matching_gap_kind"
    });
  } else {
    check(checks, "CHK-DEPENDENCY-CONSISTENCY", "dependencies", "skipped", "required_artifact_unavailable");
  }

  let moduleFinding = false;
  if (moduleBase && moduleMap) {
    const baseModules = isObject(moduleBase) ? asArray(moduleBase.modules) : [];
    const finalModules = isObject(moduleMap) ? asArray(moduleMap.modules) : [];
    if (baseModules.length !== finalModules.length) moduleFinding = true;
    const finalById = new Map(
      finalModules.filter(isObject).filter((entry) => isString(entry.id)).map((entry) => [entry.id as string, entry])
    );
    for (const raw of baseModules) {
      if (!isObject(raw) || !isString(raw.id)) {
        moduleFinding = true;
        continue;
      }
      const final = finalById.get(raw.id);
      if (!final) {
        moduleFinding = true;
        continue;
      }
      for (const key of ["id", "name", "root", "paths", "summary", "description", "description_evidence"] as const) {
        if (!deepEqual(raw[key], final[key])) moduleFinding = true;
      }
      if (!Array.isArray(final.depends_on)) moduleFinding = true;
    }
    if (moduleFinding) {
      addUniqueDraft(
        drafts,
        makeDraft("output_schema_invalid", "MODULE_MAP.json", "MODULE_MAP.json does not preserve MODULE_MAP_BASE.json fields.", [
          structuralEvidence("MODULE_MAP.json", "/modules", "base module fields preserved exactly", "base preservation mismatch")
        ])
      );
    }
    check(checks, "CHK-MODULE-MAP-CONSISTENCY", "modules", moduleFinding ? "finding" : "pass");
  } else {
    check(checks, "CHK-MODULE-MAP-CONSISTENCY", "modules", "skipped", "required_artifact_unavailable");
  }

  let evidenceFinding = false;
  if (glossary && documentIndex) {
    for (const [index, raw] of asArray((glossary as Record<string, unknown>).terms).entries()) {
      if (!isObject(raw) || !isObject(raw.evidence) || !isString(raw.evidence.source) || typeof raw.evidence.line !== "number" || !isString(raw.evidence.excerpt)) {
        evidenceFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft("evidence_missing", `DOMAIN_GLOSSARY.json#/terms/${index}`, "Glossary term lacks verifiable evidence.", [
            structuralEvidence("DOMAIN_GLOSSARY.json", `/terms/${index}/evidence`, "source + line + excerpt", "missing or invalid")
          ])
        );
        continue;
      }
      const lineText = await tryReadDocumentLine(projectRootPath, documentIndex, raw.evidence.source, raw.evidence.line);
      if (lineText === null) {
        evidenceFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft("evidence_missing", `DOMAIN_GLOSSARY.json#/terms/${index}`, "Glossary evidence source cannot be materialized.", [
            structuralEvidence("DOMAIN_GLOSSARY.json", `/terms/${index}/evidence/source`, "readable canonical document", "unavailable")
          ])
        );
      } else if (!lineText.includes(raw.evidence.excerpt)) {
        evidenceFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft("evidence_line_mismatch", `DOMAIN_GLOSSARY.json#/terms/${index}`, "Glossary evidence excerpt does not match its canonical line.", [
            structuralEvidence("DOMAIN_GLOSSARY.json", `/terms/${index}/evidence/line`, "excerpt contained by canonical line", "line mismatch")
          ])
        );
      }
    }
  }

  if (projectContext) {
    const semanticTargets = semanticTargetsFromProjectContext(projectContext);
    for (const item of semanticTargets) {
      if (!item.locator || !(await evidenceSourceExists(projectRootPath, item.locator.source))) {
        evidenceFinding = true;
        addUniqueDraft(
          drafts,
          makeDraft("evidence_missing", item.target, "Semantic context value lacks a readable evidence source.", [
            structuralEvidence("PROJECT_CONTEXT.json", item.target.replace("PROJECT_CONTEXT.json#", ""), "readable evidence source", "missing or unreadable")
          ])
        );
      } else if (typeof item.locator.line === "number" && documentIndex) {
        const lineText = await tryReadDocumentLine(projectRootPath, documentIndex, item.locator.source, item.locator.line);
        if (lineText === null) {
          evidenceFinding = true;
          addUniqueDraft(
            drafts,
            makeDraft("evidence_line_mismatch", item.target, "Semantic context evidence line cannot be verified.", [
              structuralEvidence("PROJECT_CONTEXT.json", item.target.replace("PROJECT_CONTEXT.json#", ""), "valid evidence line", "unverifiable")
            ])
          );
        }
      }
    }
  }
  check(checks, "CHK-EVIDENCE-INTEGRITY", "evidence", evidenceFinding ? "finding" : "pass");

  let secretFinding = false;
  for (const [relativePath, value] of documents) {
    if (missingArtifacts.has(relativePath) || invalidArtifacts.has(relativePath)) continue;
    const secret = findSecretPointer(value);
    if (!secret) continue;
    secretFinding = true;
    addUniqueDraft(
      drafts,
      makeDraft("secret_unmasked", `${path.posix.basename(relativePath)}#${secret.pointer}`, "Discovery artifact contains an unredacted credential-like value.", [
        {
          type: "structural",
          source: path.posix.basename(relativePath),
          pointer: secret.pointer,
          expected: "secret value must be redacted",
          observed: "[REDACTED]",
          redacted: true,
          secret_type: secret.secretType
        }
      ])
    );
  }
  check(checks, "CHK-SECRET-REDACTION", "security", secretFinding ? "finding" : "pass");

  // D01 itself is the canonical VCS status source. No other v2 artifact currently
  // emits a typed VCS assertion, so this check is explicit and non-inferential.
  check(checks, "CHK-VCS-ASSERTIONS", "evidence", "pass");

  const checklist = buildChecklist(checklistPolicy, checks);
  const semanticTargets = projectContext ? semanticTargetsFromProjectContext(projectContext) : [];
  const recordCapacity = Math.max(0, MAX_STRUCTURED_RECORDS - checklist.items.length);
  const semanticPreliminary = drafts
    .slice(0, Math.min(recordCapacity, 180))
    .map((candidate) => ({
      candidate_key: candidate.candidate_key,
      kind: candidate.kind,
      target: compactText(candidate.target, 512),
      message: compactText(candidate.message, 1024)
    }));
  const semanticTargetsBounded = semanticTargets
    .slice(0, Math.max(0, recordCapacity - semanticPreliminary.length))
    .map((target) => ({
      ...target,
      target: compactText(target.target, 512),
      value: compactText(target.value, 4096)
    }));
  let semanticTruncated =
    semanticPreliminary.length < drafts.length || semanticTargetsBounded.length < semanticTargets.length;

  const makeSemanticBase = () => ({
    semantic_task_id: "D05_SEMANTIC_GAPS" as const,
    contract_version: DISCOVERY_CONTRACT_VERSION,
    preliminary_candidates: semanticPreliminary,
    semantic_targets: semanticTargetsBounded,
    checklist
  });
  // D05 semantic validation is optional. Bound the candidate view without ever
  // replacing it with full artifacts. If a pathological project still exceeds
  // the request budget, remove tail records deterministically and record the
  // limitation below.
  while (Buffer.byteLength(JSON.stringify(makeSemanticBase()), "utf8") > MAX_PAYLOAD_BYTES - 2048) {
    semanticTruncated = true;
    if (semanticTargetsBounded.length > 0) semanticTargetsBounded.pop();
    else if (semanticPreliminary.length > 0) semanticPreliminary.pop();
    else break;
  }
  if (semanticTruncated) {
    coverageLimitations.push({
      source: "DISCOVERY_VALIDATION.json",
      pointer: "/semantic_validation",
      observation: "The optional D05 semantic candidate view was bounded to the contract payload budget; canonical deterministic validation remained complete.",
      reason: "no_matching_gap_kind"
    });
  }
  const duplicateGroupsExist = semanticPreliminary.some((candidate, index) =>
    semanticPreliminary
      .slice(index + 1)
      .some((other) => candidate.kind === other.kind && candidate.target === other.target)
  );
  const semanticNeeded = duplicateGroupsExist || semanticTargetsBounded.length > 0;
  const baseSemanticPayload = makeSemanticBase();
  const semanticPayload = boundedPayload(
    baseSemanticPayload,
    0,
    semanticPreliminary.length + semanticTargetsBounded.length + checklist.items.length,
    semanticTruncated
  );

  const runtime: D05RuntimePayload = {
    artifactValidation: {
      expected_pre_gate: 14,
      present: PRE_GATE_ARTIFACTS.length - missingArtifacts.size,
      missing: missingArtifacts.size,
      invalid: invalidArtifacts.size
    },
    checklist,
    checks,
    coverageLimitations,
    deterministicCandidates: drafts,
    severityPolicy,
    semanticTargets
  };
  const preparationId = await saveDiscoveryRuntimePayload(projectRootPath, "D05_DETECT_GAPS", runtime);

  return {
    contract_version: DISCOVERY_CONTRACT_VERSION,
    preparationId,
    semanticNeeded,
    semanticPayload,
    summary: {
      deterministic_candidate_count: drafts.length,
      missing_artifact_count: missingArtifacts.size,
      invalid_artifact_count: invalidArtifacts.size,
      semantic_target_count: semanticTargets.length
    }
  };
};

const semanticRejection = (
  kind: string,
  target: string | null,
  candidateKeys: string[],
  reason: string
): Record<string, unknown> => ({ kind, target, candidate_keys: candidateKeys, reason });

const normalizeLocator = (value: unknown): { source: string; line?: number; field?: string } | null => {
  if (!isObject(value) || !isString(value.source)) return null;
  const locator: { source: string; line?: number; field?: string } = { source: value.source };
  if (typeof value.line === "number" && Number.isInteger(value.line) && value.line > 0) locator.line = value.line;
  else if (isString(value.field)) locator.field = value.field;
  else return null;
  return locator;
};

export const finalizeDetectGapsV2Job = async (
  projectRootPath: string,
  preparationId: string,
  semanticCandidates: D05SemanticCandidate[]
): Promise<DetectGapsV2Result> => {
  const runtime = await loadDiscoveryRuntimePayload<D05RuntimePayload>(
    projectRootPath,
    preparationId,
    "D05_DETECT_GAPS"
  );
  try {
    const candidates = [...runtime.deterministicCandidates];
    const rejections: Record<string, unknown>[] = [];
    let accepted = 0;
    const candidateByKey = new Map(candidates.map((candidate) => [candidate.candidate_key, candidate]));
    const semanticTargetById = new Map(runtime.semanticTargets.map((target) => [target.target, target]));

    for (const raw of Array.isArray(semanticCandidates) ? semanticCandidates : []) {
      const kind = typeof raw.kind === "string" ? raw.kind : "invalid";
      if (kind === "duplicate_finding") {
        const keys = Array.isArray(raw.candidate_keys)
          ? raw.candidate_keys.filter((entry): entry is string => typeof entry === "string")
          : [];
        const unique = [...new Set(keys)];
        const members = unique.map((key) => candidateByKey.get(key)).filter((entry): entry is GapDraft => Boolean(entry));
        if (unique.length < 2 || members.length !== unique.length) {
          rejections.push(semanticRejection(kind, null, unique, "candidate_keys must reference at least two existing preliminary candidates"));
          continue;
        }
        const first = members[0]!;
        if (!members.every((entry) => entry.kind === first.kind && entry.target === first.target)) {
          rejections.push(semanticRejection(kind, null, unique, "duplicate candidates must have the same kind and target"));
          continue;
        }
        addUniqueDraft(
          candidates,
          makeDraft(
            "duplicate_finding",
            first.target,
            "Multiple active candidates appear to represent the same underlying defect.",
            [
              {
                type: "structural",
                source: "DISCOVERY_VALIDATION.json",
                pointer: "/preliminary_candidates",
                expected: "unique underlying defects",
                observed: `duplicate group: ${unique.sort().join(",")}`,
                redacted: false
              }
            ]
          )
        );
        accepted += 1;
        continue;
      }

      if (kind !== "absence_judged" && kind !== "absence_scope_undeclared" && kind !== "unknown_not_marked") {
        rejections.push(semanticRejection(kind, typeof raw.target === "string" ? raw.target : null, [], "kind is not allowed for D05 semantic validation"));
        continue;
      }
      const target = typeof raw.target === "string" ? raw.target : null;
      const locator = normalizeLocator(raw.locator);
      const source = target ? semanticTargetById.get(target) : undefined;
      if (!target || !source || !locator || !source.locator) {
        rejections.push(semanticRejection(kind, target, [], "target/locator is not in the bounded semantic target set"));
        continue;
      }
      if (locator.source !== source.locator.source || locator.line !== source.locator.line || locator.field !== source.locator.field) {
        rejections.push(semanticRejection(kind, target, [], "locator does not match the canonical semantic evidence locator"));
        continue;
      }
      if (kind === "unknown_not_marked" && (source.value === "UNKNOWN" || !source.value.trim())) {
        rejections.push(semanticRejection(kind, target, [], "unknown_not_marked target is already UNKNOWN"));
        continue;
      }
      addUniqueDraft(
        candidates,
        makeDraft(kind, target, typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : `Semantic validation identified ${kind}.`, [
          {
            type: "structural",
            source: locator.source,
            pointer: target,
            expected: "semantic assertion satisfies Discovery evidence policy",
            observed: "semantic policy finding",
            redacted: false,
            ...(typeof locator.line === "number" ? { line: locator.line } : {}),
            ...(locator.field ? { field: locator.field } : {})
          }
        ])
      );
      accepted += 1;
    }

    candidates.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
      if (left.target !== right.target) return left.target.localeCompare(right.target);
      const evidence = canonicalEvidenceKey(left.evidence).localeCompare(canonicalEvidenceKey(right.evidence));
      return evidence !== 0 ? evidence : left.message.localeCompare(right.message);
    });

    const issues: Array<Record<string, unknown>> = [];
    const warnings: Array<Record<string, unknown>> = [];
    const gaps: Array<Record<string, unknown>> = [];
    let issueIndex = 0;
    let warningIndex = 0;

    for (let index = 0; index < candidates.length; index += 1) {
      const draft = candidates[index]!;
      const gapId = `GAP-${String(index + 1).padStart(3, "0")}`;
      const severity = runtime.severityPolicy[draft.kind];
      const isIssue = severity === "HIGH" || severity === "CRITICAL";
      const findingId = isIssue
        ? `DISC-ISSUE-${String(++issueIndex).padStart(3, "0")}`
        : `DISC-WARN-${String(++warningIndex).padStart(3, "0")}`;
      const gap = {
        id: gapId,
        dimension: draft.dimension,
        kind: draft.kind,
        severity,
        target: draft.target,
        message: draft.message,
        evidence: draft.evidence,
        addressed_by: [findingId]
      };
      gaps.push(gap);
      const finding = {
        id: findingId,
        gap_id: gapId,
        kind: draft.kind,
        severity,
        target: draft.target,
        message: draft.message,
        evidence: draft.evidence
      };
      if (isIssue) issues.push(finding);
      else warnings.push(finding);
    }

    const gapIdsByDraft = new Map<string, string>();
    for (const gap of gaps) {
      if (!isObject(gap)) continue;
      const key = candidates.find((candidate) => candidate.kind === gap.kind && candidate.target === gap.target)?.candidate_key;
      if (key && isString(gap.id)) gapIdsByDraft.set(key, gap.id);
    }
    const checks = runtime.checks
      .map((entry) => {
        const matching = candidates
          .filter((candidate) => {
            if (entry.family === "presence") return candidate.kind === "mandatory_output_missing";
            if (entry.family === "schema") return candidate.kind === "output_schema_invalid";
            if (entry.family === "inventory") return candidate.kind === "inventory_inconsistent";
            if (entry.family === "documents") return candidate.kind === "document_index_inconsistent";
            if (entry.family === "dependencies") return candidate.kind === "dependency_map_inconsistent";
            if (entry.family === "modules") return candidate.target === "MODULE_MAP.json" && candidate.kind === "output_schema_invalid";
            if (entry.family === "security") return candidate.kind === "secret_unmasked";
            if (entry.family === "evidence") return ["evidence_missing", "evidence_excerpt_is_note", "evidence_line_mismatch", "vcs_status_inferred"].includes(candidate.kind);
            return false;
          })
          .map((candidate) => gapIdsByDraft.get(candidate.candidate_key))
          .filter((value): value is string => Boolean(value));
        return { ...entry, gap_ids: matching };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const validation = {
      metadata: metadata(),
      execution_status: "PASS",
      artifact_validation: runtime.artifactValidation,
      checks,
      checklist: runtime.checklist,
      semantic_validation: {
        requested_kinds: ["duplicate_finding", "absence_judged", "absence_scope_undeclared", "unknown_not_marked"],
        candidate_count: Array.isArray(semanticCandidates) ? semanticCandidates.length : 0,
        accepted_count: accepted,
        rejected_count: rejections.length
      },
      semantic_rejections: rejections.sort((a, b) => {
        const ak = String(a.kind ?? "");
        const bk = String(b.kind ?? "");
        if (ak !== bk) return ak.localeCompare(bk);
        const at = a.target === null ? "" : String(a.target ?? "");
        const bt = b.target === null ? "" : String(b.target ?? "");
        return at.localeCompare(bt);
      }),
      coverage_limitations: [...runtime.coverageLimitations].sort((a, b) =>
        a.source !== b.source ? a.source.localeCompare(b.source) : a.pointer.localeCompare(b.pointer)
      ),
      gap_count: gaps.length,
      issue_count: issues.length,
      warning_count: warnings.length
    };

    await writeJson(path.join(reportsDir(projectRootPath), "DISCOVERY_VALIDATION.json"), validation);
    await writeJson(path.join(reportsDir(projectRootPath), "DISCOVERY_GAPS.json"), { metadata: metadata(), gaps });
    await writeJson(path.join(reportsDir(projectRootPath), "DISCOVERY_ISSUES.json"), { metadata: metadata(), issues });
    await writeJson(path.join(reportsDir(projectRootPath), "DISCOVERY_WARNINGS.json"), { metadata: metadata(), warnings });

    return {
      gap_count: gaps.length,
      issue_count: issues.length,
      warning_count: warnings.length,
      semantic_candidate_count: Array.isArray(semanticCandidates) ? semanticCandidates.length : 0,
      semantic_accepted_count: accepted,
      semantic_rejected_count: rejections.length
    };
  } finally {
    await removeDiscoveryRuntimePayload(projectRootPath, preparationId);
  }
};

export const discoveryPreGateArtifactPaths = (): readonly string[] => PRE_GATE_ARTIFACTS;
