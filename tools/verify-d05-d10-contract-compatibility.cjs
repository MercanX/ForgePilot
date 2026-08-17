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

console.log(
  "D05/D10 contract compatibility verification passed (full envelope, authority checks, no double wrapping, const + date-time enforcement)."
);
