const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const typescriptPath = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'typescript');
const ts = require(typescriptPath);

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'services', 'jobs', 'stageExecutionService.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true
  },
  fileName: sourcePath,
  reportDiagnostics: true
});

const syntaxErrors = (compiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
);
if (syntaxErrors.length > 0) {
  throw new Error(
    `TypeScript transpile failed: ${syntaxErrors.map((item) => item.messageText).join('; ')}`
  );
}

const runtimeModule = { exports: {} };
const mockRequire = (id) => {
  if (id === '@shared/constants/providerIds') {
    return { PROVIDER_IDS: { claudeCode: 'claude-code', codex: 'codex' } };
  }
  if (id === '@shared/constants/protocolVersion') {
    return { SUPPORTED_CAPABILITIES: [] };
  }
  if (id === '@shared/schemas/cloud-api') {
    return {};
  }
  if (id === '@shared/schemas/execution') {
    return {};
  }
  if (id === '../api/httpClient') {
    return { createHttpClient: () => { throw new Error('not used in parser regression'); } };
  }
  if (id === '../tasks/taskExecutionService') {
    return { createTaskExecutionService: () => { throw new Error('not used in parser regression'); } };
  }
  if (id === './localOperationRegistry') {
    return { createLocalOperationRegistry: () => { throw new Error('not used in parser regression'); } };
  }
  if (id === './stageExecutionJournal') {
    return { createStageExecutionJournal: () => { throw new Error('not used in parser regression'); } };
  }
  return Module.createRequire(sourcePath)(id);
};

const evaluator = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled.outputText);
evaluator(mockRequire, runtimeModule, runtimeModule.exports, sourcePath, path.dirname(sourcePath));

const { parseLastJsonObject, validateOutputContract } = runtimeModule.exports;
if (typeof parseLastJsonObject !== 'function' || typeof validateOutputContract !== 'function') {
  throw new Error('Expected parser exports were not found.');
}

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['audit_id', 'completed_at', 'schema_version', 'substage', 'workspace_hash', 'result'],
  properties: {
    audit_id: { type: 'string' },
    completed_at: { type: 'string' },
    schema_version: { type: 'string' },
    substage: { type: 'string' },
    workspace_hash: { type: 'string' },
    result: { type: 'object' }
  }
};

const envelope = {
  audit_id: 'AUD-002',
  completed_at: '2026-08-17T12:00:00Z',
  schema_version: '1.0',
  substage: 'D05-Project-Overview',
  workspace_hash: 'e6c5a2bdcc794757fdbdcb23804d311209bece38eb3f0eab8146f2b6abf4d71c',
  result: {
    substage: 'D05-Project-Overview',
    result: 'PASS_WITH_FINDINGS',
    handoff: { recommended_next_substages: [], cautions: ['scope preserved'] }
  }
};

const assistantEvent = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'text',
        text: `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``
      }
    ]
  }
};
const truncatedResultEvent = {
  type: 'result',
  is_error: false,
  num_turns: 65,
  result:
    'OV-045 tail only... {"recommended_next_substages":[],"cautions":["scope preserved"]}'
};
const stream = `${JSON.stringify(assistantEvent)}\n${JSON.stringify(truncatedResultEvent)}\n`;
const chunks = [
  { stream: 'stdout', text: stream.slice(0, 47), timestamp: '2026-08-17T12:00:00Z' },
  { stream: 'stdout', text: stream.slice(47, 211), timestamp: '2026-08-17T12:00:01Z' },
  { stream: 'stdout', text: stream.slice(211), timestamp: '2026-08-17T12:00:02Z' }
];

const recovered = parseLastJsonObject(chunks, 'claude-code', schema);
if (!recovered || recovered.audit_id !== 'AUD-002') {
  throw new Error(`Regression: truncated result tail won over complete assistant envelope: ${JSON.stringify(recovered)}`);
}
if (validateOutputContract(recovered, schema).length !== 0) {
  throw new Error(`Recovered assistant envelope did not satisfy the contract: ${validateOutputContract(recovered, schema).join('; ')}`);
}

const noSchemaRecovered = parseLastJsonObject(chunks, 'claude-code');
if (!noSchemaRecovered || noSchemaRecovered.audit_id !== 'AUD-002') {
  throw new Error('Regression: largest complete assistant object was not preferred without a schema.');
}

const completeResultEvent = {
  type: 'result',
  is_error: false,
  num_turns: 1,
  result: `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``
};
const completeChunks = [
  {
    stream: 'stdout',
    text: `${JSON.stringify(completeResultEvent)}\n`,
    timestamp: '2026-08-17T12:00:03Z'
  }
];
const direct = parseLastJsonObject(completeChunks, 'claude-code', schema);
if (!direct || direct.audit_id !== 'AUD-002') {
  throw new Error('Regression: a complete Claude result event no longer parses.');
}

console.log('PASS provider-output parser regression');
console.log('- truncated Claude result tail: rejected as contract root');
console.log('- complete Claude assistant event: recovered and selected');
console.log('- complete Claude result event: still accepted');
