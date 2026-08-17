const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const compileAndLoad = (source, name) => {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: name,
    reportDiagnostics: true
  });
  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    throw new Error(
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("\n")
    );
  }

  const tempFile = path.join(os.tmpdir(), `forgepilot-${name}-${process.pid}.cjs`);
  fs.writeFileSync(tempFile, output.outputText, "utf8");
  try {
    delete require.cache[tempFile];
    return require(tempFile);
  } finally {
    fs.rmSync(tempFile, { force: true });
  }
};

const statementDeclaresAny = (statement, names) => {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.some(
      (declaration) => ts.isIdentifier(declaration.name) && names.has(declaration.name.text)
    );
  }
  if (ts.isTypeAliasDeclaration(statement) || ts.isFunctionDeclaration(statement)) {
    return Boolean(statement.name && names.has(statement.name.text));
  }
  return false;
};

const extractDeclarations = (filePath, declarationNames) => {
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(declarationNames);
  const chunks = sourceFile.statements
    .filter((statement) => statementDeclaresAny(statement, names))
    .map((statement) => source.slice(statement.getFullStart(), statement.end));

  for (const name of names) {
    if (!chunks.some((chunk) => chunk.includes(name))) {
      throw new Error(`Could not extract ${name} from ${filePath}.`);
    }
  }
  return chunks.join("\n");
};

const discoverySource = extractDeclarations(
  path.join(__dirname, "..", "src", "services", "discovery", "discoverySubstageService.ts"),
  ["isObject", "ISO_DATE_TIME", "AuthorizedDiscoveryStageEnvelope", "parseAuthorizedDiscoveryStageEnvelope"]
);
const discovery = compileAndLoad(discoverySource, "discovery-envelope");

const expected = {
  auditId: "AUD-001",
  label: "D05",
  substage: "D05-Project-Overview",
  workspaceHash: "c".repeat(64)
};
const validEnvelope = {
  audit_id: "AUD-001",
  completed_at: "2026-08-17T08:50:00.000Z",
  result: { substage: "D05-Project-Overview", result: "PASS", summary: "fixture", checklist: [] },
  schema_version: "1.0",
  substage: "D05-Project-Overview",
  workspace_hash: "c".repeat(64)
};

const parsed = discovery.parseAuthorizedDiscoveryStageEnvelope(validEnvelope, expected);
if (parsed.result.summary !== "fixture") throw new Error("Envelope inner result extraction failed.");
if (parsed.stageDocument.result.audit_id !== undefined) throw new Error("Double result wrapping detected.");

let flatRejected = false;
try {
  discovery.parseAuthorizedDiscoveryStageEnvelope(
    { substage: "D05-Project-Overview", result: "PASS", summary: "legacy", checklist: [] },
    expected
  );
} catch {
  flatRejected = true;
}
if (!flatRejected) throw new Error("Legacy flat D05 payload was not rejected.");

let authorityRejected = false;
try {
  discovery.parseAuthorizedDiscoveryStageEnvelope(
    { ...validEnvelope, workspace_hash: "d".repeat(64) },
    expected
  );
} catch {
  authorityRejected = true;
}
if (!authorityRejected) throw new Error("Workspace authority mismatch was not rejected.");

const d15Envelope = {
  ...validEnvelope,
  result: { substage: "D15-Database", result: "PASS", summary: "database fixture", checklist: [] },
  substage: "D15-Database"
};
const parsedD15 = discovery.parseAuthorizedDiscoveryStageEnvelope(d15Envelope, {
  ...expected,
  label: "D15",
  substage: "D15-Database"
});
if (parsedD15.result.summary !== "database fixture") {
  throw new Error("D15 full-envelope compatibility failed.");
}

const d20Envelope = {
  ...validEnvelope,
  result: { substage: "D20-Dependencies-Integrations", result: "PASS", summary: "dependencies fixture", checklist: [] },
  substage: "D20-Dependencies-Integrations"
};
const parsedD20 = discovery.parseAuthorizedDiscoveryStageEnvelope(d20Envelope, {
  ...expected,
  label: "D20",
  substage: "D20-Dependencies-Integrations"
});
if (parsedD20.result.summary !== "dependencies fixture") {
  throw new Error("D20 full-envelope compatibility failed.");
}

const d25Envelope = {
  ...validEnvelope,
  result: { substage: "D25-Backend", result: "PASS", summary: "backend fixture", checklist: [] },
  substage: "D25-Backend"
};
const parsedD25 = discovery.parseAuthorizedDiscoveryStageEnvelope(d25Envelope, {
  ...expected,
  label: "D25",
  substage: "D25-Backend"
});
if (parsedD25.result.summary !== "backend fixture") {
  throw new Error("D25 full-envelope compatibility failed.");
}

const evidenceSource = `
const { existsSync, realpathSync, statSync } = require("node:fs");
const path = require("node:path");
${extractDeclarations(
  path.join(__dirname, "..", "src", "services", "discovery", "discoverySubstageService.ts"),
  [
    "isObject",
    "asArray",
    "normalizeRelativePath",
    "evidenceArraysFromResult",
    "DISCOVERY_RUNTIME_EVIDENCE_PATHS",
    "evidencePathStatus",
    "DiscoveryStageLabel",
    "ChecklistAutoRepair",
    "AUTO_REPAIR_NOTE_PREFIX",
    "canonicalChecklistReferenceCount",
    "autoRepairChecklistEvidence",
    "validateEvidence"
  ]
)}
export { autoRepairChecklistEvidence, validateEvidence };`;
const evidenceGuard = compileAndLoad(evidenceSource, "discovery-evidence-guard");
const evidenceRepo = fs.mkdtempSync(path.join(os.tmpdir(), "forgepilot-evidence-"));
fs.mkdirSync(path.join(evidenceRepo, "website", "public", "js"), { recursive: true });
fs.writeFileSync(path.join(evidenceRepo, "website", "public", "js", "app.js"), "console.log('ok');\n");
fs.mkdirSync(
  path.join(evidenceRepo, "website", "public", "sitethem", "clinicmaster", "assets", "vendor", "wow"),
  { recursive: true }
);
fs.writeFileSync(
  path.join(evidenceRepo, "website", "public", "sitethem", "clinicmaster", "assets", "vendor", "wow", "wow.js"),
  "/* vendored evidence */\n"
);

// In-scan evidence remains valid.
evidenceGuard.validateEvidence(
  { checklist: [{ evidence: [{ path: "website/public/js/app.js" }] }] },
  evidenceRepo,
  "D05"
);
// Critical regression: a real repository file outside Startup's proactive scan set is
// still valid targeted evidence. Startup manifest membership is no longer an evidence gate.
evidenceGuard.validateEvidence(
  { checklist: [{ evidence: [{ path: "website/public/sitethem/clinicmaster/assets/vendor/wow/wow.js" }] }] },
  evidenceRepo,
  "D05"
);
evidenceGuard.validateEvidence(
  { unknowns: [{ evidence: [{ path: "@startup/scope" }] }] },
  evidenceRepo,
  "D15"
);

let nonexistentRejected = false;
try {
  evidenceGuard.validateEvidence(
    { checklist: [{ evidence: [{ path: "website/public/vendor/does-not-exist.js" }] }] },
    evidenceRepo,
    "D20"
  );
} catch (error) {
  nonexistentRejected = String(error?.message ?? error).includes("repository evidence path does not exist");
}
if (!nonexistentRejected) {
  throw new Error("Nonexistent Discovery evidence path was not rejected.");
}

let absoluteEvidenceRejected = false;
try {
  evidenceGuard.validateEvidence(
    { findings: [{ evidence: [{ path: "C:/repo/secret.env" }] }] },
    evidenceRepo,
    "D25"
  );
} catch {
  absoluteEvidenceRejected = true;
}
if (!absoluteEvidenceRejected) {
  throw new Error("Absolute Discovery evidence path was not rejected.");
}

const repairFixture = {
  checklist: [
    {
      check_id: "OV-029",
      status: "CHECKED_OK",
      evidence: [{ path: "website/public/vendor/missing.js" }],
      finding_ids: [],
      unknown_ids: [],
      contradiction_ids: [],
      strength_ids: [],
      notes: "Provider claimed a file pair."
    }
  ]
};
const repairs = evidenceGuard.autoRepairChecklistEvidence(repairFixture, evidenceRepo, "D05");
if (repairs.length !== 1 || repairFixture.checklist[0].status !== "NOT_INSPECTED_WITH_REASON") {
  throw new Error("Safe checklist-only evidence defect was not auto-repaired.");
}
if (!String(repairFixture.checklist[0].notes).includes("[ForgePilot auto-repair]")) {
  throw new Error("Checklist auto-repair did not record an explicit repair note.");
}

let unsafeRepairRejected = false;
try {
  evidenceGuard.autoRepairChecklistEvidence(
    {
      checklist: [
        {
          check_id: "OV-029",
          status: "CHECKED_OK",
          evidence: [{ path: "website/public/vendor/missing.js" }],
          finding_ids: ["PO-F01"],
          unknown_ids: [],
          contradiction_ids: [],
          strength_ids: [],
          notes: "semantic link"
        }
      ]
    },
    evidenceRepo,
    "D05"
  );
} catch (error) {
  unsafeRepairRejected = String(error?.message ?? error).includes("unsafe evidence defect");
}
if (!unsafeRepairRejected) {
  throw new Error("Auto-repair silently changed a checklist record tied to canonical semantics.");
}
fs.rmSync(evidenceRepo, { recursive: true, force: true });

const discoveryServiceSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "discovery", "discoverySubstageService.ts"),
  "utf8"
);
for (const [functionName, validationNeedle] of [
  ["runSaveD05ResultJob", "validateEvidence(result, projectRootPath, \"D05\")"],
  ["runSaveD10ResultJob", "validateD10Evidence(result, projectRootPath)"],
  ["runSaveD15ResultJob", "validateD15Evidence(result, projectRootPath)"],
  ["runSaveD20ResultJob", "validateD20Evidence(result, projectRootPath)"],
  ["runSaveD25ResultJob", "validateD25Evidence(result, projectRootPath)"]
]) {
  const start = discoveryServiceSource.indexOf(`export const ${functionName}`);
  if (start < 0) throw new Error(`${functionName} is missing.`);
  const nextExport = discoveryServiceSource.indexOf("\nexport const ", start + 20);
  const body = discoveryServiceSource.slice(start, nextExport < 0 ? undefined : nextExport);
  const validationIndex = body.indexOf(validationNeedle);
  const persistIndex = body.indexOf("await writeJson(stageFile(projectRootPath, auditId");
  if (validationIndex < 0 || persistIndex < 0 || validationIndex > persistIndex) {
    throw new Error(`${functionName} does not validate evidence before persisting the stage result.`);
  }
}

const executionSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "jobs", "stageExecutionService.ts"),
  "utf8"
);
if (!executionSource.includes('const message = error instanceof Error ? error.message : "Local operation failed.";') ||
    !executionSource.includes('status: "failed",\n            stepId: directive.id')) {
  throw new Error("Local validation failures are not surfaced as failed progress events.");
}

const mockCloudSource = fs.readFileSync(
  path.join(__dirname, "mock-cloud", "mock-cloud.cjs"),
  "utf8"
);
if (/D(?:05|10|15|20|25).*AI audit completed\./.test(mockCloudSource)) {
  throw new Error("Mock cloud still reports provider generation as a completed audit before deterministic validation.");
}
if (!mockCloudSource.includes("deterministic evidence/checklist validation is pending")) {
  throw new Error("Pending deterministic validation activity wording is missing.");
}

const validatorSource = extractDeclarations(
  path.join(__dirname, "..", "src", "services", "jobs", "stageExecutionService.ts"),
  ["isJsonObject", "JsonSchema", "resolveLocalSchemaRef", "jsonValuesEqual", "validateJsonSchemaValue", "validateOutputContract"]
);
const validator = compileAndLoad(validatorSource, "json-schema-validator");
const schema = {
  type: "object",
  properties: {
    completed_at: { type: "string", format: "date-time" },
    schema_version: { type: "string", const: "1.0" },
    substage: { type: "string", const: "D05-Project-Overview" }
  },
  required: ["completed_at", "schema_version", "substage"],
  additionalProperties: false
};

let errors = validator.validateOutputContract(
  {
    completed_at: "2026-08-17T08:50:00.000Z",
    schema_version: "1.0",
    substage: "D05-Project-Overview"
  },
  schema
);
if (errors.length > 0) throw new Error(`Valid schema fixture failed: ${errors.join("; ")}`);

errors = validator.validateOutputContract(
  {
    completed_at: "2026-08-17T08:50:00.000Z",
    schema_version: "2.0",
    substage: "D05-Project-Overview"
  },
  schema
);
if (!errors.some((error) => error.includes("required const"))) {
  throw new Error("JSON Schema const mismatch is not enforced.");
}

errors = validator.validateOutputContract(
  {
    completed_at: "2026-08-17 08:50:00",
    schema_version: "1.0",
    substage: "D05-Project-Overview"
  },
  schema
);
if (!errors.some((error) => error.includes("valid date-time"))) {
  throw new Error("JSON Schema date-time format is not enforced.");
}

const fullDiscoveryRuntimeSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "services", "discovery", "discoverySubstageService.ts"),
  "utf8"
);
const resetRegion = (resetName, nextMarker) => {
  const start = fullDiscoveryRuntimeSource.indexOf(`const ${resetName} =`);
  const end = fullDiscoveryRuntimeSource.indexOf(nextMarker, start);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${resetName} invalidation region.`);
  return fullDiscoveryRuntimeSource.slice(start, end);
};
const expectInvalidation = (region, stageConstant, resetName) => {
  if (!region.includes(`stageName: ${stageConstant}`)) {
    throw new Error(`${resetName} does not invalidate downstream ${stageConstant}.`);
  }
};
const d05ResetRegion = resetRegion("resetD05", "export type D05StatusResult");
expectInvalidation(d05ResetRegion, "D10_NAME", "resetD05");
expectInvalidation(d05ResetRegion, "D15_NAME", "resetD05");
expectInvalidation(d05ResetRegion, "D20_NAME", "resetD05");
expectInvalidation(d05ResetRegion, "D25_NAME", "resetD05");
const d10ResetRegion = resetRegion("resetD10", "const buildD10DiscoveryContext");
expectInvalidation(d10ResetRegion, "D15_NAME", "resetD10");
expectInvalidation(d10ResetRegion, "D20_NAME", "resetD10");
expectInvalidation(d10ResetRegion, "D25_NAME", "resetD10");
const d15ResetRegion = resetRegion("resetD15", "const buildD15DiscoveryContext");
expectInvalidation(d15ResetRegion, "D25_NAME", "resetD15");
const d20ResetRegion = resetRegion("resetD20", "const buildD20DiscoveryContext");
expectInvalidation(d20ResetRegion, "D25_NAME", "resetD20");

const mockCloudRuntimeSource = fs.readFileSync(path.join(__dirname, "mock-cloud", "mock-cloud.cjs"), "utf8");
if (!mockCloudRuntimeSource.includes("const unmarkStageAndHardDependents")) {
  throw new Error("Mock cloud does not publish dependency-aware downstream restart invalidation.");
}

console.log(
  "Discovery D05/D10/D15/D20/D25 compatibility verification passed (full envelopes, scan-scope/evidence-separation guard + checklist auto-repair, validation-before-persist, HARD downstream restart invalidation, explicit local failure activity, const + date-time enforcement)."
);
