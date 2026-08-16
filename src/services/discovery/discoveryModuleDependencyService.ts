import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseToml } from "smol-toml";
import ts from "typescript";

import type { FileFormat, FileKind } from "./discoveryJobService";

const REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const CONTEXT_SEGMENTS = [".ai-factory", "context", "project"];
const JS_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const SUPPORTED_SOURCE_FORMATS = new Set<FileFormat>([
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "python",
  "php",
  "go"
]);
const SUPPORTED_MANIFEST_BASENAMES = new Set([
  "package.json",
  "composer.json",
  "go.mod",
  "Cargo.toml"
]);
const UNSUPPORTED_MANIFEST_BASENAMES = new Set([
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "Pipfile"
]);
const MSBUILD_EXTENSIONS = new Set([".csproj", ".fsproj", ".vbproj"]);

const metadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: "2.0.0"
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, "utf8")) as T;

const writeJson = async (filePath: string, value: unknown): Promise<void> =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");

const normalizeProjectPath = (value: string): { outside: boolean; path: string } => {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  const outside = normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized);
  return { outside, path: normalized.replace(/^\.\//, "") };
};

const moduleManifestPath = (root: string, basename: string): string =>
  root === "." ? basename : `${root}/${basename}`;

const moduleRootForPath = (filePath: string): string => {
  const dir = path.posix.dirname(filePath);
  return dir === "." ? "." : dir;
};

type ClassifiedFile = {
  format: FileFormat;
  kind: FileKind;
  path: string;
  signals: string[];
};

type ClassifiedDocument = {
  files: ClassifiedFile[];
};

type BaseModule = {
  id: string;
  name: string;
  root: string;
  paths: string[];
  summary: unknown;
  description: string;
  description_evidence: unknown;
  [key: string]: unknown;
};

type BaseModuleMap = {
  metadata: Record<string, unknown>;
  modules: BaseModule[];
};

type EdgeEvidence = {
  kind: "source_reference" | "manifest_reference";
  resolver: string;
  source: string;
  line: number | null;
  field: string | null;
  raw_target: string;
};

type DependencyEdge = {
  source_module: string;
  target_module: string;
  evidence: EdgeEvidence;
};

type UnresolvedReference = {
  source: string;
  line: number | null;
  field: string | null;
  raw_target: string;
  reason:
    | "target_not_found"
    | "ambiguous_target"
    | "outside_project"
    | "unsupported_alias"
    | "dynamic_reference"
    | "ambiguous_local_package"
    | "ambiguous_local_namespace"
    | "ambiguous_local_module"
    | "unsupported_reference_form";
};

type RegistryEntry = { moduleId: string; root: string };
type Psr4Entry = RegistryEntry & { baseDir: string; prefix: string };

type ParsedManifest = {
  path: string;
  module: BaseModule;
  content: string;
  json?: Record<string, unknown>;
  toml?: Record<string, unknown>;
};

const addRegistry = (registry: Map<string, RegistryEntry[]>, key: string, entry: RegistryEntry): void => {
  const trimmed = key.trim();
  if (!trimmed) return;
  const values = registry.get(trimmed) ?? [];
  if (!values.some((value) => value.moduleId === entry.moduleId && value.root === entry.root)) {
    values.push(entry);
  }
  registry.set(trimmed, values);
};

const scriptKindFor = (format: FileFormat): ts.ScriptKind => {
  if (format === "tsx") return ts.ScriptKind.TSX;
  if (format === "jsx") return ts.ScriptKind.JSX;
  if (format === "typescript") return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
};

const packageKey = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
};

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false)).line + 1;

type SourceReference = {
  rawTarget: string;
  line: number;
  dynamic?: boolean;
};

const parseJsTsReferences = (
  filePath: string,
  content: string,
  format: FileFormat
): { ok: boolean; references: SourceReference[] } => {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(format)
  );

  const parseDiagnostics = (sourceFile as ts.SourceFile & {
    parseDiagnostics?: readonly ts.Diagnostic[];
  }).parseDiagnostics;
  if (parseDiagnostics && parseDiagnostics.length > 0) {
    return { ok: false, references: [] };
  }

  const references: SourceReference[] = [];
  const addLiteral = (node: ts.Node, expression: ts.Expression | undefined): void => {
    if (!expression) return;
    if (ts.isStringLiteralLike(expression)) {
      references.push({ line: lineOf(sourceFile, node), rawTarget: expression.text });
      return;
    }
    references.push({ dynamic: true, line: lineOf(sourceFile, node), rawTarget: expression.getText(sourceFile) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({ line: lineOf(sourceFile, node), rawTarget: node.moduleSpecifier.text });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      references.push({ line: lineOf(sourceFile, node), rawTarget: node.moduleSpecifier.text });
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        addLiteral(node, node.arguments[0]);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        addLiteral(node, node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { ok: true, references };
};

const parsePythonRelativeReferences = (content: string): SourceReference[] => {
  const references: SourceReference[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const stripped = line.replace(/#.*$/, "").trim();
    const match = /^from\s+(\.+)([A-Za-z_][\w.]*)?\s+import\s+(.+)$/.exec(stripped);
    if (!match) return;
    const dots = match[1] ?? "";
    const tail = match[2] ?? "";
    const imported = (match[3] ?? "").replace(/[()]/g, "");

    if (tail) {
      references.push({ line: index + 1, rawTarget: `${dots}${tail}` });
      return;
    }

    for (const part of imported.split(",")) {
      const name = part.trim().split(/\s+as\s+/i)[0]?.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) {
        references.push({ line: index + 1, rawTarget: `${dots}${name}` });
      }
    }
  });

  return references;
};

const parsePhpUses = (content: string): SourceReference[] => {
  const references: SourceReference[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const stripped = line.replace(/\/\/.*$/, "").trim();
    if (!/^use\s+/i.test(stripped) || /^use\s+(function|const)\s+/i.test(stripped)) return;
    const body = stripped.replace(/^use\s+/i, "").replace(/;\s*$/, "").trim();
    const groupMatch = /^(.+?)\\\{(.+)\}$/.exec(body);

    if (groupMatch) {
      const prefix = groupMatch[1] ?? "";
      for (const item of (groupMatch[2] ?? "").split(",")) {
        const target = item.trim().split(/\s+as\s+/i)[0]?.trim();
        if (target) references.push({ line: index + 1, rawTarget: `${prefix}\\${target}` });
      }
      return;
    }

    for (const item of body.split(",")) {
      const target = item.trim().split(/\s+as\s+/i)[0]?.trim();
      if (target) references.push({ line: index + 1, rawTarget: target });
    }
  });

  return references;
};

const parseGoImports = (content: string): SourceReference[] => {
  const references: SourceReference[] = [];
  const lines = content.split(/\r?\n/);
  let inBlock = false;

  lines.forEach((line, index) => {
    const trimmed = line.replace(/\/\/.*$/, "").trim();
    if (!inBlock) {
      const single = /^import\s+(?:[._A-Za-z]\w*\s+)?"([^"]+)"/.exec(trimmed);
      if (single?.[1]) {
        references.push({ line: index + 1, rawTarget: single[1] });
        return;
      }
      if (/^import\s*\($/.test(trimmed)) inBlock = true;
      return;
    }

    if (trimmed === ")") {
      inBlock = false;
      return;
    }

    const block = /^(?:[._A-Za-z]\w*\s+)?"([^"]+)"/.exec(trimmed);
    if (block?.[1]) references.push({ line: index + 1, rawTarget: block[1] });
  });

  return references;
};

const candidateExisting = (candidates: string[], pathSet: Set<string>): string[] =>
  [...new Set(candidates.filter((candidate) => pathSet.has(candidate)))].sort();

const resolveJsRelative = async (
  projectRootPath: string,
  sourcePath: string,
  specifier: string,
  pathSet: Set<string>
): Promise<{ target?: string; reason?: UnresolvedReference["reason"] }> => {
  if (/[?#]/.test(specifier)) return { reason: "unsupported_reference_form" };
  const joined = path.posix.join(path.posix.dirname(sourcePath), specifier);
  const normalized = normalizeProjectPath(joined);
  if (normalized.outside) return { reason: "outside_project" };
  const target = normalized.path;

  if (path.posix.extname(target)) {
    return pathSet.has(target) ? { target } : { reason: "target_not_found" };
  }

  const direct = candidateExisting(JS_EXTENSIONS.map((extension) => `${target}${extension}`), pathSet);
  if (direct.length === 1) return { target: direct[0] };
  if (direct.length > 1) return { reason: "ambiguous_target" };

  const packagePath = `${target}/package.json`;
  if (pathSet.has(packagePath)) {
    try {
      const packageJson = await readJson<Record<string, unknown>>(path.join(projectRootPath, packagePath));
      const main = typeof packageJson.main === "string" ? packageJson.main.trim() : "";
      if (main) {
        const mainNormalized = normalizeProjectPath(path.posix.join(target, main));
        if (mainNormalized.outside) return { reason: "outside_project" };
        const mainTarget = mainNormalized.path;
        const mainCandidates = path.posix.extname(mainTarget)
          ? candidateExisting([mainTarget], pathSet)
          : candidateExisting(JS_EXTENSIONS.map((extension) => `${mainTarget}${extension}`), pathSet);
        if (mainCandidates.length === 1) return { target: mainCandidates[0] };
        if (mainCandidates.length > 1) return { reason: "ambiguous_target" };
      }
    } catch {
      // A malformed nested package.json is not a D08 registry manifest; resolution falls through to index.
    }
  }

  const indexes = candidateExisting(JS_EXTENSIONS.map((extension) => `${target}/index${extension}`), pathSet);
  if (indexes.length === 1) return { target: indexes[0] };
  if (indexes.length > 1) return { reason: "ambiguous_target" };
  return { reason: "target_not_found" };
};

const resolvePythonRelative = (
  sourcePath: string,
  rawTarget: string,
  pathSet: Set<string>
): { target?: string; reason?: UnresolvedReference["reason"] } => {
  const dotMatch = /^(\.+)(.*)$/.exec(rawTarget);
  if (!dotMatch) return {};
  const dots = dotMatch[1] ?? ".";
  const tail = dotMatch[2] ?? "";
  let base = path.posix.dirname(sourcePath);

  for (let count = 1; count < dots.length; count += 1) {
    base = path.posix.dirname(base);
    if (base === "." && count < dots.length - 1) return { reason: "outside_project" };
  }

  const tailPath = tail.replaceAll(".", "/");
  const normalized = normalizeProjectPath(tailPath ? path.posix.join(base, tailPath) : base);
  if (normalized.outside) return { reason: "outside_project" };
  const candidates = candidateExisting(
    [`${normalized.path}.py`, `${normalized.path}/__init__.py`],
    pathSet
  );
  if (candidates.length === 1) return { target: candidates[0] };
  if (candidates.length > 1) return { reason: "ambiguous_target" };
  return { reason: tail ? "target_not_found" : "unsupported_reference_form" };
};

const dedupeEdges = (edges: DependencyEdge[]): DependencyEdge[] => {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = JSON.stringify(edge);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const nullableCompare = (left: string | number | null, right: string | number | null): number => {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left < right ? -1 : 1;
};

const edgeSort = (left: DependencyEdge, right: DependencyEdge): number =>
  left.source_module.localeCompare(right.source_module) ||
  left.target_module.localeCompare(right.target_module) ||
  left.evidence.source.localeCompare(right.evidence.source) ||
  nullableCompare(left.evidence.line, right.evidence.line) ||
  nullableCompare(left.evidence.field, right.evidence.field) ||
  left.evidence.raw_target.localeCompare(right.evidence.raw_target);

const unresolvedSort = (left: UnresolvedReference, right: UnresolvedReference): number =>
  left.source.localeCompare(right.source) ||
  nullableCompare(left.line, right.line) ||
  nullableCompare(left.field, right.field) ||
  left.raw_target.localeCompare(right.raw_target) ||
  left.reason.localeCompare(right.reason);

const manifestFieldEntries = (record: Record<string, unknown>, fields: string[]): Array<[string, string, unknown]> => {
  const result: Array<[string, string, unknown]> = [];
  for (const field of fields) {
    const value = record[field];
    if (!isObject(value)) continue;
    for (const [name, raw] of Object.entries(value)) result.push([field, name, raw]);
  }
  return result;
};

export type MapModuleDependenciesResult = {
  edge_count: number;
  module_count: number;
  unresolved_reference_count: number;
  unsupported_source_count: number;
};

export const runMapModuleDependenciesJob = async (
  projectRootPath: string
): Promise<MapModuleDependenciesResult> => {
  const reportsDir = path.join(projectRootPath, ...REPORTS_SEGMENTS);
  const contextDir = path.join(projectRootPath, ...CONTEXT_SEGMENTS);
  const classified = await readJson<ClassifiedDocument>(path.join(reportsDir, "CLASSIFIED_FILES.json"));
  const base = await readJson<BaseModuleMap>(path.join(reportsDir, "MODULE_MAP_BASE.json"));

  if (!Array.isArray(classified.files) || !Array.isArray(base.modules)) {
    throw new Error("Invalid D08 inputs.");
  }

  const classifiedPaths = new Set(classified.files.map((file) => file.path));
  if (classifiedPaths.size !== classified.files.length) throw new Error("Duplicate CLASSIFIED_FILES path.");
  const pathToModule = new Map<string, string>();
  const moduleById = new Map<string, BaseModule>();

  for (const module of base.modules) {
    if (!module.id || moduleById.has(module.id) || !Array.isArray(module.paths)) {
      throw new Error("Invalid MODULE_MAP_BASE module identity.");
    }
    moduleById.set(module.id, module);
    for (const filePath of module.paths) {
      if (pathToModule.has(filePath)) throw new Error(`Path belongs to multiple modules: ${filePath}`);
      pathToModule.set(filePath, module.id);
    }
  }

  if (
    pathToModule.size !== classifiedPaths.size ||
    [...classifiedPaths].some((filePath) => !pathToModule.has(filePath))
  ) {
    throw new Error("MODULE_MAP_BASE path ownership does not match CLASSIFIED_FILES.");
  }

  const jsPackages = new Map<string, RegistryEntry[]>();
  const composerPackages = new Map<string, RegistryEntry[]>();
  const goModules = new Map<string, RegistryEntry[]>();
  const cargoProjects = new Map<string, RegistryEntry[]>();
  const msbuildProjects = new Map<string, RegistryEntry[]>();
  const psr4: Psr4Entry[] = [];
  const parsedManifestByPath = new Map<string, ParsedManifest>();
  const analyzedManifestFiles = new Set<string>();
  const unsupportedManifestFiles: Array<{ path: string; reason: "unsupported_manifest_reference" }> = [];
  const unparsedManifestFiles: Array<{ path: string; reason: "parse_error" }> = [];

  const markUnparsedManifest = (manifestPath: string): void => {
    if (!unparsedManifestFiles.some((entry) => entry.path === manifestPath)) {
      unparsedManifestFiles.push({ path: manifestPath, reason: "parse_error" });
    }
  };

  for (const module of base.modules) {
    const moduleManifestPaths = module.paths.filter((filePath) => {
      if (moduleRootForPath(filePath) !== module.root) return false;
      const baseName = path.posix.basename(filePath);
      return (
        SUPPORTED_MANIFEST_BASENAMES.has(baseName) ||
        UNSUPPORTED_MANIFEST_BASENAMES.has(baseName) ||
        MSBUILD_EXTENSIONS.has(path.posix.extname(baseName))
      );
    });

    for (const manifestPath of moduleManifestPaths) {
      const baseName = path.posix.basename(manifestPath);
      if (UNSUPPORTED_MANIFEST_BASENAMES.has(baseName)) {
        unsupportedManifestFiles.push({ path: manifestPath, reason: "unsupported_manifest_reference" });
        continue;
      }

      try {
        const content = await readFile(path.join(projectRootPath, manifestPath), "utf8");
        const parsed: ParsedManifest = { content, module, path: manifestPath };
        if (baseName === "package.json" || baseName === "composer.json") {
          parsed.json = JSON.parse(content) as Record<string, unknown>;
        } else if (baseName === "Cargo.toml") {
          parsed.toml = parseToml(content) as Record<string, unknown>;
        }
        parsedManifestByPath.set(manifestPath, parsed);
        analyzedManifestFiles.add(manifestPath);

        if (baseName === "package.json") {
          const name = parsed.json?.name;
          if (typeof name === "string") addRegistry(jsPackages, name, { moduleId: module.id, root: module.root });
        } else if (baseName === "composer.json") {
          const name = parsed.json?.name;
          if (typeof name === "string") addRegistry(composerPackages, name, { moduleId: module.id, root: module.root });
          const autoloadSources = [parsed.json?.autoload, parsed.json?.["autoload-dev"]];
          for (const source of autoloadSources) {
            if (!isObject(source) || !isObject(source["psr-4"])) continue;
            for (const [prefix, rawBases] of Object.entries(source["psr-4"] as Record<string, unknown>)) {
              const bases = typeof rawBases === "string" ? [rawBases] : Array.isArray(rawBases) ? rawBases : [];
              for (const rawBase of bases) {
                if (typeof rawBase !== "string") continue;
                const normalized = normalizeProjectPath(
                  module.root === "." ? rawBase : path.posix.join(module.root, rawBase)
                );
                if (!normalized.outside) {
                  psr4.push({ baseDir: normalized.path.replace(/\/$/, ""), moduleId: module.id, prefix, root: module.root });
                }
              }
            }
          }
        } else if (baseName === "go.mod") {
          const moduleMatch = /^\s*module\s+([^\s]+)\s*$/m.exec(content);
          if (moduleMatch?.[1]) addRegistry(goModules, moduleMatch[1], { moduleId: module.id, root: module.root });
        } else if (baseName === "Cargo.toml") {
          addRegistry(cargoProjects, manifestPath, { moduleId: module.id, root: module.root });
        } else if (MSBUILD_EXTENSIONS.has(path.posix.extname(baseName))) {
          addRegistry(msbuildProjects, manifestPath, { moduleId: module.id, root: module.root });
        }
      } catch {
        markUnparsedManifest(manifestPath);
      }
    }
  }

  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReference[] = [];
  const analyzedSourceFiles: string[] = [];
  const unsupportedSourceFiles: Array<{ path: string; format: FileFormat; reason: "unsupported_format" }> = [];
  const unparsedSourceFiles: Array<{ path: string; format: FileFormat; reason: "parse_error" }> = [];

  const addEdge = (sourcePath: string, targetModule: string, evidence: EdgeEvidence): void => {
    const sourceModule = pathToModule.get(sourcePath);
    if (!sourceModule || !moduleById.has(targetModule) || sourceModule === targetModule) return;
    edges.push({ source_module: sourceModule, target_module: targetModule, evidence });
  };

  const addResolvedFileEdge = (sourcePath: string, targetPath: string, evidence: EdgeEvidence): void => {
    const targetModule = pathToModule.get(targetPath);
    if (!targetModule) {
      unresolved.push({
        source: evidence.source,
        line: evidence.line,
        field: evidence.field,
        raw_target: evidence.raw_target,
        reason: "target_not_found"
      });
      return;
    }
    addEdge(sourcePath, targetModule, evidence);
  };

  for (const file of classified.files.filter((candidate) => candidate.kind === "source")) {
    if (!SUPPORTED_SOURCE_FORMATS.has(file.format)) {
      unsupportedSourceFiles.push({ path: file.path, format: file.format, reason: "unsupported_format" });
      continue;
    }

    let content: string;
    try {
      content = await readFile(path.join(projectRootPath, file.path), "utf8");
    } catch {
      unparsedSourceFiles.push({ path: file.path, format: file.format, reason: "parse_error" });
      continue;
    }

    let references: SourceReference[];
    if (["javascript", "jsx", "typescript", "tsx"].includes(String(file.format))) {
      const parsed = parseJsTsReferences(file.path, content, file.format);
      if (!parsed.ok) {
        unparsedSourceFiles.push({ path: file.path, format: file.format, reason: "parse_error" });
        continue;
      }
      references = parsed.references;
    } else if (file.format === "python") {
      references = parsePythonRelativeReferences(content);
    } else if (file.format === "php") {
      references = parsePhpUses(content);
    } else {
      references = parseGoImports(content);
    }
    analyzedSourceFiles.push(file.path);

    for (const reference of references) {
      if (reference.dynamic) {
        unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "dynamic_reference" });
        continue;
      }

      if (["javascript", "jsx", "typescript", "tsx"].includes(String(file.format))) {
        if (reference.rawTarget.startsWith("./") || reference.rawTarget.startsWith("../")) {
          const resolved = await resolveJsRelative(projectRootPath, file.path, reference.rawTarget, classifiedPaths);
          if (resolved.target) {
            addResolvedFileEdge(file.path, resolved.target, {
              kind: "source_reference",
              resolver: "typescript_relative",
              source: file.path,
              line: reference.line,
              field: null,
              raw_target: reference.rawTarget
            });
          } else if (resolved.reason) {
            unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: resolved.reason });
          }
          continue;
        }

        const key = packageKey(reference.rawTarget);
        const localMatches = jsPackages.get(key) ?? [];
        if (localMatches.length === 1) {
          addEdge(file.path, localMatches[0]!.moduleId, {
            kind: "source_reference",
            resolver: "typescript_local_package",
            source: file.path,
            line: reference.line,
            field: null,
            raw_target: reference.rawTarget
          });
        } else if (localMatches.length > 1) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "ambiguous_local_package" });
        } else if (/^(@\/|~\/|#)/.test(reference.rawTarget)) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "unsupported_alias" });
        }
        continue;
      }

      if (file.format === "python") {
        const resolved = resolvePythonRelative(file.path, reference.rawTarget, classifiedPaths);
        if (resolved.target) {
          addResolvedFileEdge(file.path, resolved.target, {
            kind: "source_reference",
            resolver: "python_relative",
            source: file.path,
            line: reference.line,
            field: null,
            raw_target: reference.rawTarget
          });
        } else if (resolved.reason) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: resolved.reason });
        }
        continue;
      }

      if (file.format === "php") {
        const normalizedNamespace = reference.rawTarget.replace(/^\\+/, "");
        const matchingPrefixes = psr4.filter((entry) => normalizedNamespace.startsWith(entry.prefix.replace(/^\\+/, "")));
        if (matchingPrefixes.length === 0) continue;
        const maxLength = Math.max(...matchingPrefixes.map((entry) => entry.prefix.length));
        const longest = matchingPrefixes.filter((entry) => entry.prefix.length === maxLength);
        const uniqueTargets = new Set(longest.map((entry) => `${entry.moduleId}|${entry.baseDir}`));
        if (uniqueTargets.size > 1) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "ambiguous_local_namespace" });
          continue;
        }
        const entry = longest[0]!;
        const suffix = normalizedNamespace.slice(entry.prefix.replace(/^\\+/, "").length).replace(/^\\+/, "").replaceAll("\\", "/");
        const candidates = candidateExisting([`${entry.baseDir}/${suffix}.php`.replace(/^\.\//, "")], classifiedPaths);
        if (candidates.length === 1) {
          addResolvedFileEdge(file.path, candidates[0]!, {
            kind: "source_reference",
            resolver: "php_psr4",
            source: file.path,
            line: reference.line,
            field: null,
            raw_target: reference.rawTarget
          });
        } else {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: candidates.length > 1 ? "ambiguous_target" : "target_not_found" });
        }
        continue;
      }

      if (file.format === "go") {
        const matches = [...goModules.entries()]
          .filter(([modulePath]) => reference.rawTarget === modulePath || reference.rawTarget.startsWith(`${modulePath}/`))
          .sort((left, right) => right[0].length - left[0].length);
        if (matches.length === 0) continue;
        const longestLength = matches[0]![0].length;
        const longest = matches.filter(([modulePath]) => modulePath.length === longestLength);
        const entries = longest.flatMap(([, values]) => values);
        const uniqueModuleIds = [...new Set(entries.map((entry) => entry.moduleId))];
        if (uniqueModuleIds.length !== 1) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "ambiguous_local_module" });
          continue;
        }
        const modulePath = longest[0]![0];
        const entry = entries[0]!;
        const suffix = reference.rawTarget.slice(modulePath.length).replace(/^\//, "");
        const targetDir = suffix ? (entry.root === "." ? suffix : `${entry.root}/${suffix}`) : entry.root;
        const hasGoSource = classified.files.some(
          (candidate) =>
            candidate.kind === "source" &&
            candidate.format === "go" &&
            path.posix.dirname(candidate.path) === targetDir
        );
        if (!hasGoSource) {
          unresolved.push({ source: file.path, line: reference.line, field: null, raw_target: reference.rawTarget, reason: "target_not_found" });
          continue;
        }
        addEdge(file.path, entry.moduleId, {
          kind: "source_reference",
          resolver: "go_local_module",
          source: file.path,
          line: reference.line,
          field: null,
          raw_target: reference.rawTarget
        });
      }
    }
  }

  for (const parsed of parsedManifestByPath.values()) {
    const baseName = path.posix.basename(parsed.path);
    const sourceModule = parsed.module.id;
    const manifestEvidence = (targetModule: string, resolver: string, field: string | null, rawTarget: string): void => {
      if (sourceModule === targetModule) return;
      addEdge(parsed.path, targetModule, {
        kind: "manifest_reference",
        resolver,
        source: parsed.path,
        line: null,
        field,
        raw_target: rawTarget
      });
    };

    if (baseName === "package.json" && parsed.json) {
      for (const [field, name, rawValue] of manifestFieldEntries(parsed.json, ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])) {
        const local = jsPackages.get(name) ?? [];
        if (local.length === 1) {
          manifestEvidence(local[0]!.moduleId, "package_json_local_dependency", `${field}.${name}`, name);
        } else if (local.length > 1) {
          unresolved.push({ source: parsed.path, line: null, field: `${field}.${name}`, raw_target: name, reason: "ambiguous_local_package" });
        }

        if (typeof rawValue === "string" && /^(file|link):/.test(rawValue)) {
          const rawPath = rawValue.replace(/^(file|link):/, "");
          const normalized = normalizeProjectPath(parsed.module.root === "." ? rawPath : path.posix.join(parsed.module.root, rawPath));
          if (normalized.outside) {
            unresolved.push({ source: parsed.path, line: null, field: `${field}.${name}`, raw_target: rawValue, reason: "outside_project" });
          } else {
            const matches = base.modules.filter((module) => module.root === normalized.path);
            if (matches.length === 1) manifestEvidence(matches[0]!.id, "package_json_local_path", `${field}.${name}`, rawValue);
            else if (matches.length > 1) unresolved.push({ source: parsed.path, line: null, field: `${field}.${name}`, raw_target: rawValue, reason: "ambiguous_target" });
            else unresolved.push({ source: parsed.path, line: null, field: `${field}.${name}`, raw_target: rawValue, reason: "target_not_found" });
          }
        }
      }
    } else if (baseName === "composer.json" && parsed.json) {
      for (const [field, name] of manifestFieldEntries(parsed.json, ["require", "require-dev"])) {
        if (name === "php" || name.startsWith("ext-")) continue;
        const local = composerPackages.get(name) ?? [];
        if (local.length === 1) manifestEvidence(local[0]!.moduleId, "composer_local_dependency", `${field}.${name}`, name);
        else if (local.length > 1) unresolved.push({ source: parsed.path, line: null, field: `${field}.${name}`, raw_target: name, reason: "ambiguous_local_package" });
      }
    } else if (baseName === "go.mod") {
      const lines = parsed.content.split(/\r?\n/);
      let inRequire = false;
      for (let index = 0; index < lines.length; index += 1) {
        const trimmed = (lines[index] ?? "").replace(/\/\/.*$/, "").trim();
        if (/^replace\s+/.test(trimmed)) {
          unresolved.push({ source: parsed.path, line: index + 1, field: null, raw_target: trimmed, reason: "unsupported_reference_form" });
        }
        if (/^require\s*\($/.test(trimmed)) {
          inRequire = true;
          continue;
        }
        if (inRequire && trimmed === ")") {
          inRequire = false;
          continue;
        }
        const match = inRequire ? /^([^\s]+)\s+/.exec(trimmed) : /^require\s+([^\s]+)\s+/.exec(trimmed);
        const required = match?.[1];
        if (!required) continue;
        const local = goModules.get(required) ?? [];
        if (local.length === 1) manifestEvidence(local[0]!.moduleId, "go_mod_local_requirement", null, required);
        else if (local.length > 1) unresolved.push({ source: parsed.path, line: index + 1, field: null, raw_target: required, reason: "ambiguous_local_module" });
      }
    } else if (baseName === "Cargo.toml" && parsed.toml) {
      for (const tableName of ["dependencies", "dev-dependencies", "build-dependencies"]) {
        const table = parsed.toml[tableName];
        if (!isObject(table)) continue;
        for (const [name, raw] of Object.entries(table)) {
          if (!isObject(raw) || typeof raw.path !== "string") continue;
          const normalized = normalizeProjectPath(parsed.module.root === "." ? raw.path : path.posix.join(parsed.module.root, raw.path));
          if (normalized.outside) {
            unresolved.push({ source: parsed.path, line: null, field: `${tableName}.${name}.path`, raw_target: raw.path, reason: "outside_project" });
            continue;
          }
          const cargoPath = `${normalized.path === "." ? "" : `${normalized.path}/`}Cargo.toml`;
          const local = cargoProjects.get(cargoPath) ?? [];
          if (local.length === 1) manifestEvidence(local[0]!.moduleId, "cargo_path_dependency", `${tableName}.${name}.path`, raw.path);
          else if (local.length > 1) unresolved.push({ source: parsed.path, line: null, field: `${tableName}.${name}.path`, raw_target: raw.path, reason: "ambiguous_target" });
          else unresolved.push({ source: parsed.path, line: null, field: `${tableName}.${name}.path`, raw_target: raw.path, reason: "target_not_found" });
        }
      }
    } else if (MSBUILD_EXTENSIONS.has(path.posix.extname(baseName))) {
      const pattern = /<ProjectReference\b[^>]*\bInclude\s*=\s*["']([^"']+)["'][^>]*\/?\s*>/gi;
      for (const match of parsed.content.matchAll(pattern)) {
        const rawTarget = match[1];
        if (!rawTarget) continue;
        const normalized = normalizeProjectPath(path.posix.join(path.posix.dirname(parsed.path), rawTarget.replaceAll("\\", "/")));
        if (normalized.outside) {
          unresolved.push({ source: parsed.path, line: null, field: "ProjectReference.Include", raw_target: rawTarget, reason: "outside_project" });
          continue;
        }
        const local = msbuildProjects.get(normalized.path) ?? [];
        if (local.length === 1) manifestEvidence(local[0]!.moduleId, "msbuild_project_reference", "ProjectReference.Include", rawTarget);
        else if (local.length > 1) unresolved.push({ source: parsed.path, line: null, field: "ProjectReference.Include", raw_target: rawTarget, reason: "ambiguous_target" });
        else unresolved.push({ source: parsed.path, line: null, field: "ProjectReference.Include", raw_target: rawTarget, reason: "target_not_found" });
      }
    }
  }

  const sortedEdges = dedupeEdges(edges).sort(edgeSort);
  const dependsOnByModule = new Map<string, Set<string>>();
  for (const edge of sortedEdges) {
    const set = dependsOnByModule.get(edge.source_module) ?? new Set<string>();
    set.add(edge.target_module);
    dependsOnByModule.set(edge.source_module, set);
  }

  const finalModules = base.modules.map((module) => ({
    ...module,
    depends_on: [...(dependsOnByModule.get(module.id) ?? new Set<string>())].sort()
  }));

  const output = {
    metadata: base.metadata ?? metadata(),
    modules: finalModules,
    dependency_edges: sortedEdges,
    analysis_coverage: {
      analyzed_source_files: analyzedSourceFiles.sort(),
      unsupported_source_files: unsupportedSourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
      unparsed_source_files: unparsedSourceFiles.sort((a, b) => a.path.localeCompare(b.path)),
      analyzed_manifest_files: [...analyzedManifestFiles].sort(),
      unsupported_manifest_files: unsupportedManifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
      unparsed_manifest_files: unparsedManifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
      unresolved_references: unresolved.sort(unresolvedSort)
    }
  };

  // Final local invariants. No LLM verification is used.
  if (finalModules.length !== base.modules.length) throw new Error("D08 module count changed.");
  for (let index = 0; index < base.modules.length; index += 1) {
    const source = base.modules[index]!;
    const final = finalModules[index]!;
    for (const key of ["id", "name", "root", "paths", "summary", "description", "description_evidence"] as const) {
      if (JSON.stringify(source[key]) !== JSON.stringify(final[key])) {
        throw new Error(`D08 modified base module field: ${source.id}.${key}`);
      }
    }
    if (final.depends_on.includes(final.id)) throw new Error(`D08 self dependency: ${final.id}`);
    for (const target of final.depends_on) {
      if (!moduleById.has(target)) throw new Error(`D08 unknown depends_on module: ${target}`);
      if (!sortedEdges.some((edge) => edge.source_module === final.id && edge.target_module === target)) {
        throw new Error(`D08 depends_on lacks evidence: ${final.id} -> ${target}`);
      }
    }
  }

  await writeJson(path.join(contextDir, "MODULE_MAP.json"), output);
  return {
    edge_count: sortedEdges.length,
    module_count: finalModules.length,
    unresolved_reference_count: unresolved.length,
    unsupported_source_count: unsupportedSourceFiles.length
  };
};
