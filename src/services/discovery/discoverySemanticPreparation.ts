import {
  finalizeBuildContextJob,
  finalizeIndexDocumentsJob,
  type BuildContextPreparation,
  type GlossaryCandidateInput,
  type IndexDocumentsPreparation,
  prepareBuildContextJob,
  prepareIndexDocumentsJob
} from "./discoveryJobService";
import {
  loadDiscoveryRuntimePayload,
  removeDiscoveryRuntimePayload,
  saveDiscoveryRuntimePayload
} from "./discoveryRuntimeStore";

export const DISCOVERY_CONTRACT_VERSION = "2.0.0" as const;

export const DISCOVERY_SEMANTIC_BUDGET = {
  maxPayloadUtf8Bytes: 96 * 1024,
  maxSourceItems: 40,
  maxExcerptUtf8BytesPerSource: 8 * 1024,
  maxStructuredRecords: 400,
  maxSingleRecordUtf8Bytes: 16 * 1024
} as const;

const PAYLOAD_HEADROOM_BYTES = 2048;
const TARGET_PAYLOAD_BYTES =
  DISCOVERY_SEMANTIC_BUDGET.maxPayloadUtf8Bytes - PAYLOAD_HEADROOM_BYTES;

export type SemanticBudgetReport = {
  max_payload_utf8_bytes: number;
  max_source_items: number;
  max_excerpt_utf8_bytes_per_source: number;
  max_structured_records: number;
  actual_payload_utf8_bytes: number;
  source_items: number;
  structured_records: number;
  truncated: boolean;
};

type NumberedLine = { line: number; text: string };
type BoundedDocument = { source: string; lines: NumberedLine[] };

const utf8Bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

const truncateUtf8 = (value: string, maxBytes: number): string => {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;

  // Cutting a UTF-8 buffer may end inside a multi-byte code point. Decode and
  // remove replacement characters so semantic payloads always remain valid text.
  return buffer.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD+$/u, "");
};

const boundedLines = (
  lines: string[],
  maxBytes = DISCOVERY_SEMANTIC_BUDGET.maxExcerptUtf8BytesPerSource
): NumberedLine[] => {
  const selected: NumberedLine[] = [];
  let bytes = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = { line: index + 1, text: lines[index] ?? "" };
    const rawBytes = utf8Bytes(raw);

    if (selected.length > 0 && bytes + rawBytes > maxBytes) break;

    if (rawBytes > maxBytes && selected.length === 0) {
      selected.push({
        line: raw.line,
        text: truncateUtf8(raw.text, Math.max(64, maxBytes - 128))
      });
      break;
    }

    selected.push(raw);
    bytes += rawBytes;
  }

  return selected;
};

const documentPriority = (source: string): number => {
  const lower = source.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;

  if (/^readme(?:\.|$)/.test(base)) return 0;
  if (/^overview(?:\.|$)|^architecture(?:\.|$)|^design(?:\.|$)/.test(base)) return 1;
  if (!lower.includes("/")) return 2;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) return 3;
  return 4;
};

const buildBoundedDocuments = (
  documents: Array<{ source: string; lines: string[] }>,
  maxTotalBytes: number
): { documents: BoundedDocument[]; truncated: boolean } => {
  const ordered = [...documents].sort((left, right) => {
    const priority = documentPriority(left.source) - documentPriority(right.source);
    return priority !== 0 ? priority : left.source.localeCompare(right.source);
  });
  const selected: BoundedDocument[] = [];
  let totalBytes = 0;
  let truncated = ordered.length > DISCOVERY_SEMANTIC_BUDGET.maxSourceItems;

  for (const document of ordered.slice(0, DISCOVERY_SEMANTIC_BUDGET.maxSourceItems)) {
    const candidate: BoundedDocument = {
      source: document.source,
      lines: boundedLines(document.lines)
    };
    const candidateBytes = utf8Bytes(candidate);

    if (selected.length > 0 && totalBytes + candidateBytes > maxTotalBytes) {
      truncated = true;
      break;
    }

    selected.push(candidate);
    totalBytes += candidateBytes;
    if (candidate.lines.length < document.lines.length) truncated = true;
  }

  return { documents: selected, truncated };
};

const buildBudget = (
  payloadWithoutBudget: Record<string, unknown>,
  sourceItems: number,
  structuredRecords: number,
  truncated: boolean
): SemanticBudgetReport => {
  const base: Omit<SemanticBudgetReport, "actual_payload_utf8_bytes"> = {
    max_payload_utf8_bytes: DISCOVERY_SEMANTIC_BUDGET.maxPayloadUtf8Bytes,
    max_source_items: DISCOVERY_SEMANTIC_BUDGET.maxSourceItems,
    max_excerpt_utf8_bytes_per_source:
      DISCOVERY_SEMANTIC_BUDGET.maxExcerptUtf8BytesPerSource,
    max_structured_records: DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords,
    source_items: sourceItems,
    structured_records: structuredRecords,
    truncated
  };
  let actual = utf8Bytes({ ...payloadWithoutBudget, budget: { ...base, actual_payload_utf8_bytes: 0 } });
  // The digit count of actual_payload_utf8_bytes can change the payload by a few
  // bytes. Recalculate once using the real number.
  actual = utf8Bytes({
    ...payloadWithoutBudget,
    budget: { ...base, actual_payload_utf8_bytes: actual }
  });
  return { ...base, actual_payload_utf8_bytes: actual };
};

const assertBudget = (payload: unknown, budget: SemanticBudgetReport): void => {
  const actual = utf8Bytes(payload);
  if (actual > DISCOVERY_SEMANTIC_BUDGET.maxPayloadUtf8Bytes) {
    throw new Error(
      `Discovery v2 semantic payload exceeded ${DISCOVERY_SEMANTIC_BUDGET.maxPayloadUtf8Bytes} UTF-8 bytes (${actual}).`
    );
  }
  if (budget.source_items > DISCOVERY_SEMANTIC_BUDGET.maxSourceItems) {
    throw new Error("Discovery v2 semantic payload exceeded the source-item budget.");
  }
  if (budget.structured_records > DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords) {
    throw new Error("Discovery v2 semantic payload exceeded the structured-record budget.");
  }
};

export type IndexDocumentsV2PreparationResult = {
  preparationId: string;
  semanticNeeded: boolean;
  semanticPayload: {
    semantic_task_id: "D03_DOMAIN_GLOSSARY";
    contract_version: typeof DISCOVERY_CONTRACT_VERSION;
    documents: BoundedDocument[];
    budget: SemanticBudgetReport;
  };
  summary: {
    document_count: number;
    missing_document_count: number;
    reference_count: number;
  };
};

export const prepareIndexDocumentsV2Job = async (
  projectRootPath: string
): Promise<IndexDocumentsV2PreparationResult> => {
  const preparation = await prepareIndexDocumentsJob(projectRootPath);
  const preparationId = await saveDiscoveryRuntimePayload(
    projectRootPath,
    "D03_INDEX_DOCUMENTS",
    preparation
  );
  const bounded = buildBoundedDocuments(preparation.candidateDocuments, TARGET_PAYLOAD_BYTES);
  const basePayload = {
    semantic_task_id: "D03_DOMAIN_GLOSSARY" as const,
    contract_version: DISCOVERY_CONTRACT_VERSION,
    documents: bounded.documents
  };
  const budget = buildBudget(basePayload, bounded.documents.length, 0, bounded.truncated);
  const semanticPayload = { ...basePayload, budget };
  assertBudget(semanticPayload, budget);

  return {
    preparationId,
    semanticNeeded: bounded.documents.some((document) =>
      document.lines.some((line) => line.text.trim())
    ),
    semanticPayload,
    summary: {
      document_count: preparation.documentIndexEntries.length,
      missing_document_count: preparation.missingDocuments.length,
      reference_count: preparation.references.length
    }
  };
};

export const finalizeIndexDocumentsV2Job = async (
  projectRootPath: string,
  preparationId: string,
  candidates: GlossaryCandidateInput[]
) => {
  const preparation = await loadDiscoveryRuntimePayload<IndexDocumentsPreparation>(
    projectRootPath,
    preparationId,
    "D03_INDEX_DOCUMENTS"
  );

  try {
    return await finalizeIndexDocumentsJob(projectRootPath, preparation, candidates);
  } finally {
    await removeDiscoveryRuntimePayload(projectRootPath, preparationId);
  }
};

export type BuildContextV2PreparationResult = {
  preparationId: string;
  semanticNeeded: boolean;
  semanticPayload: {
    semantic_task_id: "D04_CONTEXT_FIELDS";
    contract_version: typeof DISCOVERY_CONTRACT_VERSION;
    project_name: string;
    modules: Array<{ id: string; name: string; root: string }>;
    manifest_descriptions: BuildContextPreparation["manifestDescriptionCandidates"];
    glossary_business_terms: BuildContextPreparation["businessTerms"];
    documents: BoundedDocument[];
    budget: SemanticBudgetReport;
  };
  summary: {
    module_count: number;
    evidence_document_count: number;
  };
};

export const prepareBuildContextV2Job = async (
  projectRootPath: string
): Promise<BuildContextV2PreparationResult> => {
  const preparation = await prepareBuildContextJob(projectRootPath);
  const preparationId = await saveDiscoveryRuntimePayload(
    projectRootPath,
    "D04_BUILD_CONTEXT",
    preparation
  );

  // D04 has both structured records and document excerpts. Reserve roughly half
  // the payload for each and then deterministically trim tail records if needed.
  const bounded = buildBoundedDocuments(preparation.documents, 48 * 1024);
  const modules = preparation.modules
    .slice(0, DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords)
    .map((module: BuildContextPreparation["modules"][number]) => ({
      id: module.id,
      name: module.name,
      root: module.root
    }));
  const manifestDescriptions = preparation.manifestDescriptionCandidates.slice(
    0,
    Math.max(0, DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords - modules.length)
  );
  const businessTerms = preparation.businessTerms.slice(
    0,
    Math.max(
      0,
      DISCOVERY_SEMANTIC_BUDGET.maxStructuredRecords - modules.length - manifestDescriptions.length
    )
  );
  let truncated =
    bounded.truncated ||
    modules.length < preparation.modules.length ||
    manifestDescriptions.length < preparation.manifestDescriptionCandidates.length ||
    businessTerms.length < preparation.businessTerms.length;

  const buildBasePayload = () => ({
    semantic_task_id: "D04_CONTEXT_FIELDS" as const,
    contract_version: DISCOVERY_CONTRACT_VERSION,
    project_name: preparation.projectName,
    modules,
    manifest_descriptions: manifestDescriptions,
    glossary_business_terms: businessTerms,
    documents: bounded.documents
  });

  // Never fall back to an oversized full payload. Preserve deterministic order
  // and trim the least critical tail records until the hard byte budget fits.
  while (utf8Bytes(buildBasePayload()) > TARGET_PAYLOAD_BYTES) {
    truncated = true;
    if (bounded.documents.length > 1) {
      bounded.documents.pop();
    } else if (businessTerms.length > 0) {
      businessTerms.pop();
    } else if (manifestDescriptions.length > 0) {
      manifestDescriptions.pop();
    } else if (modules.length > 0) {
      modules.pop();
    } else {
      break;
    }
  }

  const basePayload = buildBasePayload();
  const structuredRecords = modules.length + manifestDescriptions.length + businessTerms.length;
  const budget = buildBudget(basePayload, bounded.documents.length, structuredRecords, truncated);
  const semanticPayload = { ...basePayload, budget };
  assertBudget(semanticPayload, budget);

  return {
    preparationId,
    semanticNeeded:
      modules.length > 0 &&
      (bounded.documents.length > 0 || manifestDescriptions.length > 0 || businessTerms.length > 0),
    semanticPayload,
    summary: {
      module_count: preparation.modules.length,
      evidence_document_count: preparation.documents.length
    }
  };
};

export const finalizeBuildContextV2Job = async (
  projectRootPath: string,
  preparationId: string,
  patch: unknown
) => {
  const preparation = await loadDiscoveryRuntimePayload<BuildContextPreparation>(
    projectRootPath,
    preparationId,
    "D04_BUILD_CONTEXT"
  );

  try {
    return await finalizeBuildContextJob(projectRootPath, preparation, patch);
  } finally {
    await removeDiscoveryRuntimePayload(projectRootPath, preparationId);
  }
};
