import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DISCOVERY_GAP_KINDS,
  type DiscoveryGapKind,
  type DiscoverySeverity
} from "./discoveryValidationService";
import { DISCOVERY_CONTRACT_VERSION } from "./discoverySemanticPreparation";

const REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const SEVERITY_PENALTY: Record<DiscoverySeverity, number> = {
  CRITICAL: 50,
  HIGH: 15,
  MEDIUM: 5,
  LOW: 2,
  INFO: 0
};

type Rational = { numerator: bigint; denominator: bigint };

const gcd = (left: bigint, right: bigint): bigint => {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
};

const normalizeRational = (value: Rational): Rational => {
  const divisor = gcd(value.numerator, value.denominator);
  const sign = value.denominator < 0n ? -1n : 1n;
  return {
    numerator: (value.numerator / divisor) * sign,
    denominator: (value.denominator / divisor) * sign
  };
};

const numberToRational = (value: number): Rational => {
  if (!Number.isFinite(value)) throw new Error("D06 cannot score a non-finite policy weight.");
  const [coefficient, exponentRaw] = value.toString().toLowerCase().split("e");
  const exponent = exponentRaw ? Number(exponentRaw) : 0;
  const negative = coefficient!.startsWith("-");
  const unsigned = negative ? coefficient!.slice(1) : coefficient!;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole || "0"}${fraction}`.replace(/^0+(?=\d)/, "") || "0";
  const scale = fraction.length - exponent;
  let numerator = BigInt(digits) * (negative ? -1n : 1n);
  let denominator = 1n;
  if (scale > 0) denominator = 10n ** BigInt(scale);
  else if (scale < 0) numerator *= 10n ** BigInt(-scale);
  return normalizeRational({ numerator, denominator });
};

const addRational = (left: Rational, right: Rational): Rational =>
  normalizeRational({
    numerator: left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator
  });

const multiplyRationalByInteger = (value: Rational, multiplier: number): Rational =>
  normalizeRational({
    numerator: value.numerator * BigInt(multiplier),
    denominator: value.denominator
  });

const divideRational = (left: Rational, right: Rational): Rational => {
  if (right.numerator === 0n) throw new Error("D06 score policy weight total cannot be zero.");
  return normalizeRational({
    numerator: left.numerator * right.denominator,
    denominator: left.denominator * right.numerator
  });
};

const roundHalfUp = (value: Rational): number => {
  if (value.numerator < 0n || value.denominator <= 0n) {
    throw new Error("D06 score rational must be non-negative.");
  }
  const quotient = value.numerator / value.denominator;
  const remainder = value.numerator % value.denominator;
  const rounded = remainder * 2n >= value.denominator ? quotient + 1n : quotient;
  return Number(rounded);
};

export type DiscoveryScorePolicy = {
  components: Array<{
    name: string;
    weight: number;
    gap_kinds: string[];
  }>;
};

export type ScoreAndGateResult = {
  decision: "PASS" | "PASS_WITH_WARNINGS" | "REVISION_REQUIRED" | "FAIL";
  finding_count: number;
  matched_rule:
    | "GATE-D06-01"
    | "GATE-D06-02"
    | "GATE-D06-03"
    | "GATE-D06-04"
    | "GATE-D06-05"
    | "GATE-D06-06"
    | "GATE-D06-07";
  overall: number;
};

type Gap = {
  id: string;
  kind: DiscoveryGapKind;
  severity: DiscoverySeverity;
  target: string;
  message: string;
  evidence: unknown[];
};

type Finding = {
  id: string;
  gap_id: string;
  kind: DiscoveryGapKind;
  severity: DiscoverySeverity;
  target: string;
  message: string;
  evidence: unknown[];
};

type ChecklistItem = {
  id: string;
  obligation: "mandatory" | "reporting" | "post_gate" | "human";
  status: "pass" | "fail" | "blocked" | "skipped" | "pending_human";
  reason: string | null;
};

const reportsDir = (projectRootPath: string): string => path.join(projectRootPath, ...REPORTS_SEGMENTS);
const metadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: DISCOVERY_CONTRACT_VERSION
});
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const readJson = async (filePath: string): Promise<unknown> => JSON.parse(await readFile(filePath, "utf8"));
const writeJson = async (filePath: string, value: unknown): Promise<void> =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
const deepEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const parseGap = (value: unknown): Gap => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    !DISCOVERY_GAP_KINDS.includes(value.kind as DiscoveryGapKind) ||
    typeof value.severity !== "string" ||
    !(value.severity in SEVERITY_PENALTY) ||
    typeof value.target !== "string" ||
    typeof value.message !== "string" ||
    !Array.isArray(value.evidence)
  ) {
    throw new Error("D06 received an invalid gap record.");
  }
  return value as unknown as Gap;
};

const parseFinding = (value: unknown): Finding => {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.gap_id !== "string" ||
    typeof value.kind !== "string" ||
    !DISCOVERY_GAP_KINDS.includes(value.kind as DiscoveryGapKind) ||
    typeof value.severity !== "string" ||
    !(value.severity in SEVERITY_PENALTY) ||
    typeof value.target !== "string" ||
    typeof value.message !== "string" ||
    !Array.isArray(value.evidence)
  ) {
    throw new Error("D06 received an invalid finding record.");
  }
  return value as unknown as Finding;
};

const validatePolicy = (
  policy: DiscoveryScorePolicy
): Array<{ name: string; weight: number; gap_kinds: DiscoveryGapKind[] }> => {
  if (!policy || !Array.isArray(policy.components) || policy.components.length === 0) {
    throw new Error("D06 score policy must contain at least one component.");
  }
  const names = new Set<string>();
  const mapped = new Map<DiscoveryGapKind, string>();
  const result: Array<{ name: string; weight: number; gap_kinds: DiscoveryGapKind[] }> = [];
  for (const component of policy.components) {
    if (!component || typeof component.name !== "string" || !component.name.trim()) {
      throw new Error("D06 score policy component name is invalid.");
    }
    if (names.has(component.name)) throw new Error(`Duplicate D06 component name: ${component.name}`);
    names.add(component.name);
    if (!Number.isFinite(component.weight) || component.weight <= 0) {
      throw new Error(`D06 component weight must be positive: ${component.name}`);
    }
    if (!Array.isArray(component.gap_kinds)) {
      throw new Error(`D06 component gap_kinds must be an array: ${component.name}`);
    }
    const kinds = component.gap_kinds.map((kind) => {
      if (!DISCOVERY_GAP_KINDS.includes(kind as DiscoveryGapKind)) {
        throw new Error(`D06 score policy contains unknown gap kind: ${kind}`);
      }
      return kind as DiscoveryGapKind;
    });
    if (new Set(kinds).size !== kinds.length) {
      throw new Error(`D06 component contains duplicate gap kind: ${component.name}`);
    }
    for (const kind of kinds) {
      if (mapped.has(kind)) throw new Error(`D06 gap kind is mapped more than once: ${kind}`);
      mapped.set(kind, component.name);
    }
    result.push({ name: component.name, weight: component.weight, gap_kinds: kinds });
  }
  for (const kind of DISCOVERY_GAP_KINDS) {
    if (!mapped.has(kind)) throw new Error(`D06 score policy does not map gap kind: ${kind}`);
  }
  return result;
};

const parseChecklistItems = (validation: unknown): ChecklistItem[] => {
  if (!isObject(validation) || !isObject(validation.checklist) || !Array.isArray(validation.checklist.items)) {
    throw new Error("D06 received invalid DISCOVERY_VALIDATION checklist data.");
  }
  return validation.checklist.items.map((raw) => {
    if (
      !isObject(raw) ||
      typeof raw.id !== "string" ||
      !["mandatory", "reporting", "post_gate", "human"].includes(String(raw.obligation)) ||
      !["pass", "fail", "blocked", "skipped", "pending_human"].includes(String(raw.status))
    ) {
      throw new Error("D06 checklist item is invalid.");
    }
    const obligation = raw.obligation as ChecklistItem["obligation"];
    const status = raw.status as ChecklistItem["status"];
    const valid =
      (obligation === "mandatory" && ["pass", "fail", "blocked"].includes(status)) ||
      (obligation === "reporting" && ["pass", "fail"].includes(status)) ||
      (obligation === "post_gate" && status === "skipped") ||
      (obligation === "human" && status === "pending_human");
    if (!valid) throw new Error(`D06 checklist status is invalid for ${obligation}: ${status}`);
    return {
      id: raw.id,
      obligation,
      status,
      reason: typeof raw.reason === "string" ? raw.reason : null
    };
  });
};

const checklistSummary = (items: ChecklistItem[]) => ({
  mandatory: {
    pass: items.filter((item) => item.obligation === "mandatory" && item.status === "pass").length,
    fail: items.filter((item) => item.obligation === "mandatory" && item.status === "fail").length,
    blocked: items.filter((item) => item.obligation === "mandatory" && item.status === "blocked").length
  },
  reporting: {
    pass: items.filter((item) => item.obligation === "reporting" && item.status === "pass").length,
    fail: items.filter((item) => item.obligation === "reporting" && item.status === "fail").length
  },
  post_gate: {
    skipped: items.filter((item) => item.obligation === "post_gate" && item.status === "skipped").length
  },
  human: {
    pending_human: items.filter((item) => item.obligation === "human" && item.status === "pending_human").length
  }
});

const findingSummary = (findings: Finding[]) => ({
  total: findings.length,
  critical: findings.filter((entry) => entry.severity === "CRITICAL").length,
  high: findings.filter((entry) => entry.severity === "HIGH").length,
  medium: findings.filter((entry) => entry.severity === "MEDIUM").length,
  low: findings.filter((entry) => entry.severity === "LOW").length,
  info: findings.filter((entry) => entry.severity === "INFO").length
});

export const runScoreAndGateV2Job = async (
  projectRootPath: string,
  scorePolicyInput: DiscoveryScorePolicy,
  minimumScore: number
): Promise<ScoreAndGateResult> => {
  if (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 100) {
    throw new Error("D06 minimum score must be an integer from 0 through 100.");
  }
  const policy = validatePolicy(scorePolicyInput);
  const directory = reportsDir(projectRootPath);
  const [validation, gapsDoc, issuesDoc, warningsDoc] = await Promise.all([
    readJson(path.join(directory, "DISCOVERY_VALIDATION.json")),
    readJson(path.join(directory, "DISCOVERY_GAPS.json")),
    readJson(path.join(directory, "DISCOVERY_ISSUES.json")),
    readJson(path.join(directory, "DISCOVERY_WARNINGS.json"))
  ]);
  if (!isObject(gapsDoc) || !Array.isArray(gapsDoc.gaps)) throw new Error("Invalid DISCOVERY_GAPS.json.");
  if (!isObject(issuesDoc) || !Array.isArray(issuesDoc.issues)) throw new Error("Invalid DISCOVERY_ISSUES.json.");
  if (!isObject(warningsDoc) || !Array.isArray(warningsDoc.warnings)) throw new Error("Invalid DISCOVERY_WARNINGS.json.");
  const gaps = gapsDoc.gaps.map(parseGap);
  const issues = issuesDoc.issues.map(parseFinding);
  const warnings = warningsDoc.warnings.map(parseFinding);
  const active = [...issues, ...warnings];

  const gapById = new Map(gaps.map((gap) => [gap.id, gap]));
  if (gapById.size !== gaps.length) throw new Error("D06 gap ids are not unique.");
  const findingIds = new Set<string>();
  for (const finding of active) {
    if (findingIds.has(finding.id)) throw new Error(`D06 duplicate finding id: ${finding.id}`);
    findingIds.add(finding.id);
    const gap = gapById.get(finding.gap_id);
    if (!gap) throw new Error(`D06 finding references unknown gap: ${finding.gap_id}`);
    if (
      finding.kind !== gap.kind ||
      finding.severity !== gap.severity ||
      finding.target !== gap.target ||
      finding.message !== gap.message ||
      !deepEqual(finding.evidence, gap.evidence)
    ) {
      throw new Error(`D06 finding does not exactly match counterpart gap: ${finding.id}`);
    }
    const shouldIssue = gap.severity === "HIGH" || gap.severity === "CRITICAL";
    if (shouldIssue !== issues.includes(finding)) {
      throw new Error(`D06 finding is routed to the wrong carrier: ${finding.id}`);
    }
  }
  for (const gap of gaps) {
    const counterparts = active.filter((finding) => finding.gap_id === gap.id);
    if (counterparts.length !== 1) throw new Error(`D06 gap must have exactly one finding counterpart: ${gap.id}`);
  }
  if (gaps.length !== active.length) throw new Error("D06 gap/finding counts do not match.");

  const componentFor = new Map<DiscoveryGapKind, string>();
  for (const component of policy) {
    for (const kind of component.gap_kinds) componentFor.set(kind, component.name);
  }
  const appliedFindings = active.map((finding) => ({
    finding_id: finding.id,
    gap_id: finding.gap_id,
    kind: finding.kind,
    severity: finding.severity,
    component: componentFor.get(finding.kind)!,
    penalty: SEVERITY_PENALTY[finding.severity]
  }));
  const componentOrder = new Map(policy.map((component, index) => [component.name, index]));
  appliedFindings.sort((left, right) => {
    const componentDiff = (componentOrder.get(left.component) ?? 0) - (componentOrder.get(right.component) ?? 0);
    return componentDiff !== 0 ? componentDiff : left.finding_id.localeCompare(right.finding_id);
  });
  const components = policy.map((component) => {
    const relevant = appliedFindings.filter((entry) => entry.component === component.name);
    const penaltyTotal = relevant.reduce((sum, entry) => sum + entry.penalty, 0);
    return {
      name: component.name,
      weight: component.weight,
      value: Math.max(0, 100 - penaltyTotal),
      penalty_total: penaltyTotal,
      finding_count: relevant.length
    };
  });
  const weightedNumerator = components.reduce<Rational>(
    (sum, component) =>
      addRational(sum, multiplyRationalByInteger(numberToRational(component.weight), component.value)),
    { numerator: 0n, denominator: 1n }
  );
  const weightTotal = components.reduce<Rational>(
    (sum, component) => addRational(sum, numberToRational(component.weight)),
    { numerator: 0n, denominator: 1n }
  );
  // Policy weights may be decimal values. Score math therefore stays rational
  // until the contract-defined round-half-up step instead of relying on binary
  // floating point.
  const overall = roundHalfUp(divideRational(weightedNumerator, weightTotal));
  const score = {
    metadata: metadata(),
    overall,
    components,
    finding_count: active.length,
    issue_count: issues.length,
    warning_count: warnings.length,
    applied_findings: appliedFindings
  };

  const checklistItems = parseChecklistItems(validation);
  const checklist = checklistSummary(checklistItems);
  const summary = findingSummary(active);
  let decision: ScoreAndGateResult["decision"];
  let matchedRule: ScoreAndGateResult["matched_rule"];
  let decisionEvidence: Array<Record<string, unknown>>;
  const findingEvidence = (finding: Finding): Record<string, unknown> => ({
    type: "finding",
    finding_id: finding.id,
    gap_id: finding.gap_id,
    kind: finding.kind,
    severity: finding.severity
  });

  const critical = active.filter((entry) => entry.severity === "CRITICAL");
  const schemaInvalid = active.filter((entry) => entry.kind === "output_schema_invalid");
  const mandatoryMissing = active.filter((entry) => entry.kind === "mandatory_output_missing");
  const mandatoryChecklist = checklistItems.filter(
    (item) => item.obligation === "mandatory" && (item.status === "fail" || item.status === "blocked")
  );
  const nonInfo = active.filter((entry) => entry.severity !== "INFO");

  if (critical.length) {
    decision = "FAIL";
    matchedRule = "GATE-D06-01";
    decisionEvidence = critical.map(findingEvidence);
  } else if (schemaInvalid.length) {
    decision = "FAIL";
    matchedRule = "GATE-D06-02";
    decisionEvidence = schemaInvalid.map(findingEvidence);
  } else if (mandatoryMissing.length) {
    decision = "REVISION_REQUIRED";
    matchedRule = "GATE-D06-03";
    decisionEvidence = mandatoryMissing.map(findingEvidence);
  } else if (mandatoryChecklist.length) {
    decision = "REVISION_REQUIRED";
    matchedRule = "GATE-D06-04";
    decisionEvidence = mandatoryChecklist.map((item) => ({ type: "checklist", item_id: item.id, status: item.status }));
  } else if (overall < minimumScore) {
    decision = "REVISION_REQUIRED";
    matchedRule = "GATE-D06-05";
    decisionEvidence = [{ type: "score", overall, minimum_score: minimumScore }];
  } else if (nonInfo.length) {
    decision = "PASS_WITH_WARNINGS";
    matchedRule = "GATE-D06-06";
    decisionEvidence = nonInfo.map(findingEvidence);
  } else {
    decision = "PASS";
    matchedRule = "GATE-D06-07";
    decisionEvidence = [];
  }

  const gate = {
    metadata: metadata(),
    decision,
    matched_rule: matchedRule,
    score: { overall, minimum_score: minimumScore },
    finding_summary: summary,
    checklist,
    decision_evidence: decisionEvidence
  };

  await writeJson(path.join(directory, "DISCOVERY_SCORE.json"), score);
  await writeJson(path.join(directory, "DISCOVERY_GATE.json"), gate);
  return { decision, finding_count: active.length, matched_rule: matchedRule, overall };
};
