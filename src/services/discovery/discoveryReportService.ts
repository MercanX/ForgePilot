import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  loadDiscoveryRuntimePayload,
  removeDiscoveryRuntimePayload,
  saveDiscoveryRuntimePayload
} from "./discoveryRuntimeStore";
import { DISCOVERY_CONTRACT_VERSION, type SemanticBudgetReport } from "./discoverySemanticPreparation";

const REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const CONTEXT_SEGMENTS = [".ai-factory", "context", "project"];
const MAX_PAYLOAD_BYTES = 96 * 1024;

const REPORT_INPUTS = [
  "FILE_INVENTORY.json",
  "FOLDER_STRUCTURE.json",
  "CLASSIFIED_FILES.json",
  "UNKNOWN_FILES.json",
  "DOCUMENT_INDEX.json",
  "DOCUMENT_STRUCTURE.json",
  "DOCUMENT_REFERENCES.json",
  "MISSING_DOCUMENTS.json",
  "DOMAIN_GLOSSARY.json",
  "DEPENDENCY_MAP.json",
  "TECHNOLOGY_STACK.json",
  "MODULE_MAP_BASE.json",
  "DISCOVERY_VALIDATION.json",
  "DISCOVERY_GAPS.json",
  "DISCOVERY_ISSUES.json",
  "DISCOVERY_WARNINGS.json",
  "DISCOVERY_SCORE.json",
  "DISCOVERY_GATE.json"
] as const;

const CONTEXT_INPUTS = ["PROJECT_CONTEXT.json", "MODULE_MAP.json"] as const;

type ReportFinding = {
  id: string;
  gap_id: string;
  kind: string;
  severity: string;
  target: string;
  message: string;
  evidence?: unknown;
};

type ReportRuntimePayload = {
  snapshot: string;
  findingIds: string[];
  gateDecision: "PASS" | "PASS_WITH_WARNINGS";
  scoreOverall: number;
  semanticAllowed: boolean;
};

export type ReportProsePatch = {
  executive_summary_body?: unknown;
  recommended_actions?: unknown;
};

export type GenerateReportV2PreparationResult = {
  contract_version: typeof DISCOVERY_CONTRACT_VERSION;
  preparationId: string;
  semanticNeeded: boolean;
  semanticPayload: {
    semantic_task_id: "D07_REPORT_PROSE";
    contract_version: typeof DISCOVERY_CONTRACT_VERSION;
    project: { name: string; type: string; purpose: string };
    quality: {
      decision: "PASS" | "PASS_WITH_WARNINGS";
      score: number;
      minimum_score: number;
      finding_summary: Record<string, unknown>;
    };
    issues: Array<Omit<ReportFinding, "evidence">>;
    warnings: Array<Omit<ReportFinding, "evidence">>;
    budget: SemanticBudgetReport;
  };
  summary: {
    active_finding_count: number;
    gate_decision: "PASS" | "PASS_WITH_WARNINGS";
    score_overall: number;
  };
};

export type GenerateReportV2Result = {
  active_finding_count: number;
  gate_decision: "PASS" | "PASS_WITH_WARNINGS";
  report_files: number;
  score_overall: number;
};

const reportsDir = (root: string): string => path.join(root, ...REPORTS_SEGMENTS);
const contextDir = (root: string): string => path.join(root, ...CONTEXT_SEGMENTS);
const metadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: DISCOVERY_CONTRACT_VERSION
});
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, "utf8"));
const withoutMetadata = (value: unknown): unknown => {
  if (!isObject(value)) return value;
  const { metadata: _metadata, ...rest } = value;
  return rest;
};
const deepEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const markdownCell = (value: unknown): string => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

const loadInputs = async (projectRootPath: string): Promise<Record<string, unknown>> => {
  const result: Record<string, unknown> = {};
  for (const name of REPORT_INPUTS) result[name] = await readJson(path.join(reportsDir(projectRootPath), name));
  for (const name of CONTEXT_INPUTS) result[name] = await readJson(path.join(contextDir(projectRootPath), name));
  return result;
};

const parseFindings = (value: unknown, field: "issues" | "warnings"): ReportFinding[] => {
  if (!isObject(value) || !Array.isArray(value[field])) throw new Error(`D07 invalid ${field} artifact.`);
  return value[field].map((raw) => {
    if (
      !isObject(raw) ||
      typeof raw.id !== "string" ||
      typeof raw.gap_id !== "string" ||
      typeof raw.kind !== "string" ||
      typeof raw.severity !== "string" ||
      typeof raw.target !== "string" ||
      typeof raw.message !== "string"
    ) {
      throw new Error(`D07 invalid ${field} finding record.`);
    }
    return raw as unknown as ReportFinding;
  });
};

const preflight = (inputs: Record<string, unknown>) => {
  const projectContext = inputs["PROJECT_CONTEXT.json"];
  const moduleMap = inputs["MODULE_MAP.json"];
  const tech = inputs["TECHNOLOGY_STACK.json"];
  const score = inputs["DISCOVERY_SCORE.json"];
  const gate = inputs["DISCOVERY_GATE.json"];
  const gaps = inputs["DISCOVERY_GAPS.json"];
  const issues = parseFindings(inputs["DISCOVERY_ISSUES.json"], "issues");
  const warnings = parseFindings(inputs["DISCOVERY_WARNINGS.json"], "warnings");
  if (!isObject(projectContext) || !isObject(projectContext.project) || !Array.isArray(projectContext.modules)) {
    throw new Error("D07 invalid PROJECT_CONTEXT.json.");
  }
  if (!isObject(moduleMap) || !Array.isArray(moduleMap.modules) || !Array.isArray(moduleMap.dependency_edges) || !isObject(moduleMap.analysis_coverage)) {
    throw new Error("D07 invalid MODULE_MAP.json.");
  }
  if (!isObject(tech) || !Array.isArray(tech.stack)) throw new Error("D07 invalid TECHNOLOGY_STACK.json.");
  if (!isObject(score) || typeof score.overall !== "number" || !Number.isInteger(score.overall)) {
    throw new Error("D07 invalid DISCOVERY_SCORE.json.");
  }
  if (
    !isObject(gate) ||
    (gate.decision !== "PASS" && gate.decision !== "PASS_WITH_WARNINGS") ||
    !isObject(gate.score) ||
    typeof gate.score.minimum_score !== "number" ||
    !isObject(gate.finding_summary)
  ) {
    throw new Error("D07 can only run after a PASS or PASS_WITH_WARNINGS gate.");
  }
  if (!isObject(gaps) || !Array.isArray(gaps.gaps)) throw new Error("D07 invalid DISCOVERY_GAPS.json.");
  const active = [...issues, ...warnings];
  if (gaps.gaps.length !== active.length) throw new Error("D07 gap/finding count mismatch.");
  if (typeof score.finding_count !== "number" || score.finding_count !== active.length) {
    throw new Error("D07 score finding count mismatch.");
  }
  if (gate.finding_summary.total !== active.length) throw new Error("D07 gate finding summary mismatch.");
  if (!deepEqual(projectContext.technology_stack, tech.stack)) {
    throw new Error("D07 PROJECT_CONTEXT technology stack differs from TECHNOLOGY_STACK.");
  }
  const projectModuleIds = projectContext.modules
    .filter(isObject)
    .map((entry) => entry.id)
    .filter((entry): entry is string => typeof entry === "string")
    .sort();
  const mapModuleIds = moduleMap.modules
    .filter(isObject)
    .map((entry) => entry.id)
    .filter((entry): entry is string => typeof entry === "string")
    .sort();
  if (!deepEqual(projectModuleIds, mapModuleIds)) throw new Error("D07 module id sets do not match.");
  const project = projectContext.project;
  const projectView = {
    name: typeof project.name === "string" ? project.name : "UNKNOWN",
    type: typeof project.type === "string" ? project.type : "UNKNOWN",
    purpose: typeof project.purpose === "string" ? project.purpose : "UNKNOWN"
  };
  return {
    active,
    gate: gate as Record<string, unknown> & {
      decision: "PASS" | "PASS_WITH_WARNINGS";
      score: { overall: number; minimum_score: number };
      finding_summary: Record<string, unknown>;
    },
    issues,
    projectContext,
    projectView,
    score: score as Record<string, unknown> & { overall: number; finding_count: number },
    warnings
  };
};

const safeFinding = (finding: ReportFinding): Omit<ReportFinding, "evidence"> => ({
  id: finding.id,
  gap_id: finding.gap_id,
  kind: finding.kind,
  severity: finding.severity,
  target: finding.target,
  message: finding.message
});

export const prepareGenerateReportV2Job = async (
  projectRootPath: string
): Promise<GenerateReportV2PreparationResult> => {
  const inputs = await loadInputs(projectRootPath);
  const model = preflight(inputs);
  const allIssues = model.issues.map(safeFinding);
  const allWarnings = model.warnings.map(safeFinding);
  const selectedIssues = allIssues.slice(0, 200);
  const selectedWarnings = allWarnings.slice(0, Math.max(0, 400 - selectedIssues.length));
  let truncated = selectedIssues.length < allIssues.length || selectedWarnings.length < allWarnings.length;

  const buildBasePayload = () => ({
    semantic_task_id: "D07_REPORT_PROSE" as const,
    contract_version: DISCOVERY_CONTRACT_VERSION,
    project: model.projectView,
    quality: {
      decision: model.gate.decision,
      score: model.score.overall,
      minimum_score: model.gate.score.minimum_score,
      finding_summary: model.gate.finding_summary
    },
    issues: selectedIssues,
    warnings: selectedWarnings
  });

  // D07 prose is optional. If every active finding cannot fit inside one
  // report-safe bounded request, do not make a partial LLM claim. Fall back to
  // deterministic prose/actions while keeping the full canonical findings local.
  while (Buffer.byteLength(JSON.stringify(buildBasePayload()), "utf8") > MAX_PAYLOAD_BYTES - 2048) {
    truncated = true;
    if (selectedWarnings.length > 0) selectedWarnings.pop();
    else if (selectedIssues.length > 0) selectedIssues.pop();
    else break;
  }

  const basePayload = buildBasePayload();
  const structuredRecords = selectedIssues.length + selectedWarnings.length;
  const semanticAllowed =
    model.active.length > 0 &&
    !truncated &&
    structuredRecords === model.active.length &&
    structuredRecords <= 400;
  const budgetBase = {
    max_payload_utf8_bytes: MAX_PAYLOAD_BYTES,
    max_source_items: 40,
    max_excerpt_utf8_bytes_per_source: 8 * 1024,
    max_structured_records: 400,
    source_items: 0,
    structured_records: structuredRecords,
    truncated
  };
  let actualBytes = Buffer.byteLength(
    JSON.stringify({ ...basePayload, budget: { ...budgetBase, actual_payload_utf8_bytes: 0 } }),
    "utf8"
  );
  actualBytes = Buffer.byteLength(
    JSON.stringify({ ...basePayload, budget: { ...budgetBase, actual_payload_utf8_bytes: actualBytes } }),
    "utf8"
  );
  if (actualBytes > MAX_PAYLOAD_BYTES) {
    throw new Error("D07 failed to construct a bounded report-safe semantic payload.");
  }
  const semanticPayload = {
    ...basePayload,
    budget: { ...budgetBase, actual_payload_utf8_bytes: actualBytes }
  } satisfies GenerateReportV2PreparationResult["semanticPayload"];
  const snapshot = sha256({
    project: model.projectView,
    decision: model.gate.decision,
    score: model.score.overall,
    findings: model.active.map(safeFinding)
  });
  const preparationId = await saveDiscoveryRuntimePayload<ReportRuntimePayload>(
    projectRootPath,
    "D07_GENERATE_REPORT",
    {
      snapshot,
      findingIds: model.active.map((entry) => entry.id),
      gateDecision: model.gate.decision,
      scoreOverall: model.score.overall,
      semanticAllowed
    }
  );
  return {
    contract_version: DISCOVERY_CONTRACT_VERSION,
    preparationId,
    semanticNeeded: semanticAllowed,
    semanticPayload,
    summary: {
      active_finding_count: model.active.length,
      gate_decision: model.gate.decision,
      score_overall: model.score.overall
    }
  };
};

const defaultSummary = (
  project: { name: string; type: string; purpose: string },
  decision: string,
  score: number,
  minimumScore: number,
  findingCount: number
): string => {
  if (findingCount === 0) {
    return `Discovery completed for ${project.name}. Gate decision is ${decision} with a quality score of ${score} (minimum ${minimumScore}). No active Discovery findings were reported.`;
  }
  return `Discovery completed for ${project.name}. Gate decision is ${decision} with a quality score of ${score} (minimum ${minimumScore}) and ${findingCount} active findings.`;
};

const deterministicProse = (
  model: ReturnType<typeof preflight>
): { executive_summary_body: string; recommended_actions: Array<{ finding_id: string; action: string }> } => ({
  executive_summary_body: defaultSummary(
    model.projectView,
    model.gate.decision,
    model.score.overall,
    model.gate.score.minimum_score,
    model.active.length
  ),
  recommended_actions: model.active.map((finding) => ({
    finding_id: finding.id,
    action: `Review and resolve ${finding.kind} at ${finding.target}: ${finding.message}`
  }))
});

const validateProsePatch = (
  patch: unknown,
  model: ReturnType<typeof preflight>,
  semanticAllowed: boolean
): { executive_summary_body: string; recommended_actions: Array<{ finding_id: string; action: string }> } => {
  if (!semanticAllowed) {
    if (patch !== null && patch !== undefined) {
      throw new Error("D07 received semantic prose even though the bounded semantic task was not scheduled.");
    }
    return deterministicProse(model);
  }
  if (!isObject(patch)) throw new Error("D07 semantic prose response must be an object.");
  const keys = Object.keys(patch).sort();
  if (!deepEqual(keys, ["executive_summary_body", "recommended_actions"])) {
    throw new Error("D07 semantic prose response contains forbidden top-level fields.");
  }
  if (typeof patch.executive_summary_body !== "string" || !patch.executive_summary_body.trim()) {
    throw new Error("D07 executive_summary_body must be a non-empty string.");
  }
  if (!Array.isArray(patch.recommended_actions)) throw new Error("D07 recommended_actions must be an array.");
  const actions = patch.recommended_actions.map((raw) => {
    if (!isObject(raw) || typeof raw.finding_id !== "string" || typeof raw.action !== "string" || !raw.action.trim()) {
      throw new Error("D07 recommended action is invalid.");
    }
    return { finding_id: raw.finding_id, action: raw.action.trim() };
  });
  const expected = model.active.map((entry) => entry.id);
  const actual = actions.map((entry) => entry.finding_id);
  if (new Set(actual).size !== actual.length || !deepEqual([...actual].sort(), [...expected].sort())) {
    throw new Error("D07 recommended action finding ids must exactly match active finding ids.");
  }
  const actionById = new Map(actions.map((entry) => [entry.finding_id, entry]));
  return {
    executive_summary_body: patch.executive_summary_body.trim(),
    recommended_actions: expected.map((id) => actionById.get(id)!)
  };
};

const countBy = (items: unknown[], key: string, value: string): number =>
  items.filter((item) => isObject(item) && item[key] === value).length;

const buildMetrics = (inputs: Record<string, unknown>, model: ReturnType<typeof preflight>) => {
  const inventory = inputs["FILE_INVENTORY.json"];
  const folders = inputs["FOLDER_STRUCTURE.json"];
  const unknownFiles = inputs["UNKNOWN_FILES.json"];
  const documentIndex = inputs["DOCUMENT_INDEX.json"];
  const references = inputs["DOCUMENT_REFERENCES.json"];
  const missing = inputs["MISSING_DOCUMENTS.json"];
  const dependencies = inputs["DEPENDENCY_MAP.json"];
  const moduleMap = inputs["MODULE_MAP.json"];
  const gaps = inputs["DISCOVERY_GAPS.json"];
  const issues = inputs["DISCOVERY_ISSUES.json"];
  const warnings = inputs["DISCOVERY_WARNINGS.json"];
  if (!isObject(inventory) || !isObject(folders) || !isObject(unknownFiles) || !isObject(documentIndex) || !isObject(references) || !isObject(missing) || !isObject(dependencies) || !isObject(moduleMap) || !isObject(gaps) || !isObject(issues) || !isObject(warnings)) {
    throw new Error("D07 metric input shape is invalid.");
  }
  const moduleEntries = array(moduleMap.modules);
  const coverage = isObject(moduleMap.analysis_coverage) ? moduleMap.analysis_coverage : {};
  return {
    metadata: metadata(),
    inventory: {
      files: array(inventory.files).length,
      directories: array(folders.directories).length,
      unknown_files: array(unknownFiles.files).length
    },
    documentation: {
      documents: array(documentIndex.documents).length,
      references: array(references.references).length,
      broken_references: countBy(array(references.references), "status", "broken"),
      unchecked_references: countBy(array(references.references), "status", "unchecked"),
      missing_documents: array(missing.missing).length
    },
    dependencies: {
      manifests: array(dependencies.manifests).length,
      parsed_manifests: array(dependencies.parsed_manifests).length,
      unparsed_manifests: array(dependencies.unparsed_manifests).length,
      package_dependencies: array(dependencies.packages).length
    },
    modules: {
      count: moduleEntries.length,
      with_dependencies: moduleEntries.filter((entry) => isObject(entry) && Array.isArray(entry.depends_on) && entry.depends_on.length > 0).length,
      dependency_edges: array(moduleMap.dependency_edges).length,
      coverage: {
        unsupported_source_files: array(coverage.unsupported_source_files).length,
        unparsed_source_files: array(coverage.unparsed_source_files).length,
        unsupported_manifest_files: array(coverage.unsupported_manifest_files).length,
        unparsed_manifest_files: array(coverage.unparsed_manifest_files).length,
        unresolved_references: array(coverage.unresolved_references).length
      }
    },
    validation: {
      gaps_total: array(gaps.gaps).length,
      issues_total: array(issues.issues).length,
      warnings_total: array(warnings.warnings).length
    },
    quality: {
      score_overall: model.score.overall,
      gate_decision: model.gate.decision
    }
  };
};

const renderTable = (headers: string[], rows: unknown[][]): string => {
  const top = `| ${headers.map(markdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  return [top, separator, ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`)].join("\n");
};

const renderReport = (
  inputs: Record<string, unknown>,
  model: ReturnType<typeof preflight>,
  metrics: ReturnType<typeof buildMetrics>,
  prose: ReturnType<typeof validateProsePatch>
): string => {
  const projectContext = inputs["PROJECT_CONTEXT.json"] as Record<string, unknown>;
  const classified = inputs["CLASSIFIED_FILES.json"] as Record<string, unknown>;
  const documentIndex = inputs["DOCUMENT_INDEX.json"] as Record<string, unknown>;
  const references = inputs["DOCUMENT_REFERENCES.json"] as Record<string, unknown>;
  const missing = inputs["MISSING_DOCUMENTS.json"] as Record<string, unknown>;
  const tech = inputs["TECHNOLOGY_STACK.json"] as Record<string, unknown>;
  const dependencyMap = inputs["DEPENDENCY_MAP.json"] as Record<string, unknown>;
  const moduleMap = inputs["MODULE_MAP.json"] as Record<string, unknown>;
  const score = inputs["DISCOVERY_SCORE.json"] as Record<string, unknown>;
  const validation = inputs["DISCOVERY_VALIDATION.json"] as Record<string, unknown>;
  const gapsDoc = inputs["DISCOVERY_GAPS.json"] as Record<string, unknown>;
  const kinds = ["documentation", "source", "manifest", "configuration", "database", "asset", "script", "data", "unknown"];
  const classifiedFiles = array(classified.files);
  const projectClassifiedFiles = classifiedFiles.filter((entry) => isObject(entry) && entry.origin === "project");
  const origins = ["project", "third_party", "generated", "tool_state"];
  const techOrder = ["Language", "Runtime", "Framework", "Package Manager", "Build Backend"];
  const stack = array(tech.stack);
  const moduleRows = array(moduleMap.modules).filter(isObject).map((entry) => [
    entry.id,
    entry.name,
    entry.root,
    Array.isArray(entry.depends_on) ? entry.depends_on.join(", ") || "—" : "—"
  ]);
  const gapRowsByDimension = new Map<string, unknown[][]>();
  for (const dimension of ["presence", "schema", "consistency", "evidence", "security"]) gapRowsByDimension.set(dimension, []);
  for (const raw of array(gapsDoc.gaps)) {
    if (!isObject(raw)) continue;
    const rows = gapRowsByDimension.get(String(raw.dimension));
    rows?.push([raw.id, raw.kind, raw.severity, raw.target, raw.message]);
  }
  const validationChecks = isObject(validation) ? array(validation.checks) : [];
  const checklist = isObject(validation) && isObject(validation.checklist) ? validation.checklist : {};
  const checklistSummary = isObject(checklist.summary) ? checklist.summary : {};
  const limitations = isObject(validation) ? array(validation.coverage_limitations) : [];
  const actionText = prose.recommended_actions.length
    ? prose.recommended_actions.map((entry) => `- [${entry.finding_id}] ${entry.action}`).join("\n")
    : "No recommended actions.";

  const sections: string[] = [];
  sections.push("# Discovery Report");
  sections.push(`## Executive Summary\n\n${prose.executive_summary_body}`);
  sections.push(
    `## Project Summary\n\n${renderTable(["Field", "Value"], [
      ["Name", model.projectView.name],
      ["Type", model.projectView.type],
      ["Purpose", model.projectView.purpose],
      ["Root", isObject(projectContext.project) ? projectContext.project.root_path : "."]
    ])}`
  );
  sections.push(
    `## Inventory Summary\n\n${renderTable(["Metric", "Count"], [
      ["Files", metrics.inventory.files],
      ["Directories", metrics.inventory.directories],
      ["Unknown files", metrics.inventory.unknown_files]
    ])}\n\n### Classification\n\n${renderTable(
      ["Kind", "Count"],
      kinds.map((kind) => [kind, projectClassifiedFiles.filter((entry) => isObject(entry) && entry.kind === kind).length])
    )}

### Origin

${renderTable(
      ["Origin", "Count"],
      origins.map((origin) => [origin, classifiedFiles.filter((entry) => isObject(entry) && entry.origin === origin).length])
    )}`
  );
  const standardInventory = isObject(documentIndex.standard_documents_inventory)
    ? documentIndex.standard_documents_inventory
    : {};
  sections.push(
    `## Documentation Summary\n\n${renderTable(["Metric", "Count"], [
      ["Documents", metrics.documentation.documents],
      ["References", metrics.documentation.references],
      ["Broken references", metrics.documentation.broken_references],
      ["Unchecked references", metrics.documentation.unchecked_references],
      ["Missing documents", metrics.documentation.missing_documents]
    ])}\n\n### Standard Documents\n\n${renderTable(
      ["Document", "Present", "Paths"],
      ["README", "CHANGELOG", "CONTRIBUTING", "LICENSE"].map((name) => {
        const entry = isObject(standardInventory[name]) ? standardInventory[name] : {};
        return [name, entry.present === true ? "yes" : "no", Array.isArray(entry.paths) ? entry.paths.join(", ") || "—" : "—"];
      })
    )}`
  );
  sections.push(
    `## Technology Summary\n\n${techOrder
      .map((category) => {
        const rows = stack
          .filter(isObject)
          .filter((entry) => entry.category === category)
          .map((entry) => [entry.name, isObject(entry.evidence) ? entry.evidence.source : ""]);
        return `### ${category}\n\n${rows.length ? renderTable(["Name", "Evidence"], rows) : "None detected from direct evidence."}`;
      })
      .join("\n\n")}`
  );
  const domain = isObject(projectContext.business_domain) ? projectContext.business_domain : {};
  sections.push(
    `## Context Summary\n\n${renderTable(["Field", "Value"], [
      ["Business domain", domain.name ?? "UNKNOWN"],
      ["User roles", array(projectContext.user_roles).map((entry) => (isObject(entry) ? entry.term : "")).filter(Boolean).join(", ") || "—"],
      ["Assumptions", array(projectContext.assumptions).length],
      ["Unknowns", array(projectContext.unknowns).length]
    ])}`
  );
  const dependencyCoverage = metrics.dependencies.unparsed_manifests === 0 ? "complete_for_declared_parser_scope" : "partial";
  sections.push(
    `## Dependency Summary\n\n${renderTable(["Metric", "Value"], [
      ["Manifests", metrics.dependencies.manifests],
      ["Parsed manifests", metrics.dependencies.parsed_manifests],
      ["Unparsed manifests", metrics.dependencies.unparsed_manifests],
      ["Parsed package dependencies", metrics.dependencies.package_dependencies],
      ["Coverage", dependencyCoverage]
    ])}\n\n${array(dependencyMap.packages).length ? renderTable(["Package", "Scopes", "Evidence"], array(dependencyMap.packages).filter(isObject).map((entry) => [entry.name, Array.isArray(entry.scopes) ? entry.scopes.join(", ") : "", isObject(entry.evidence) ? entry.evidence.source : ""])) : "No package dependencies were extracted from supported manifests."}`
  );
  const moduleCoverage = Object.values(metrics.modules.coverage).every((count) => count === 0)
    ? "complete_for_defined_resolvers"
    : "partial";
  sections.push(
    `## Module Dependency Summary\n\n${renderTable(["Metric", "Value"], [
      ["Modules", metrics.modules.count],
      ["Modules with dependencies", metrics.modules.with_dependencies],
      ["Dependency edges", metrics.modules.dependency_edges],
      ["Coverage", moduleCoverage],
      ["Unresolved references", metrics.modules.coverage.unresolved_references]
    ])}\n\n${moduleRows.length ? renderTable(["Module", "Name", "Root", "Depends on"], moduleRows) : "No modules were produced."}`
  );
  const scoreComponents = isObject(score) ? array(score.components).filter(isObject) : [];
  sections.push(
    `## Quality Summary\n\n${renderTable(["Field", "Value"], [
      ["Gate", model.gate.decision],
      ["Matched rule", model.gate.matched_rule],
      ["Score", model.score.overall],
      ["Minimum score", model.gate.score.minimum_score],
      ["Active findings", model.active.length]
    ])}\n\n### Components\n\n${renderTable(["Component", "Weight", "Value", "Penalty", "Findings"], scoreComponents.map((entry) => [entry.name, entry.weight, entry.value, entry.penalty_total, entry.finding_count]))}\n\n### Checklist\n\n${renderTable(["Status", "Count"], Object.entries(checklistSummary).map(([key, value]) => [key, value]))}`
  );
  const validationParts = ["## Validation Summary"];
  for (const dimension of ["presence", "schema", "consistency", "evidence", "security"]) {
    const rows = gapRowsByDimension.get(dimension) ?? [];
    validationParts.push(`### ${dimension}\n\n${rows.length ? renderTable(["ID", "Kind", "Severity", "Target", "Message"], rows) : "No gaps."}`);
  }
  const resultCounts = ["pass", "finding", "skipped", "blocked"].map((result) => [
    result,
    validationChecks.filter((entry) => isObject(entry) && entry.result === result).length
  ]);
  validationParts.push(
    `### Validation Coverage\n\n${renderTable(["Check result", "Count"], resultCounts)}\n\nCoverage limitations: ${limitations.length}${
      limitations.length
        ? `\n\n${limitations.filter(isObject).map((entry) => `- ${entry.observation ?? "Unspecified limitation"}`).join("\n")}`
        : ""
    }`
  );
  sections.push(validationParts.join("\n\n"));
  sections.push(`## Recommended Actions\n\n${actionText}`);
  return `${sections.join("\n\n")}\n`;
};

const atomicWriteSet = async (directory: string, files: Array<{ name: string; content: string }>): Promise<void> => {
  const token = `${process.pid}-${Date.now()}`;
  const temps = files.map((file) => ({ ...file, temp: path.join(directory, `.${file.name}.${token}.tmp`) }));
  try {
    await Promise.all(temps.map((file) => writeFile(file.temp, file.content, "utf8")));
    for (const file of temps) {
      const target = path.join(directory, file.name);
      await rm(target, { force: true });
      await rename(file.temp, target);
    }
  } finally {
    await Promise.all(temps.map((file) => rm(file.temp, { force: true }).catch(() => undefined)));
  }
};

export const finalizeGenerateReportV2Job = async (
  projectRootPath: string,
  preparationId: string,
  prosePatch: unknown
): Promise<GenerateReportV2Result> => {
  const runtime = await loadDiscoveryRuntimePayload<ReportRuntimePayload>(
    projectRootPath,
    preparationId,
    "D07_GENERATE_REPORT"
  );
  try {
    const inputs = await loadInputs(projectRootPath);
    const model = preflight(inputs);
    const snapshot = sha256({
      project: model.projectView,
      decision: model.gate.decision,
      score: model.score.overall,
      findings: model.active.map(safeFinding)
    });
    if (
      snapshot !== runtime.snapshot ||
      model.gate.decision !== runtime.gateDecision ||
      model.score.overall !== runtime.scoreOverall ||
      !deepEqual(model.active.map((entry) => entry.id), runtime.findingIds)
    ) {
      throw new Error("D07 canonical inputs changed after semantic preparation; restart report generation.");
    }
    const prose = validateProsePatch(prosePatch, model, runtime.semanticAllowed);
    const metrics = buildMetrics(inputs, model);
    const validation = inputs["DISCOVERY_VALIDATION.json"]!;
    const score = inputs["DISCOVERY_SCORE.json"]!;
    const gate = inputs["DISCOVERY_GATE.json"]!;
    const gaps = inputs["DISCOVERY_GAPS.json"]!;
    const issues = inputs["DISCOVERY_ISSUES.json"]!;
    const warnings = inputs["DISCOVERY_WARNINGS.json"]!;
    const projectContext = inputs["PROJECT_CONTEXT.json"] as Record<string, unknown>;
    const result = {
      metadata: metadata(),
      project: projectContext.project,
      metrics: withoutMetadata(metrics),
      validation: withoutMetadata(validation),
      score: withoutMetadata(score),
      gate: withoutMetadata(gate),
      gaps: isObject(gaps) ? gaps.gaps : [],
      issues: isObject(issues) ? issues.issues : [],
      warnings: isObject(warnings) ? warnings.warnings : [],
      report: prose
    };
    if (!deepEqual(result.project, projectContext.project)) throw new Error("D07 result project copy invariant failed.");
    if (!deepEqual(result.gaps, isObject(gaps) ? gaps.gaps : [])) throw new Error("D07 result gaps copy invariant failed.");
    if (!deepEqual(result.issues, isObject(issues) ? issues.issues : [])) throw new Error("D07 result issues copy invariant failed.");
    if (!deepEqual(result.warnings, isObject(warnings) ? warnings.warnings : [])) throw new Error("D07 result warnings copy invariant failed.");

    const report = renderReport(inputs, model, metrics, prose);
    const executive = `# Discovery Executive Summary\n\n${prose.executive_summary_body}\n`;
    const directory = reportsDir(projectRootPath);
    await atomicWriteSet(directory, [
      { name: "DISCOVERY_REPORT.md", content: report },
      { name: "DISCOVERY_EXECUTIVE_SUMMARY.md", content: executive },
      { name: "DISCOVERY_RESULT.json", content: `${JSON.stringify(result, null, 2)}\n` },
      { name: "DISCOVERY_METRICS.json", content: `${JSON.stringify(metrics, null, 2)}\n` }
    ]);
    return {
      active_finding_count: model.active.length,
      gate_decision: model.gate.decision,
      report_files: 4,
      score_overall: model.score.overall
    };
  } finally {
    await removeDiscoveryRuntimePayload(projectRootPath, preparationId);
  }
};
