import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { parse as parseToml } from "smol-toml";

import { isDirectory, isFile, runGit, toPosixRelative } from "../shared/fsUtils";

export type ScanProjectResult = {
  directory_count: number;
  file_count: number;
};

export type ClassifyFilesResult = {
  file_count: number;
  unknown_count: number;
};

type VcsStatus = "ignored" | "tracked" | "unknown" | "untracked";

type InventoryFile = {
  path: string;
  size: number;
  vcs_status: VcsStatus;
};

type InventoryDirectory = {
  included: true;
  path: string;
};

export type FileKind =
  | "asset"
  | "configuration"
  | "data"
  | "database"
  | "documentation"
  | "manifest"
  | "script"
  | "source"
  | "unknown";

export type FileFormat =
  | "asciidoc"
  | "batch"
  | "csharp"
  | "css"
  | "csv"
  | "docx"
  | "dockerfile"
  | "eot"
  | "env"
  | "gif"
  | "go"
  | "groovy"
  | "gzip"
  | "hcl"
  | "html"
  | "ico"
  | "ini"
  | "java"
  | "javascript"
  | "jpeg"
  | "json"
  | "jsx"
  | "kotlin"
  | "less"
  | "make"
  | "markdown"
  | "pdf"
  | "php"
  | "plain_text"
  | "png"
  | "powershell"
  | "prisma"
  | "python"
  | "rst"
  | "ruby"
  | "rust"
  | "sass"
  | "scss"
  | "shell"
  | "sql"
  | "svelte"
  | "svg"
  | "tar"
  | "toml"
  | "ttf"
  | "tsx"
  | "typescript"
  | "vue"
  | "webp"
  | "woff"
  | "woff2"
  | "xml"
  | "yaml"
  | "zip"
  | null;

export type FileSignal = "infrastructure" | "migration" | "seed" | "test";
export type FileOrigin = "generated" | "project" | "third_party" | "tool_state";

type ClassifiedFile = {
  format: FileFormat;
  kind: FileKind;
  origin: FileOrigin;
  path: string;
  signals: FileSignal[];
};

const DISCOVERY_REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const ROOT_EXCLUDED_DIRECTORIES = new Set([
  ".ai-factory",
  ".ai-factory-runs",
  ".claude",
  ".git",
  ".forgepilot",
  "node_modules",
  "vendor"
]);
const EXCLUDED_FILE_NAME = "RUN_ENV.json";
const RUNS_DIR = ".ai-factory-runs";

type ScopePolicy = {
  exclude: string[];
  include: string[];
  source: string | null;
};

const normalizeScopePath = (value: string): string =>
  value
    .trim()
    .replace(/^`|`$/g, "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "");

const parseScopeList = (body: string, heading: "Include" | "Exclude"): string[] => {
  const lines = body.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);

  if (headingIndex === -1) {
    return [];
  }

  const values: string[] = [];

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (line.startsWith("## ")) {
      break;
    }

    const match = /^[-*+]\s+(.+)$/.exec(line);

    if (!match) {
      continue;
    }

    const value = normalizeScopePath(match[1]);

    if (value && value !== "-") {
      values.push(value);
    }
  }

  return [...new Set(values)].sort();
};

const readScopePolicy = async (projectRootPath: string): Promise<ScopePolicy> => {
  const candidatePaths: string[] = [];
  const runsPath = path.join(projectRootPath, RUNS_DIR);

  try {
    const runEntries = await readdir(runsPath, { withFileTypes: true });
    const runIds = runEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();

    for (const runId of runIds) {
      candidatePaths.push(path.join(runsPath, runId, "SCOPE.md"));
    }
  } catch {
    // A project can be inspected before Startup has produced a run directory.
  }

  candidatePaths.push(path.join(projectRootPath, "SCOPE.md"));

  for (const candidatePath of candidatePaths) {
    if (!(await isFile(candidatePath))) {
      continue;
    }

    const body = await readFile(candidatePath, "utf8");

    return {
      exclude: parseScopeList(body, "Exclude"),
      include: parseScopeList(body, "Include"),
      source: toPosixRelative(projectRootPath, candidatePath)
    };
  }

  return { exclude: [], include: [], source: null };
};

const pathMatchesOrIsBelow = (relativePath: string, scopePath: string): boolean =>
  relativePath === scopePath || relativePath.startsWith(`${scopePath}/`);

const isExcludedByScope = (relativePath: string, policy: ScopePolicy): boolean =>
  policy.exclude.some((scopePath) => pathMatchesOrIsBelow(relativePath, scopePath));

const isIncludedFileByScope = (relativePath: string, policy: ScopePolicy): boolean =>
  policy.include.length === 0 ||
  policy.include.some((scopePath) => pathMatchesOrIsBelow(relativePath, scopePath));

const shouldTraverseDirectoryByScope = (relativePath: string, policy: ScopePolicy): boolean =>
  policy.include.length === 0 ||
  policy.include.some(
    (scopePath) =>
      pathMatchesOrIsBelow(relativePath, scopePath) ||
      pathMatchesOrIsBelow(scopePath, relativePath)
  );

const byPath = <T extends { path: string }>(left: T, right: T): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

const buildMetadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: "2.0.0"
});

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const discoveryReportsDir = (projectRootPath: string): string =>
  path.join(projectRootPath, ...DISCOVERY_REPORTS_SEGMENTS);

// ---------------------------------------------------------------------------
// RULE-D01 — scan_project
// ---------------------------------------------------------------------------

const runGitLines = async (projectRootPath: string, args: string[]): Promise<string[] | null> => {
  try {
    const buffer = await runGit(projectRootPath, args);

    return buffer
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
};

const scanTree = async (
  rootPath: string,
  currentPath: string,
  isRootLevel: boolean,
  files: InventoryFile[],
  directories: InventoryDirectory[],
  vcsStatusFor: (relativePath: string) => VcsStatus,
  scopePolicy: ScopePolicy
): Promise<void> => {
  const entries = await readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === EXCLUDED_FILE_NAME) {
      continue;
    }

    if (isRootLevel && entry.isDirectory() && ROOT_EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(currentPath, entry.name);
    const relativePath = toPosixRelative(rootPath, entryPath);

    if (isExcludedByScope(relativePath, scopePolicy)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (!shouldTraverseDirectoryByScope(relativePath, scopePolicy)) {
        continue;
      }

      directories.push({ included: true, path: relativePath });
      await scanTree(
        rootPath,
        entryPath,
        false,
        files,
        directories,
        vcsStatusFor,
        scopePolicy
      );
      continue;
    }

    if (!entry.isFile() || !isIncludedFileByScope(relativePath, scopePolicy)) {
      continue;
    }

    let size: number;

    try {
      size = (await stat(entryPath)).size;
    } catch (error) {
      throw new Error(
        `Unable to read file size for ${relativePath}: ${(error as Error).message}`
      );
    }

    files.push({
      path: relativePath,
      size,
      vcs_status: vcsStatusFor(relativePath)
    });
  }
};

export const runScanProjectJob = async (projectRootPath: string): Promise<ScanProjectResult> => {
  if (!(await isDirectory(projectRootPath))) {
    throw new Error(`Project root not found: ${projectRootPath}`);
  }

  const trackedLines = await runGitLines(projectRootPath, ["ls-files"]);
  const ignoredLines = await runGitLines(projectRootPath, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard"
  ]);
  const gitAvailable = trackedLines !== null && ignoredLines !== null;
  const trackedSet = new Set(trackedLines ?? []);
  const ignoredSet = new Set(ignoredLines ?? []);
  const vcsStatusFor = (relativePath: string): VcsStatus => {
    if (trackedSet.has(relativePath)) {
      return "tracked";
    }

    if (ignoredSet.has(relativePath)) {
      return "ignored";
    }

    return gitAvailable ? "untracked" : "unknown";
  };

  const files: InventoryFile[] = [];
  const directories: InventoryDirectory[] = [];
  const scopePolicy = await readScopePolicy(projectRootPath);
  await scanTree(
    projectRootPath,
    projectRootPath,
    true,
    files,
    directories,
    vcsStatusFor,
    scopePolicy
  );

  files.sort(byPath);
  directories.sort(byPath);

  const reportsDir = discoveryReportsDir(projectRootPath);
  await mkdir(reportsDir, { recursive: true });

  await writeJson(path.join(reportsDir, "FILE_INVENTORY.json"), {
    files,
    metadata: buildMetadata(),
    root: ".",
    totals: {
      directories: directories.length,
      files: files.length
    }
  });

  await writeJson(path.join(reportsDir, "FOLDER_STRUCTURE.json"), {
    directories,
    exclusion_policy: {
      file_names: [EXCLUDED_FILE_NAME],
      follow_symlinks: false,
      root_directories: [...ROOT_EXCLUDED_DIRECTORIES].sort(),
      scope_exclude: scopePolicy.exclude,
      scope_include: scopePolicy.include,
      scope_source: scopePolicy.source
    },
    files: files.map((file) => file.path),
    metadata: buildMetadata()
  });

  return {
    directory_count: directories.length,
    file_count: files.length
  };
};

// ---------------------------------------------------------------------------
// RULE-D02 — classify_files
// ---------------------------------------------------------------------------

const MANIFEST_EXACT_NAMES: Record<string, FileFormat> = {
  "Cargo.lock": "toml",
  "Cargo.toml": "toml",
  Gemfile: "ruby",
  "Gemfile.lock": "plain_text",
  Pipfile: "toml",
  "Pipfile.lock": "json",
  "build.gradle": "groovy",
  "build.gradle.kts": "kotlin",
  "composer.json": "json",
  "composer.lock": "json",
  "go.mod": "plain_text",
  "go.sum": "plain_text",
  "go.work": "plain_text",
  "go.work.sum": "plain_text",
  "gradle.lockfile": "plain_text",
  "npm-shrinkwrap.json": "json",
  "package-lock.json": "json",
  "package.json": "json",
  "packages.lock.json": "json",
  "pnpm-lock.yaml": "yaml",
  "poetry.lock": "toml",
  "pom.xml": "xml",
  "pyproject.toml": "toml",
  "requirements.txt": "plain_text",
  "settings.gradle": "groovy",
  "settings.gradle.kts": "kotlin",
  "uv.lock": "toml",
  "yarn.lock": "plain_text"
};

const MANIFEST_EXTENSIONS: Record<string, FileFormat> = {
  ".csproj": "xml",
  ".fsproj": "xml",
  ".vbproj": "xml"
};

const STANDARD_DOCUMENT_NAMES = new Set(["README", "CHANGELOG", "CONTRIBUTING", "LICENSE"]);

const EXACT_NAME_NULL_FORMAT_CONFIG = new Set([
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".npmignore",
  ".editorconfig",
  ".htaccess",
  ".ftpquota"
]);

const DOCUMENTATION_EXTENSIONS: Record<string, FileFormat> = {
  ".adoc": "asciidoc",
  ".docx": "docx",
  ".md": "markdown",
  ".pdf": "pdf",
  ".rst": "rst",
  ".txt": "plain_text"
};

const SOURCE_EXTENSIONS: Record<string, FileFormat> = {
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".htm": "html",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "jsx",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".less": "less",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sass": "sass",
  ".scss": "scss",
  ".svelte": "svelte",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue"
};

const CONFIGURATION_EXTENSIONS: Record<string, FileFormat> = {
  ".ini": "ini",
  ".json": "json",
  ".tf": "hcl",
  ".tfvars": "hcl",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml"
};

const DATABASE_EXTENSIONS: Record<string, FileFormat> = {
  ".prisma": "prisma",
  ".sql": "sql"
};

const SCRIPT_EXTENSIONS: Record<string, FileFormat> = {
  ".bash": "shell",
  ".bat": "batch",
  ".cmd": "batch",
  ".mk": "make",
  ".ps1": "powershell",
  ".sh": "shell"
};

const ASSET_EXTENSIONS: Record<string, FileFormat> = {
  ".eot": "eot",
  ".gif": "gif",
  ".gz": "gzip",
  ".ico": "ico",
  ".jpeg": "jpeg",
  ".jpg": "jpeg",
  ".png": "png",
  ".svg": "svg",
  ".tar": "tar",
  ".ttf": "ttf",
  ".webp": "webp",
  ".woff": "woff",
  ".woff2": "woff2",
  ".zip": "zip"
};

const DATA_EXTENSIONS: Record<string, FileFormat> = {
  ".csv": "csv",
  ".xml": "xml"
};

const EXTENSION_GROUPS: Array<{ kind: FileKind; table: Record<string, FileFormat> }> = [
  { kind: "documentation", table: DOCUMENTATION_EXTENSIONS },
  { kind: "source", table: SOURCE_EXTENSIONS },
  { kind: "configuration", table: CONFIGURATION_EXTENSIONS },
  { kind: "database", table: DATABASE_EXTENSIONS },
  { kind: "script", table: SCRIPT_EXTENSIONS },
  { kind: "asset", table: ASSET_EXTENSIONS },
  { kind: "data", table: DATA_EXTENSIONS }
];

const classifyFile = (relativePath: string): { format: FileFormat; kind: FileKind } => {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(basename).toLowerCase();

  if (Object.hasOwn(MANIFEST_EXACT_NAMES, basename)) {
    return { format: MANIFEST_EXACT_NAMES[basename] ?? null, kind: "manifest" };
  }

  if (Object.hasOwn(MANIFEST_EXTENSIONS, extension)) {
    return { format: MANIFEST_EXTENSIONS[extension] ?? null, kind: "manifest" };
  }

  if (!basename.includes(".") && STANDARD_DOCUMENT_NAMES.has(basename)) {
    return { format: "plain_text", kind: "documentation" };
  }

  if (EXACT_NAME_NULL_FORMAT_CONFIG.has(basename)) {
    return { format: null, kind: "configuration" };
  }

  if (basename === "Dockerfile") {
    return { format: "dockerfile", kind: "configuration" };
  }

  if (basename === "Makefile") {
    return { format: "make", kind: "script" };
  }

  if (basename === "artisan") {
    return { format: "php", kind: "script" };
  }

  if (basename === ".env" || basename.startsWith(".env")) {
    return { format: "env", kind: "configuration" };
  }

  for (const group of EXTENSION_GROUPS) {
    if (Object.hasOwn(group.table, extension)) {
      return { format: group.table[extension] ?? null, kind: group.kind };
    }
  }

  return { format: null, kind: "unknown" };
};

const TOKEN_BOUNDARY_PATTERN = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;

const tokenize = (input: string): string[] => {
  const segments = input.split(/[._-]/).filter(Boolean);
  const tokens: string[] = [];

  for (const segment of segments) {
    const matches = segment.match(TOKEN_BOUNDARY_PATTERN);

    if (matches && matches.length > 0) {
      tokens.push(...matches.map((match) => match.toLowerCase()));
    } else {
      tokens.push(segment.toLowerCase());
    }
  }

  return tokens;
};

const TEST_TOKENS = new Set(["test", "tests", "spec", "specs"]);
const MIGRATION_TOKENS = new Set(["migration", "migrations"]);
const SEED_TOKENS = new Set(["seed", "seeds", "seeder", "seeders"]);
const INFRASTRUCTURE_TOKENS = new Set(["terraform", "k8s", "kubernetes"]);
const INFRASTRUCTURE_EXACT_FILENAMES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  ".gitlab-ci.yml"
]);
const INFRASTRUCTURE_EXTENSIONS = new Set([".tf", ".tfvars"]);

const hasGithubWorkflowsSegment = (segments: string[]): boolean =>
  segments.some((segment, index) => segment === ".github" && segments[index + 1] === "workflows");

const THIRD_PARTY_DIRECTORY_NAMES = new Set([
  "node_modules",
  "vendor",
  "bower_components",
  "third_party",
  "third-party"
]);

const hasPathPair = (segments: string[], parent: string, child: string): boolean =>
  segments.some((segment, index) => segment === parent && segments[index + 1] === child);

const classifyFileOrigin = (relativePath: string): FileOrigin => {
  const segments = relativePath.split("/").map((segment) => segment.toLowerCase());
  const basename = segments.at(-1) ?? "";

  if (segments.includes(".forgepilot")) {
    return "tool_state";
  }

  if (segments.some((segment) => THIRD_PARTY_DIRECTORY_NAMES.has(segment))) {
    return "third_party";
  }

  const vendorAsset = segments.some(
    (segment, index) =>
      segment === "vendors" &&
      ["assets", "css", "js", "scripts", "script", "plugins"].includes(segments[index - 1] ?? "")
  );
  if (vendorAsset) {
    return "third_party";
  }

  const generatedDirectory =
    segments.includes("dist") ||
    segments.includes("coverage") ||
    segments.includes(".next") ||
    hasPathPair(segments, "bootstrap", "cache") ||
    hasPathPair(segments, "storage", "framework") ||
    hasPathPair(segments, "public", "build") ||
    (segments.includes("public") &&
      segments.includes("assets") &&
      segments.indexOf("public") < segments.indexOf("assets"));
  const generatedFile = basename.endsWith(".map") || basename.endsWith(".min.js") || basename.endsWith(".min.css");

  return generatedDirectory || generatedFile ? "generated" : "project";
};

const computeSignals = (relativePath: string): FileSignal[] => {
  const segments = relativePath.split("/");
  const basename = segments.at(-1) ?? relativePath;
  const directorySegments = segments.slice(0, -1);
  const candidates = [basename, ...directorySegments];
  const tokens = new Set<string>();

  for (const candidate of candidates) {
    for (const token of tokenize(candidate)) {
      tokens.add(token);
    }
  }

  const signals: FileSignal[] = [];

  if ([...tokens].some((token) => TEST_TOKENS.has(token))) {
    signals.push("test");
  }

  if ([...tokens].some((token) => MIGRATION_TOKENS.has(token))) {
    signals.push("migration");
  }

  if ([...tokens].some((token) => SEED_TOKENS.has(token))) {
    signals.push("seed");
  }

  const extension = path.posix.extname(basename).toLowerCase();
  const isInfrastructure =
    INFRASTRUCTURE_EXACT_FILENAMES.has(basename) ||
    hasGithubWorkflowsSegment(segments) ||
    [...tokens].some((token) => INFRASTRUCTURE_TOKENS.has(token)) ||
    INFRASTRUCTURE_EXTENSIONS.has(extension);

  if (isInfrastructure) {
    signals.push("infrastructure");
  }

  return signals;
};

type FileInventory = {
  files: Array<{ path: string }>;
};

export const runClassifyFilesJob = async (
  projectRootPath: string
): Promise<ClassifyFilesResult> => {
  const reportsDir = discoveryReportsDir(projectRootPath);
  const inventoryPath = path.join(reportsDir, "FILE_INVENTORY.json");
  let inventory: FileInventory;

  try {
    inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as FileInventory;
  } catch (error) {
    throw new Error(`Unable to read FILE_INVENTORY.json: ${(error as Error).message}`);
  }

  const classifiedFiles: ClassifiedFile[] = inventory.files.map((file) => {
    const { format, kind } = classifyFile(file.path);

    return {
      format,
      kind,
      origin: classifyFileOrigin(file.path),
      path: file.path,
      signals: computeSignals(file.path)
    };
  });
  const unknownFiles = classifiedFiles.filter((file) => file.origin === "project" && file.kind === "unknown");

  await mkdir(reportsDir, { recursive: true });

  await writeJson(path.join(reportsDir, "CLASSIFIED_FILES.json"), {
    files: classifiedFiles.map((file) => ({
      format: file.format,
      kind: file.kind,
      origin: file.origin,
      path: file.path,
      signals: file.signals
    })),
    metadata: buildMetadata(),
    non_project: {
      generated: classifiedFiles.filter((file) => file.origin === "generated").length,
      third_party: classifiedFiles.filter((file) => file.origin === "third_party").length,
      tool_state: classifiedFiles.filter((file) => file.origin === "tool_state").length
    },
    unknown: unknownFiles.map((file) => file.path)
  });

  await writeJson(path.join(reportsDir, "UNKNOWN_FILES.json"), {
    files: unknownFiles.map((file) => ({
      format: null,
      path: file.path,
      origin: file.origin,
      reason: "no deterministic kind rule matched for a project-owned file",
      signals: file.signals
    })),
    metadata: buildMetadata()
  });

  return {
    file_count: classifiedFiles.length,
    unknown_count: unknownFiles.length
  };
};

// ---------------------------------------------------------------------------
// RULE-D09 — map_dependencies
// ---------------------------------------------------------------------------

export type MapDependenciesResult = {
  package_count: number;
  technology_count: number;
};

type ManifestEvidence = {
  field?: string;
  note: string;
  source: string;
};

type DependencyPackage = {
  evidence: ManifestEvidence;
  name: string;
  scopes: string[];
};

type TechnologyStackCategory = "Build Backend" | "Framework" | "Language" | "Package Manager" | "Runtime";

type TechnologyStackEntry = {
  category: TechnologyStackCategory;
  evidence: ManifestEvidence;
  name: string;
};

type ClassifiedFilesDocument = {
  files: ClassifiedFile[];
};

const LANGUAGE_BY_FORMAT: Partial<Record<NonNullable<FileFormat>, string>> = {
  csharp: "C#",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  jsx: "JavaScript",
  kotlin: "Kotlin",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  tsx: "TypeScript",
  typescript: "TypeScript"
};

const TECH_STACK_CATEGORY_ORDER: TechnologyStackCategory[] = [
  "Language",
  "Runtime",
  "Framework",
  "Package Manager",
  "Build Backend"
];

const PYPROJECT_BUILD_BACKENDS: Array<{ match: (value: string) => boolean; name: string }> = [
  { match: (value) => value === "poetry.core.masonry.api", name: "Poetry" },
  { match: (value) => value.startsWith("setuptools."), name: "setuptools" },
  { match: (value) => value === "hatchling.build", name: "Hatch" },
  { match: (value) => value === "flit_core.buildapi", name: "Flit" },
  { match: (value) => value === "pdm.backend", name: "PDM" }
];

const PEP508_NAME_BOUNDARY_PATTERN = /[[;=<>!~\s]/;

const extractPep508Name = (requirement: string): string | null => {
  const boundaryIndex = requirement.search(PEP508_NAME_BOUNDARY_PATTERN);
  const name = (boundaryIndex === -1 ? requirement : requirement.slice(0, boundaryIndex)).trim();

  return name.length > 0 ? name : null;
};

const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Unable to parse ${filePath}: ${(error as Error).message}`);
  }
};

const extractScopedPackages = (
  source: string,
  runtimeDeps: Record<string, unknown>,
  devDeps: Record<string, unknown>,
  note: string,
  exclude?: (name: string) => boolean
): DependencyPackage[] => {
  const runtimeNames = new Set(Object.keys(runtimeDeps).filter((name) => !exclude?.(name)));
  const devNames = new Set(Object.keys(devDeps).filter((name) => !exclude?.(name)));
  const allNames = new Set([...runtimeNames, ...devNames]);

  return [...allNames].sort().map((name) => {
    const scopes: string[] = [];

    if (devNames.has(name)) {
      scopes.push("development");
    }

    if (runtimeNames.has(name)) {
      scopes.push("runtime");
    }

    return { evidence: { note, source }, name, scopes: scopes.sort() };
  });
};

const buildPackageJsonRecords = (
  manifestPath: string,
  siblingNames: Set<string>,
  packageJson: Record<string, unknown>
): { packages: DependencyPackage[]; stack: TechnologyStackEntry[] } => {
  const stack: TechnologyStackEntry[] = [];
  const manifestDir = path.posix.dirname(manifestPath);
  const siblingPath = (name: string): string => manifestDir === "." ? name : `${manifestDir}/${name}`;
  const packageManagerField =
    typeof packageJson.packageManager === "string" ? packageJson.packageManager : null;

  if (packageManagerField) {
    stack.push({
      category: "Package Manager",
      evidence: { field: "packageManager", note: "packageManager alani.", source: manifestPath },
      name: packageManagerField.split("@")[0] ?? packageManagerField
    });
  } else if (siblingNames.has("pnpm-lock.yaml")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: siblingPath("pnpm-lock.yaml") },
      name: "pnpm"
    });
  } else if (siblingNames.has("yarn.lock")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: siblingPath("yarn.lock") },
      name: "Yarn"
    });
  } else if (siblingNames.has("package-lock.json") || siblingNames.has("npm-shrinkwrap.json")) {
    stack.push({
      category: "Package Manager",
      evidence: {
        note: "lockfile bulundu.",
        source: siblingPath(siblingNames.has("package-lock.json") ? "package-lock.json" : "npm-shrinkwrap.json")
      },
      name: "npm"
    });
  }

  const engines = packageJson.engines;
  const nodeEngine =
    engines && typeof engines === "object" && !Array.isArray(engines)
      ? (engines as Record<string, unknown>).node
      : undefined;

  if (typeof nodeEngine === "string") {
    stack.push({
      category: "Runtime",
      evidence: { field: "engines.node", note: "engines.node alani.", source: manifestPath },
      name: "Node.js"
    });
  }

  const packages = extractScopedPackages(
    manifestPath,
    (packageJson.dependencies as Record<string, unknown>) ?? {},
    (packageJson.devDependencies as Record<string, unknown>) ?? {},
    "package dependency kaydi."
  );

  return { packages, stack };
};

const buildComposerJsonRecords = (
  manifestPath: string,
  siblingNames: Set<string>,
  composerJson: Record<string, unknown>
): { packages: DependencyPackage[]; stack: TechnologyStackEntry[] } => {
  const stack: TechnologyStackEntry[] = [];
  const manifestDir = path.posix.dirname(manifestPath);
  const siblingPath = (name: string): string => manifestDir === "." ? name : `${manifestDir}/${name}`;

  if (siblingNames.has("composer.lock")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: siblingPath("composer.lock") },
      name: "Composer"
    });
  }

  const packages = extractScopedPackages(
    manifestPath,
    (composerJson.require as Record<string, unknown>) ?? {},
    (composerJson["require-dev"] as Record<string, unknown>) ?? {},
    "composer dependency kaydi.",
    (name) => name === "php" || name.startsWith("ext-")
  );

  return { packages, stack };
};

const buildPyprojectTomlRecords = (
  manifestPath: string,
  pyproject: Record<string, unknown>
): { packages: DependencyPackage[]; stack: TechnologyStackEntry[] } => {
  const stack: TechnologyStackEntry[] = [];
  const packages: DependencyPackage[] = [];

  const buildSystem = pyproject["build-system"];
  const buildBackend =
    buildSystem && typeof buildSystem === "object" && !Array.isArray(buildSystem)
      ? (buildSystem as Record<string, unknown>)["build-backend"]
      : undefined;

  if (typeof buildBackend === "string") {
    const matched = PYPROJECT_BUILD_BACKENDS.find((entry) => entry.match(buildBackend));

    if (matched) {
      stack.push({
        category: "Build Backend",
        evidence: {
          field: "build-system.build-backend",
          note: "pyproject build-backend kaydi.",
          source: manifestPath
        },
        name: matched.name
      });
    }
  }

  const project = pyproject.project;
  const projectDependencies =
    project && typeof project === "object" && !Array.isArray(project)
      ? (project as Record<string, unknown>).dependencies
      : undefined;

  if (Array.isArray(projectDependencies)) {
    const names = new Set<string>();

    for (const requirement of projectDependencies) {
      if (typeof requirement !== "string") {
        continue;
      }

      const name = extractPep508Name(requirement);

      if (name) {
        names.add(name);
      }
    }

    for (const name of [...names].sort()) {
      packages.push({
        evidence: { note: "pyproject dependency kaydi.", source: manifestPath },
        name,
        scopes: ["runtime"]
      });
    }
  } else {
    const tool = pyproject.tool;
    const poetry =
      tool && typeof tool === "object" && !Array.isArray(tool)
        ? (tool as Record<string, unknown>).poetry
        : undefined;
    const poetryDependencies =
      poetry && typeof poetry === "object" && !Array.isArray(poetry)
        ? (poetry as Record<string, unknown>).dependencies
        : undefined;

    if (poetryDependencies && typeof poetryDependencies === "object" && !Array.isArray(poetryDependencies)) {
      const names = Object.keys(poetryDependencies as Record<string, unknown>).filter(
        (name) => name !== "python"
      );

      for (const name of names.sort()) {
        packages.push({
          evidence: { note: "pyproject dependency kaydi.", source: manifestPath },
          name,
          scopes: ["runtime"]
        });
      }
    }
  }

  return { packages, stack };
};

const buildLanguageStack = (files: ClassifiedFile[]): TechnologyStackEntry[] => {
  const seen = new Set<string>();
  const entries: TechnologyStackEntry[] = [];

  for (const file of files) {
    if (file.origin !== "project" || file.kind !== "source" || !file.format) {
      continue;
    }

    const languageName = LANGUAGE_BY_FORMAT[file.format];

    if (!languageName || seen.has(languageName)) {
      continue;
    }

    seen.add(languageName);
    entries.push({
      category: "Language",
      evidence: { note: `${file.format} source dosyasi sinyali.`, source: "CLASSIFIED_FILES.json" },
      name: languageName
    });
  }

  return entries;
};

export const runMapDependenciesJob = async (
  projectRootPath: string
): Promise<MapDependenciesResult> => {
  const reportsDir = discoveryReportsDir(projectRootPath);
  const classifiedPath = path.join(reportsDir, "CLASSIFIED_FILES.json");
  let classified: ClassifiedFilesDocument;

  try {
    classified = JSON.parse(await readFile(classifiedPath, "utf8")) as ClassifiedFilesDocument;
  } catch (error) {
    throw new Error(`Unable to read CLASSIFIED_FILES.json: ${(error as Error).message}`);
  }

  const seenPaths = new Set<string>();

  for (const file of classified.files) {
    if (seenPaths.has(file.path)) {
      throw new Error(`Duplicate classified path: ${file.path}`);
    }

    seenPaths.add(file.path);
  }

  const manifests = classified.files
    .filter((file) => file.origin === "project" && file.kind === "manifest")
    .map((file) => file.path)
    .sort();
  const siblingsFor = (manifestPath: string): Set<string> => {
    const dir = path.posix.dirname(manifestPath);
    return new Set(
      manifests
        .filter((candidate) => path.posix.dirname(candidate) === dir)
        .map((candidate) => path.posix.basename(candidate))
    );
  };

  const packages: DependencyPackage[] = [];
  const stack: TechnologyStackEntry[] = [...buildLanguageStack(classified.files)];
  const parsedManifests: string[] = [];

  for (const manifestPath of manifests) {
    const basename = path.posix.basename(manifestPath);
    const absolutePath = path.join(projectRootPath, ...manifestPath.split("/"));
    const siblingNames = siblingsFor(manifestPath);

    try {
      if (basename === "package.json") {
        const packageJson = await readJsonFile<Record<string, unknown>>(absolutePath);
        const result = buildPackageJsonRecords(manifestPath, siblingNames, packageJson);
        packages.push(...result.packages);
        stack.push(...result.stack);
        parsedManifests.push(manifestPath);
      } else if (basename === "composer.json") {
        const composerJson = await readJsonFile<Record<string, unknown>>(absolutePath);
        const result = buildComposerJsonRecords(manifestPath, siblingNames, composerJson);
        packages.push(...result.packages);
        stack.push(...result.stack);
        parsedManifests.push(manifestPath);
      } else if (basename === "pyproject.toml") {
        const raw = await readFile(absolutePath, "utf8");
        const pyproject = parseToml(raw);
        const result = buildPyprojectTomlRecords(manifestPath, pyproject);
        packages.push(...result.packages);
        stack.push(...result.stack);
        parsedManifests.push(manifestPath);
      } else if (["package-lock.json", "npm-shrinkwrap.json", "composer.lock", "Pipfile.lock", "packages.lock.json"].includes(basename)) {
        await readJsonFile<Record<string, unknown>>(absolutePath);
        parsedManifests.push(manifestPath);
      } else if (["Cargo.lock", "poetry.lock"].includes(basename)) {
        parseToml(await readFile(absolutePath, "utf8"));
        parsedManifests.push(manifestPath);
      } else if (["pnpm-lock.yaml", "yarn.lock", "go.sum", "go.work.sum", "gradle.lockfile"].includes(basename)) {
        await readFile(absolutePath, "utf8");
        parsedManifests.push(manifestPath);
      }
    } catch {
      // The manifest remains in unparsed_manifests and D05 will fail dependency coverage.
    }
  }

  parsedManifests.sort();
  const parsedManifestSet = new Set(parsedManifests);
  const unparsedManifests = manifests.filter((manifestPath) => !parsedManifestSet.has(manifestPath));

  const FRAMEWORK_BY_PACKAGE: Record<string, string> = {
    "laravel/framework": "Laravel",
    "@nestjs/core": "NestJS",
    "next": "Next.js",
    "nuxt": "Nuxt",
    "react": "React",
    "vue": "Vue",
    "express": "Express",
    "django": "Django",
    "flask": "Flask",
    "rails": "Ruby on Rails"
  };
  for (const pkg of packages) {
    const framework = FRAMEWORK_BY_PACKAGE[pkg.name.toLowerCase()];
    if (framework) {
      stack.push({
        category: "Framework",
        evidence: { note: "framework dependency kaydi.", source: pkg.evidence.source },
        name: framework
      });
    }
  }

  const dedupedPackagesMap = new Map<string, DependencyPackage>();

  for (const pkg of packages) {
    dedupedPackagesMap.set(`${pkg.name} ${pkg.evidence.source}`, pkg);
  }

  const dedupedPackages = [...dedupedPackagesMap.values()].sort((left, right) =>
    left.name === right.name
      ? left.evidence.source < right.evidence.source
        ? -1
        : 1
      : left.name < right.name
        ? -1
        : 1
  );

  const dedupedStackMap = new Map<string, TechnologyStackEntry>();

  for (const entry of stack) {
    dedupedStackMap.set(`${entry.category} ${entry.name}`, entry);
  }

  const dedupedStack = [...dedupedStackMap.values()].sort((left, right) => {
    const categoryDiff =
      TECH_STACK_CATEGORY_ORDER.indexOf(left.category) - TECH_STACK_CATEGORY_ORDER.indexOf(right.category);

    return categoryDiff !== 0 ? categoryDiff : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });

  await mkdir(reportsDir, { recursive: true });

  await writeJson(path.join(reportsDir, "DEPENDENCY_MAP.json"), {
    manifests,
    metadata: buildMetadata(),
    packages: dedupedPackages,
    parsed_manifests: parsedManifests,
    unparsed_manifests: unparsedManifests
  });

  await writeJson(path.join(reportsDir, "TECHNOLOGY_STACK.json"), {
    metadata: buildMetadata(),
    stack: dedupedStack
  });

  return {
    package_count: dedupedPackages.length,
    technology_count: dedupedStack.length
  };
};

// ---------------------------------------------------------------------------
// RULE-D03 — index_documents
// ---------------------------------------------------------------------------

export type IndexDocumentsResult = {
  document_count: number;
  glossary_term_count: number;
  missing_document_count: number;
  reference_count: number;
};

type DocumentCapabilities = {
  anchors: boolean;
  code_blocks: boolean;
  headings: boolean;
  links: boolean;
  tables: boolean;
};

type DocumentHeading = {
  anchor: string;
  level: number;
  line: number;
  text: string;
};

type DocumentCodeBlock = {
  language: string | null;
  line: number;
};

type DocumentTable = {
  columns: number;
  line: number;
};

type ReferenceLinkType = "external" | "internal" | "relative";
type ReferenceStatus = "broken" | "ok" | "outside_project" | "unchecked";
type ReferenceFailureKind = "missing_anchor" | "missing_target" | "outside_project" | null;

type DocumentReference = {
  failure_kind: ReferenceFailureKind;
  fragment: string | null;
  line: number;
  link_type: ReferenceLinkType;
  raw_target: string;
  resolved_path: string | null;
  source: string;
  status: ReferenceStatus;
};

type MissingDocumentEntry = {
  evidence: { line: number; source: string };
  referenced_from: string;
  resolved_path: string;
  target: string;
};

type GlossaryCategory =
  | "api_name"
  | "business_term"
  | "entity_name"
  | "module_name"
  | "role"
  | "service_name";

type GlossaryTerm = {
  category: GlossaryCategory;
  evidence: { excerpt: string; line: number; source: string };
  term: string;
};

export type GlossaryCandidateInput = {
  category?: unknown;
  evidence?: { line?: unknown; source?: unknown };
  term?: unknown;
};

type PreparedDocument = {
  capabilities: DocumentCapabilities;
  codeBlocks: DocumentCodeBlock[];
  format: FileFormat;
  headings: DocumentHeading[];
  lines: string[];
  links: Array<{ line: number; rawTarget: string }>;
  path: string;
  tables: DocumentTable[];
};

export type IndexDocumentsCandidateDocument = {
  lines: string[];
  source: string;
};

export type IndexDocumentsPreparation = {
  candidateDocuments: IndexDocumentsCandidateDocument[];
  documentIndexEntries: Array<{ capabilities: DocumentCapabilities; format: FileFormat; path: string }>;
  documentStructureEntries: Array<{
    codeBlocks: DocumentCodeBlock[];
    headings: DocumentHeading[];
    path: string;
    tables: DocumentTable[];
  }>;
  missingDocuments: MissingDocumentEntry[];
  preparedDocuments: PreparedDocument[];
  references: DocumentReference[];
  standardDocumentsInventory: Record<string, { paths: string[]; present: boolean }>;
};

const SUPPORTED_DOCUMENTATION_FORMATS = new Set(["asciidoc", "docx", "markdown", "pdf", "plain_text", "rst"]);
const GLOSSARY_CATEGORIES = new Set<GlossaryCategory>([
  "api_name",
  "business_term",
  "entity_name",
  "module_name",
  "role",
  "service_name"
]);
const CANDIDATE_VIEW_MAX_LINES_PER_DOCUMENT = 2000;
const CANDIDATE_VIEW_MAX_DOCUMENTS = 200;
const EXTERNAL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const PARAGRAPH_ANCHOR_PATTERN = /[^\w\s-]/g;

const normalizeCanonicalText = (raw: string): string => raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export const extractCanonicalText = async (absolutePath: string, format: FileFormat): Promise<string> => {
  if (format === "pdf") {
    const buffer = await readFile(absolutePath);
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return normalizeCanonicalText(result.text);
    } finally {
      await parser.destroy();
    }
  }

  if (format === "docx") {
    const result = await mammoth.extractRawText({ path: absolutePath });
    return normalizeCanonicalText(result.value);
  }

  return normalizeCanonicalText(await readFile(absolutePath, "utf8"));
};

const slugify = (text: string): string =>
  text.toLowerCase().trim().replace(PARAGRAPH_ANCHOR_PATTERN, "").replace(/\s+/g, "-");

const makeAnchorAllocator = (): ((text: string) => string) => {
  const seen = new Map<string, number>();

  return (text: string): string => {
    const base = slugify(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
};

const extractHeadings = (lines: string[]): DocumentHeading[] => {
  const headings: DocumentHeading[] = [];
  const allocateAnchor = makeAnchorAllocator();

  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);

    if (!match) {
      return;
    }

    const level = match[1]?.length ?? 1;
    const text = (match[2] ?? "").trim();

    if (!text) {
      return;
    }

    headings.push({ anchor: allocateAnchor(text), level, line: index + 1, text });
  });

  return headings;
};

const extractCodeBlocks = (lines: string[]): DocumentCodeBlock[] => {
  const blocks: DocumentCodeBlock[] = [];
  let openLine: number | null = null;
  let language: string | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = /^```(.*)$/.exec(line);

    if (!fenceMatch) {
      return;
    }

    if (openLine === null) {
      openLine = index + 1;
      language = (fenceMatch[1] ?? "").trim() || null;
      return;
    }

    blocks.push({ language, line: openLine });
    openLine = null;
    language = null;
  });

  return blocks;
};

const isTableSeparatorLine = (line: string): boolean =>
  line.includes("-") && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);

const countTableColumns = (headerLine: string): number => {
  let trimmed = headerLine.trim();

  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }

  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed.split("|").length;
};

const extractTables = (lines: string[]): DocumentTable[] => {
  const tables: DocumentTable[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index] ?? "";
    const separator = lines[index + 1] ?? "";

    if (header.includes("|") && isTableSeparatorLine(separator)) {
      tables.push({ columns: countTableColumns(header), line: index + 1 });
    }
  }

  return tables;
};

const extractLinks = (lines: string[]): Array<{ line: number; rawTarget: string }> => {
  const links: Array<{ line: number; rawTarget: string }> = [];
  const inlinePattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const autolinkPattern = /<((?:https?|mailto):[^>\s]+)>/g;

  lines.forEach((line, index) => {
    for (const match of line.matchAll(inlinePattern)) {
      if (match[1]) {
        links.push({ line: index + 1, rawTarget: match[1] });
      }
    }

    for (const match of line.matchAll(autolinkPattern)) {
      if (match[1]) {
        links.push({ line: index + 1, rawTarget: match[1] });
      }
    }
  });

  return links;
};

const buildPreparedDocument = async (
  projectRootPath: string,
  file: { format: FileFormat; path: string }
): Promise<PreparedDocument> => {
  const absolutePath = path.join(projectRootPath, file.path);
  let canonicalText: string;

  try {
    canonicalText = await extractCanonicalText(absolutePath, file.format);
  } catch (error) {
    throw new Error(`Unable to extract canonical text for ${file.path}: ${(error as Error).message}`);
  }

  const lines = canonicalText.split("\n");
  const isMarkdown = file.format === "markdown";

  return {
    capabilities: {
      anchors: isMarkdown,
      code_blocks: isMarkdown,
      headings: isMarkdown,
      links: isMarkdown,
      tables: isMarkdown
    },
    codeBlocks: isMarkdown ? extractCodeBlocks(lines) : [],
    format: file.format,
    headings: isMarkdown ? extractHeadings(lines) : [],
    lines,
    links: isMarkdown ? extractLinks(lines) : [],
    path: file.path,
    tables: isMarkdown ? extractTables(lines) : []
  };
};

const classifyLinkType = (rawTarget: string): ReferenceLinkType => {
  if (EXTERNAL_SCHEME_PATTERN.test(rawTarget)) {
    return "external";
  }

  if (rawTarget.startsWith("#")) {
    return "internal";
  }

  return "relative";
};

const splitFragmentAndQuery = (rawTarget: string): { fragment: string | null; pathAndQuery: string } => {
  const hashIndex = rawTarget.indexOf("#");

  if (hashIndex === -1) {
    return { fragment: null, pathAndQuery: rawTarget };
  }

  return { fragment: rawTarget.slice(hashIndex + 1) || null, pathAndQuery: rawTarget.slice(0, hashIndex) };
};

const stripQuery = (pathAndQuery: string): string => {
  const queryIndex = pathAndQuery.indexOf("?");
  return queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
};

const decodePathSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveRelativeTarget = (
  sourcePath: string,
  decodedPath: string
): { escapesRoot: boolean; resolvedPath: string } => {
  if (decodedPath === "") {
    return { escapesRoot: false, resolvedPath: sourcePath };
  }

  const sourceDir = path.posix.dirname(sourcePath);
  const joined = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : path.posix.join(sourceDir, decodedPath);
  const normalized = path.posix.normalize(joined);
  const escapesRoot = normalized === ".." || normalized.startsWith("../");

  return { escapesRoot, resolvedPath: normalized };
};

const isFileAt = async (projectRootPath: string, relativePath: string): Promise<boolean> => {
  try {
    return (await stat(path.join(projectRootPath, relativePath))).isFile();
  } catch {
    return false;
  }
};

const resolveDocumentReferences = async (
  projectRootPath: string,
  documents: PreparedDocument[]
): Promise<DocumentReference[]> => {
  const documentsByPath = new Map(documents.map((doc) => [doc.path, doc]));
  const references: DocumentReference[] = [];

  for (const doc of documents) {
    if (!doc.capabilities.links) {
      continue;
    }

    for (const link of doc.links) {
      const linkType = classifyLinkType(link.rawTarget);

      if (linkType === "external") {
        references.push({
          failure_kind: null,
          fragment: null,
          line: link.line,
          link_type: "external",
          raw_target: link.rawTarget,
          resolved_path: null,
          source: doc.path,
          status: "unchecked"
        });
        continue;
      }

      if (linkType === "internal") {
        const fragment = link.rawTarget.slice(1) || null;

        if (!fragment) {
          references.push({
            failure_kind: null,
            fragment: null,
            line: link.line,
            link_type: "internal",
            raw_target: link.rawTarget,
            resolved_path: null,
            source: doc.path,
            status: "unchecked"
          });
          continue;
        }

        if (doc.capabilities.anchors) {
          const matches = doc.headings.some((heading) => heading.anchor === fragment);
          references.push({
            failure_kind: matches ? null : "missing_anchor",
            fragment,
            line: link.line,
            link_type: "internal",
            raw_target: link.rawTarget,
            resolved_path: null,
            source: doc.path,
            status: matches ? "ok" : "broken"
          });
        } else {
          references.push({
            failure_kind: null,
            fragment,
            line: link.line,
            link_type: "internal",
            raw_target: link.rawTarget,
            resolved_path: null,
            source: doc.path,
            status: "unchecked"
          });
        }
        continue;
      }

      const { fragment, pathAndQuery } = splitFragmentAndQuery(link.rawTarget);
      const decodedPath = decodePathSegment(stripQuery(pathAndQuery));
      const resolution = resolveRelativeTarget(doc.path, decodedPath);

      if (resolution.escapesRoot) {
        references.push({
          failure_kind: "outside_project",
          fragment,
          line: link.line,
          link_type: "relative",
          raw_target: link.rawTarget,
          resolved_path: resolution.resolvedPath,
          source: doc.path,
          status: "outside_project"
        });
        continue;
      }

      const targetExists = await isFileAt(projectRootPath, resolution.resolvedPath);

      if (!targetExists) {
        references.push({
          failure_kind: "missing_target",
          fragment,
          line: link.line,
          link_type: "relative",
          raw_target: link.rawTarget,
          resolved_path: resolution.resolvedPath,
          source: doc.path,
          status: "broken"
        });
        continue;
      }

      if (!fragment) {
        references.push({
          failure_kind: null,
          fragment: null,
          line: link.line,
          link_type: "relative",
          raw_target: link.rawTarget,
          resolved_path: resolution.resolvedPath,
          source: doc.path,
          status: "ok"
        });
        continue;
      }

      const targetDoc = documentsByPath.get(resolution.resolvedPath);

      if (targetDoc?.capabilities.anchors) {
        const matches = targetDoc.headings.some((heading) => heading.anchor === fragment);
        references.push({
          failure_kind: matches ? null : "missing_anchor",
          fragment,
          line: link.line,
          link_type: "relative",
          raw_target: link.rawTarget,
          resolved_path: resolution.resolvedPath,
          source: doc.path,
          status: matches ? "ok" : "broken"
        });
      } else {
        references.push({
          failure_kind: null,
          fragment,
          line: link.line,
          link_type: "relative",
          raw_target: link.rawTarget,
          resolved_path: resolution.resolvedPath,
          source: doc.path,
          status: "unchecked"
        });
      }
    }
  }

  references.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source < right.source ? -1 : 1;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.raw_target < right.raw_target ? -1 : left.raw_target > right.raw_target ? 1 : 0;
  });

  return references;
};

const isDocumentationTargetPredicate = (resolvedPath: string): boolean => {
  const basename = path.posix.basename(resolvedPath);
  const extension = path.posix.extname(basename).toLowerCase();

  if (!basename.includes(".") && STANDARD_DOCUMENT_NAMES.has(basename)) {
    return true;
  }

  return Object.hasOwn(DOCUMENTATION_EXTENSIONS, extension);
};

const buildMissingDocuments = (references: DocumentReference[]): MissingDocumentEntry[] => {
  const missing: MissingDocumentEntry[] = [];

  for (const reference of references) {
    if (
      reference.link_type === "relative" &&
      reference.status === "broken" &&
      reference.failure_kind === "missing_target" &&
      reference.resolved_path &&
      isDocumentationTargetPredicate(reference.resolved_path)
    ) {
      missing.push({
        evidence: { line: reference.line, source: reference.source },
        referenced_from: reference.source,
        resolved_path: reference.resolved_path,
        target: reference.raw_target
      });
    }
  }

  missing.sort((left, right) => {
    if (left.referenced_from !== right.referenced_from) {
      return left.referenced_from < right.referenced_from ? -1 : 1;
    }

    if (left.evidence.line !== right.evidence.line) {
      return left.evidence.line - right.evidence.line;
    }

    return left.target < right.target ? -1 : left.target > right.target ? 1 : 0;
  });

  return missing;
};

const STANDARD_DOCUMENT_GROUP_NAMES = ["README", "CHANGELOG", "CONTRIBUTING", "LICENSE"];

const buildStandardDocumentsInventory = (
  documents: Array<{ path: string }>
): Record<string, { paths: string[]; present: boolean }> => {
  const groups: Record<string, string[]> = {
    CHANGELOG: [],
    CONTRIBUTING: [],
    LICENSE: [],
    README: []
  };

  for (const doc of documents) {
    if (doc.path.includes("/")) {
      continue;
    }

    const dotIndex = doc.path.indexOf(".");
    const namePart = dotIndex === -1 ? doc.path : doc.path.slice(0, dotIndex);
    const extensionPart = dotIndex === -1 ? "" : doc.path.slice(dotIndex).toLowerCase();
    const hasSingleExtension = dotIndex === -1 || !extensionPart.slice(1).includes(".");

    if (!hasSingleExtension) {
      continue;
    }

    for (const groupName of STANDARD_DOCUMENT_GROUP_NAMES) {
      if (namePart.toLowerCase() !== groupName.toLowerCase()) {
        continue;
      }

      if (dotIndex === -1 || Object.hasOwn(DOCUMENTATION_EXTENSIONS, extensionPart)) {
        groups[groupName]?.push(doc.path);
      }
    }
  }

  const inventory: Record<string, { paths: string[]; present: boolean }> = {};

  for (const groupName of STANDARD_DOCUMENT_GROUP_NAMES) {
    const paths = (groups[groupName] ?? []).slice().sort();
    inventory[groupName] = { paths, present: paths.length > 0 };
  }

  return inventory;
};

const selectDocumentationFiles = (
  classified: ClassifiedFilesDocument
): Array<{ format: FileFormat; path: string }> => {
  const seen = new Set<string>();
  const documents: Array<{ format: FileFormat; path: string }> = [];

  for (const file of classified.files) {
    if (file.origin !== "project" || file.kind !== "documentation") {
      continue;
    }

    if (seen.has(file.path)) {
      throw new Error(`Duplicate documentation path: ${file.path}`);
    }

    seen.add(file.path);

    if (!file.format || !SUPPORTED_DOCUMENTATION_FORMATS.has(file.format)) {
      throw new Error(`Unsupported documentation format for ${file.path}: ${String(file.format)}`);
    }

    documents.push({ format: file.format, path: file.path });
  }

  return documents.sort(byPath);
};

export const prepareIndexDocumentsJob = async (
  projectRootPath: string
): Promise<IndexDocumentsPreparation> => {
  const reportsDir = discoveryReportsDir(projectRootPath);
  const classifiedPath = path.join(reportsDir, "CLASSIFIED_FILES.json");
  let classified: ClassifiedFilesDocument;

  try {
    classified = JSON.parse(await readFile(classifiedPath, "utf8")) as ClassifiedFilesDocument;
  } catch (error) {
    throw new Error(`Unable to read CLASSIFIED_FILES.json: ${(error as Error).message}`);
  }

  const documentationFiles = selectDocumentationFiles(classified);
  const preparedDocuments: PreparedDocument[] = [];

  for (const file of documentationFiles) {
    preparedDocuments.push(await buildPreparedDocument(projectRootPath, file));
  }

  const references = await resolveDocumentReferences(projectRootPath, preparedDocuments);
  const missingDocuments = buildMissingDocuments(references);
  const standardDocumentsInventory = buildStandardDocumentsInventory(documentationFiles);

  const candidateDocuments = preparedDocuments.slice(0, CANDIDATE_VIEW_MAX_DOCUMENTS).map((doc) => ({
    lines: doc.lines.slice(0, CANDIDATE_VIEW_MAX_LINES_PER_DOCUMENT),
    source: doc.path
  }));

  return {
    candidateDocuments,
    documentIndexEntries: preparedDocuments.map((doc) => ({
      capabilities: doc.capabilities,
      format: doc.format,
      path: doc.path
    })),
    documentStructureEntries: preparedDocuments.map((doc) => ({
      codeBlocks: doc.codeBlocks,
      headings: doc.headings,
      path: doc.path,
      tables: doc.tables
    })),
    missingDocuments,
    preparedDocuments,
    references,
    standardDocumentsInventory
  };
};

export const finalizeIndexDocumentsJob = async (
  projectRootPath: string,
  preparation: IndexDocumentsPreparation,
  candidates: GlossaryCandidateInput[]
): Promise<IndexDocumentsResult> => {
  const linesBySource = new Map(preparation.preparedDocuments.map((doc) => [doc.path, doc.lines]));
  const terms: GlossaryTerm[] = [];
  const seen = new Set<string>();

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }

    const term = typeof candidate.term === "string" ? candidate.term : null;
    const category = typeof candidate.category === "string" ? candidate.category : null;
    const source = typeof candidate.evidence?.source === "string" ? candidate.evidence.source : null;
    const line = typeof candidate.evidence?.line === "number" ? candidate.evidence.line : null;

    if (!term || !category || !source || line === null || !GLOSSARY_CATEGORIES.has(category as GlossaryCategory)) {
      continue;
    }

    const lines = linesBySource.get(source);
    const lineText = lines?.[line - 1];

    if (typeof lineText !== "string" || !lineText.includes(term)) {
      continue;
    }

    const dedupeKey = `${term} ${category} ${source} ${line}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    terms.push({
      category: category as GlossaryCategory,
      evidence: { excerpt: lineText.trim(), line, source },
      term
    });
  }

  terms.sort((left, right) => {
    if (left.category !== right.category) {
      return left.category < right.category ? -1 : 1;
    }

    const normalizedLeft = left.term.toLowerCase();
    const normalizedRight = right.term.toLowerCase();

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft < normalizedRight ? -1 : 1;
    }

    if (left.evidence.source !== right.evidence.source) {
      return left.evidence.source < right.evidence.source ? -1 : 1;
    }

    return left.evidence.line - right.evidence.line;
  });

  const reportsDir = discoveryReportsDir(projectRootPath);
  await mkdir(reportsDir, { recursive: true });

  await writeJson(path.join(reportsDir, "DOCUMENT_INDEX.json"), {
    documents: preparation.documentIndexEntries,
    metadata: buildMetadata(),
    standard_documents_inventory: preparation.standardDocumentsInventory
  });

  await writeJson(path.join(reportsDir, "DOCUMENT_STRUCTURE.json"), {
    documents: preparation.documentStructureEntries.map((doc) => ({
      code_blocks: doc.codeBlocks,
      headings: doc.headings,
      path: doc.path,
      tables: doc.tables
    })),
    metadata: buildMetadata()
  });

  await writeJson(path.join(reportsDir, "DOCUMENT_REFERENCES.json"), {
    metadata: buildMetadata(),
    references: preparation.references
  });

  await writeJson(path.join(reportsDir, "MISSING_DOCUMENTS.json"), {
    metadata: buildMetadata(),
    missing: preparation.missingDocuments
  });

  await writeJson(path.join(reportsDir, "DOMAIN_GLOSSARY.json"), {
    metadata: buildMetadata(),
    terms
  });

  return {
    document_count: preparation.documentIndexEntries.length,
    glossary_term_count: terms.length,
    missing_document_count: preparation.missingDocuments.length,
    reference_count: preparation.references.length
  };
};

// ---------------------------------------------------------------------------
// RULE-D04 — build_context
// ---------------------------------------------------------------------------

export type BuildContextResult = {
  entity_count: number;
  module_count: number;
  unknown_count: number;
  user_role_count: number;
};

type SemanticEvidence =
  | { excerpt: string; field: string; source: string }
  | { excerpt: string; line: number; source: string };

type ModuleSummary = {
  file_count: number;
  formats: FileFormat[];
  kind_counts: Record<string, number>;
  signals: FileSignal[];
};

type ModuleBaseEntry = {
  id: string;
  name: string;
  paths: string[];
  root: string;
  summary: ModuleSummary;
};

type ManifestDescriptionCandidate = {
  field: string;
  moduleId: string;
  source: string;
  value: string;
};

type GlossaryTransplant = {
  evidence: { excerpt: string; line: number; source: string };
  term: string;
};

export type BuildContextEvidenceDocument = {
  lines: string[];
  source: string;
};

export type BuildContextPreparation = {
  businessTerms: GlossaryTransplant[];
  documents: BuildContextEvidenceDocument[];
  entities: GlossaryTransplant[];
  manifestDescriptionCandidates: ManifestDescriptionCandidate[];
  modules: ModuleBaseEntry[];
  projectName: string;
  technologyStack: TechnologyStackEntry[];
  userRoles: GlossaryTransplant[];
};

type FileInventoryDocument = {
  files: Array<{ path: string; size: number; vcs_status: VcsStatus }>;
  root: string;
  totals: { directories: number; files: number };
};

type TechnologyStackDocument = {
  metadata: Record<string, unknown>;
  stack: TechnologyStackEntry[];
};

type DocumentIndexDocument = {
  documents: Array<{ capabilities: DocumentCapabilities; format: FileFormat; path: string }>;
  metadata: Record<string, unknown>;
  standard_documents_inventory: Record<string, { paths: string[]; present: boolean }>;
};

type DomainGlossaryDocument = {
  metadata: Record<string, unknown>;
  terms: GlossaryTerm[];
};

const PROJECT_TYPES = new Set([
  "application",
  "service",
  "library",
  "cli",
  "monorepo",
  "infrastructure",
  "UNKNOWN"
]);
const MODULE_DEFINING_MANIFEST_EXACT_NAMES = new Set([
  "package.json",
  "composer.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "Pipfile"
]);
const MODULE_DEFINING_MANIFEST_EXTENSIONS = new Set([".csproj", ".fsproj", ".vbproj"]);
const MODULE_ROOT_FALLBACK_KINDS = new Set<FileKind>(["source", "database", "script"]);
const CANONICAL_SIGNAL_ORDER: FileSignal[] = ["test", "migration", "seed", "infrastructure"];
const UNRESOLVED_REASON = "No direct evidence found in allowed sources.";
const CONTEXT_DIR_SEGMENTS = [".ai-factory", "context", "project"];
const MANIFEST_DESCRIPTION_JSON_NAMES = new Set(["package.json", "composer.json"]);

const contextDir = (projectRootPath: string): string =>
  path.join(projectRootPath, ...CONTEXT_DIR_SEGMENTS);

const isModuleDefiningManifestPath = (filePath: string): boolean => {
  const base = path.posix.basename(filePath);

  if (MODULE_DEFINING_MANIFEST_EXACT_NAMES.has(base)) {
    return true;
  }

  return MODULE_DEFINING_MANIFEST_EXTENSIONS.has(path.posix.extname(base));
};

const moduleRootOf = (filePath: string): string => {
  const dir = path.posix.dirname(filePath);

  return dir === "." ? "." : dir;
};

const isPathUnderModuleRoot = (filePath: string, root: string): boolean =>
  root === "." || filePath === root || filePath.startsWith(`${root}/`);

const moduleRootDepth = (root: string): number => (root === "." ? 0 : root.split("/").length);

const readNestedString = (source: unknown, keys: string[]): string | null => {
  let current: unknown = source;

  for (const key of keys) {
    if (typeof current !== "object" || current === null) {
      return null;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" && current.trim() ? current : null;
};

const readManifestDescription = async (
  projectRootPath: string,
  manifestPath: string
): Promise<string | null> => {
  const base = path.posix.basename(manifestPath);
  const absolutePath = path.join(projectRootPath, manifestPath);

  try {
    if (MANIFEST_DESCRIPTION_JSON_NAMES.has(base)) {
      const json = await readJsonFile<Record<string, unknown>>(absolutePath);

      return typeof json.description === "string" && json.description.trim() ? json.description : null;
    }

    if (base === "pyproject.toml") {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = parseToml(raw);

      return (
        readNestedString(parsed, ["project", "description"]) ??
        readNestedString(parsed, ["tool", "poetry", "description"])
      );
    }

    if (base === "Cargo.toml") {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = parseToml(raw);

      return readNestedString(parsed, ["package", "description"]);
    }
  } catch {
    return null;
  }

  return null;
};

const dedupeGlossaryTransplants = (terms: GlossaryTerm[]): GlossaryTransplant[] => {
  const seen = new Set<string>();
  const result: GlossaryTransplant[] = [];

  for (const term of terms) {
    const key = `${term.term.toLowerCase()} ${term.evidence.source} ${term.evidence.line}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ evidence: term.evidence, term: term.term });
  }

  result.sort((left, right) => {
    const leftKey = left.term.toLowerCase();
    const rightKey = right.term.toLowerCase();

    if (leftKey !== rightKey) {
      return leftKey < rightKey ? -1 : 1;
    }

    if (left.evidence.source !== right.evidence.source) {
      return left.evidence.source < right.evidence.source ? -1 : 1;
    }

    return left.evidence.line - right.evidence.line;
  });

  return result;
};

const findLineText = (
  documents: BuildContextEvidenceDocument[],
  source: string,
  line: number
): string | null => {
  const document = documents.find((candidate) => candidate.source === source);
  const text = document?.lines[line - 1];

  return typeof text === "string" ? text : null;
};

const findManifestFieldValue = (
  candidates: ManifestDescriptionCandidate[],
  source: string,
  field: string
): string | null => {
  const candidate = candidates.find((entry) => entry.source === source && entry.field === field);

  return candidate ? candidate.value : null;
};

const validateSemanticEvidence = (
  raw: unknown,
  documents: BuildContextEvidenceDocument[],
  manifestCandidates: ManifestDescriptionCandidate[]
): SemanticEvidence | null => {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const obj = raw as Record<string, unknown>;
  const source = typeof obj.source === "string" ? obj.source : null;
  const excerpt = typeof obj.excerpt === "string" ? obj.excerpt.trim() : null;

  if (!source || !excerpt) {
    return null;
  }

  if (typeof obj.line === "number" && Number.isInteger(obj.line) && obj.line > 0) {
    const lineText = findLineText(documents, source, obj.line);

    return typeof lineText === "string" && lineText.includes(excerpt)
      ? { excerpt, line: obj.line, source }
      : null;
  }

  if (typeof obj.field === "string" && obj.field) {
    const fieldValue = findManifestFieldValue(manifestCandidates, source, obj.field);

    return typeof fieldValue === "string" && fieldValue.includes(excerpt)
      ? { excerpt, field: obj.field, source }
      : null;
  }

  return null;
};

export const prepareBuildContextJob = async (
  projectRootPath: string
): Promise<BuildContextPreparation> => {
  const reportsDir = discoveryReportsDir(projectRootPath);

  let inventory: FileInventoryDocument;

  try {
    inventory = JSON.parse(
      await readFile(path.join(reportsDir, "FILE_INVENTORY.json"), "utf8")
    ) as FileInventoryDocument;
  } catch (error) {
    throw new Error(`Unable to read FILE_INVENTORY.json: ${(error as Error).message}`);
  }

  let classified: ClassifiedFilesDocument;

  try {
    classified = JSON.parse(
      await readFile(path.join(reportsDir, "CLASSIFIED_FILES.json"), "utf8")
    ) as ClassifiedFilesDocument;
  } catch (error) {
    throw new Error(`Unable to read CLASSIFIED_FILES.json: ${(error as Error).message}`);
  }

  let documentIndex: DocumentIndexDocument;

  try {
    documentIndex = JSON.parse(
      await readFile(path.join(reportsDir, "DOCUMENT_INDEX.json"), "utf8")
    ) as DocumentIndexDocument;
  } catch (error) {
    throw new Error(`Unable to read DOCUMENT_INDEX.json: ${(error as Error).message}`);
  }

  let glossary: DomainGlossaryDocument;

  try {
    glossary = JSON.parse(
      await readFile(path.join(reportsDir, "DOMAIN_GLOSSARY.json"), "utf8")
    ) as DomainGlossaryDocument;
  } catch (error) {
    throw new Error(`Unable to read DOMAIN_GLOSSARY.json: ${(error as Error).message}`);
  }

  let technologyStackDoc: TechnologyStackDocument;

  try {
    technologyStackDoc = JSON.parse(
      await readFile(path.join(reportsDir, "TECHNOLOGY_STACK.json"), "utf8")
    ) as TechnologyStackDocument;
  } catch (error) {
    throw new Error(`Unable to read TECHNOLOGY_STACK.json: ${(error as Error).message}`);
  }

  if (
    !Array.isArray(inventory.files) ||
    !Array.isArray(classified.files) ||
    !Array.isArray(technologyStackDoc.stack) ||
    !Array.isArray(glossary.terms)
  ) {
    throw new Error("Invalid structured input for build_context.");
  }

  const inventoryPaths = new Set<string>();

  for (const file of inventory.files) {
    if (inventoryPaths.has(file.path)) {
      throw new Error(`Duplicate inventory path: ${file.path}`);
    }

    inventoryPaths.add(file.path);
  }

  const classifiedByPath = new Map(classified.files.map((file) => [file.path, file]));

  if (classifiedByPath.size !== classified.files.length) {
    throw new Error("Duplicate classified path detected.");
  }

  const classifiedPaths = new Set(classifiedByPath.keys());

  if (
    inventoryPaths.size !== classifiedPaths.size ||
    [...inventoryPaths].some((filePath) => !classifiedPaths.has(filePath))
  ) {
    throw new Error("FILE_INVENTORY.json and CLASSIFIED_FILES.json path sets do not match.");
  }

  const explicitRootManifests = new Map<string, string[]>();

  for (const file of classified.files) {
    if (file.origin !== "project" || file.kind !== "manifest" || !isModuleDefiningManifestPath(file.path)) {
      continue;
    }

    const root = moduleRootOf(file.path);
    const list = explicitRootManifests.get(root) ?? [];

    list.push(file.path);
    explicitRootManifests.set(root, list);
  }

  const explicitRootsDeepestFirst = [...explicitRootManifests.keys()].sort(
    (left, right) => moduleRootDepth(right) - moduleRootDepth(left)
  );

  const sortedInventoryPaths = [...inventoryPaths]
    .filter((filePath) => classifiedByPath.get(filePath)?.origin === "project")
    .sort();
  const assignment = new Map<string, string>();

  for (const filePath of sortedInventoryPaths) {
    const matchedRoot = explicitRootsDeepestFirst.find((root) => isPathUnderModuleRoot(filePath, root));

    if (matchedRoot) {
      assignment.set(filePath, matchedRoot);
    }
  }

  const unassignedAfterExplicit = sortedInventoryPaths.filter((filePath) => !assignment.has(filePath));
  const unassignedByTopDir = new Map<string, string[]>();

  for (const filePath of unassignedAfterExplicit) {
    const slashIndex = filePath.indexOf("/");

    if (slashIndex === -1) {
      continue;
    }

    const topDir = filePath.slice(0, slashIndex);
    const list = unassignedByTopDir.get(topDir) ?? [];

    list.push(filePath);
    unassignedByTopDir.set(topDir, list);
  }

  for (const [topDir, paths] of unassignedByTopDir) {
    const hasFallbackEligibleFile = paths.some((filePath) => {
      const kind = classifiedByPath.get(filePath)?.kind;

      return kind ? MODULE_ROOT_FALLBACK_KINDS.has(kind) : false;
    });

    if (!hasFallbackEligibleFile) {
      continue;
    }

    for (const filePath of paths) {
      assignment.set(filePath, topDir);
    }
  }

  const stillUnassigned = sortedInventoryPaths.filter((filePath) => !assignment.has(filePath));

  for (const filePath of stillUnassigned) {
    assignment.set(filePath, ".");
  }

  const pathsByRoot = new Map<string, string[]>();

  for (const [filePath, root] of assignment) {
    const list = pathsByRoot.get(root) ?? [];

    list.push(filePath);
    pathsByRoot.set(root, list);
  }

  const modules: ModuleBaseEntry[] = [];

  for (const [root, paths] of pathsByRoot) {
    const id = root === "." ? "root" : root;
    const name = root === "." ? "root" : (root.split("/").pop() ?? root);
    const sortedPaths = [...paths].sort();
    const kindCounts: Record<string, number> = {};
    const formatsSet = new Set<NonNullable<FileFormat>>();
    const signalsSet = new Set<FileSignal>();

    for (const filePath of sortedPaths) {
      const classifiedFile = classifiedByPath.get(filePath);

      if (!classifiedFile) {
        continue;
      }

      kindCounts[classifiedFile.kind] = (kindCounts[classifiedFile.kind] ?? 0) + 1;

      if (classifiedFile.format) {
        formatsSet.add(classifiedFile.format);
      }

      for (const signal of classifiedFile.signals) {
        signalsSet.add(signal);
      }
    }

    modules.push({
      id,
      name,
      paths: sortedPaths,
      root,
      summary: {
        file_count: sortedPaths.length,
        formats: [...formatsSet].sort(),
        kind_counts: kindCounts,
        signals: CANONICAL_SIGNAL_ORDER.filter((signal) => signalsSet.has(signal))
      }
    });
  }

  modules.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const rootIndex = modules.findIndex((module) => module.id === "root");

  if (rootIndex > 0) {
    const rootModule = modules[rootIndex];

    if (rootModule) {
      modules.splice(rootIndex, 1);
      modules.unshift(rootModule);
    }
  }

  const manifestDescriptionCandidates: ManifestDescriptionCandidate[] = [];

  for (const [root, manifestPaths] of explicitRootManifests) {
    const moduleId = root === "." ? "root" : root;

    for (const manifestPath of [...manifestPaths].sort()) {
      const description = await readManifestDescription(projectRootPath, manifestPath);

      if (description) {
        manifestDescriptionCandidates.push({
          field: "description",
          moduleId,
          source: manifestPath,
          value: description
        });
      }
    }
  }

  const documents: BuildContextEvidenceDocument[] = [];

  for (const doc of documentIndex.documents) {
    const absolutePath = path.join(projectRootPath, doc.path);
    let canonicalText: string;

    try {
      canonicalText = await extractCanonicalText(absolutePath, doc.format);
    } catch (error) {
      throw new Error(`Unable to extract canonical text for ${doc.path}: ${(error as Error).message}`);
    }

    documents.push({ lines: canonicalText.split("\n"), source: doc.path });
  }

  const entities = dedupeGlossaryTransplants(glossary.terms.filter((term) => term.category === "entity_name"));
  const userRoles = dedupeGlossaryTransplants(glossary.terms.filter((term) => term.category === "role"));
  const businessTerms = dedupeGlossaryTransplants(
    glossary.terms.filter((term) => term.category === "business_term" || term.category === "entity_name")
  );

  return {
    businessTerms,
    documents,
    entities,
    manifestDescriptionCandidates,
    modules,
    projectName: path.basename(projectRootPath),
    technologyStack: technologyStackDoc.stack,
    userRoles
  };
};

type BuildContextModulePatchEntry = {
  description?: unknown;
  description_evidence?: unknown;
  id?: unknown;
};

type BuildContextAssumptionPatchEntry = {
  evidence?: unknown;
  statement?: unknown;
};

type BuildContextPatchInput = {
  assumptions?: unknown;
  business_domain?: { name?: unknown; name_evidence?: unknown };
  modules?: unknown;
  project?: { evidence?: { purpose?: unknown; type?: unknown }; purpose?: unknown; type?: unknown };
};

export const finalizeBuildContextJob = async (
  projectRootPath: string,
  preparation: BuildContextPreparation,
  patch: unknown
): Promise<BuildContextResult> => {
  const patchObject: BuildContextPatchInput =
    typeof patch === "object" && patch !== null ? (patch) : {};
  const unknowns: Array<{ field: string; reason: string }> = [];
  const usedSources = new Set<string>();

  let resolvedType = "UNKNOWN";
  let typeEvidence: SemanticEvidence | null = null;
  const claimedType = patchObject.project?.type;

  if (typeof claimedType === "string" && claimedType !== "UNKNOWN" && PROJECT_TYPES.has(claimedType)) {
    const evidence = validateSemanticEvidence(
      patchObject.project?.evidence?.type,
      preparation.documents,
      preparation.manifestDescriptionCandidates
    );

    if (evidence) {
      resolvedType = claimedType;
      typeEvidence = evidence;
      usedSources.add(evidence.source);
    }
  }

  if (resolvedType === "UNKNOWN") {
    unknowns.push({ field: "project.type", reason: UNRESOLVED_REASON });
  }

  let resolvedPurpose = "UNKNOWN";
  let purposeEvidence: SemanticEvidence | null = null;
  const claimedPurpose = patchObject.project?.purpose;

  if (typeof claimedPurpose === "string" && claimedPurpose.trim() && claimedPurpose !== "UNKNOWN") {
    const evidence = validateSemanticEvidence(
      patchObject.project?.evidence?.purpose,
      preparation.documents,
      preparation.manifestDescriptionCandidates
    );

    if (evidence) {
      resolvedPurpose = claimedPurpose.trim();
      purposeEvidence = evidence;
      usedSources.add(evidence.source);
    }
  }

  if (resolvedPurpose === "UNKNOWN") {
    unknowns.push({ field: "project.purpose", reason: UNRESOLVED_REASON });
  }

  let resolvedDomainName = "UNKNOWN";
  let domainNameEvidence: SemanticEvidence | null = null;
  const claimedDomainName = patchObject.business_domain?.name;

  if (typeof claimedDomainName === "string" && claimedDomainName.trim() && claimedDomainName !== "UNKNOWN") {
    const evidence = validateSemanticEvidence(
      patchObject.business_domain?.name_evidence,
      preparation.documents,
      preparation.manifestDescriptionCandidates
    );

    if (evidence) {
      resolvedDomainName = claimedDomainName.trim();
      domainNameEvidence = evidence;
      usedSources.add(evidence.source);
    }
  }

  if (resolvedDomainName === "UNKNOWN") {
    unknowns.push({ field: "business_domain.name", reason: UNRESOLVED_REASON });
  }

  const modulePatchById = new Map<string, BuildContextModulePatchEntry>();

  if (Array.isArray(patchObject.modules)) {
    for (const entry of patchObject.modules as unknown[]) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const typedEntry = entry as BuildContextModulePatchEntry;

      if (typeof typedEntry.id === "string" && !modulePatchById.has(typedEntry.id)) {
        modulePatchById.set(typedEntry.id, typedEntry);
      }
    }
  }

  const moduleContextEntries: Array<{
    description: string;
    description_evidence: SemanticEvidence | null;
    id: string;
    name: string;
    root: string;
  }> = [];

  for (const module of preparation.modules) {
    const patchEntry = modulePatchById.get(module.id);
    let description = "UNKNOWN";
    let descriptionEvidence: SemanticEvidence | null = null;

    if (
      patchEntry &&
      typeof patchEntry.description === "string" &&
      patchEntry.description.trim() &&
      patchEntry.description !== "UNKNOWN"
    ) {
      const evidence = validateSemanticEvidence(
        patchEntry.description_evidence,
        preparation.documents,
        preparation.manifestDescriptionCandidates
      );

      if (evidence) {
        description = patchEntry.description.trim();
        descriptionEvidence = evidence;
        usedSources.add(evidence.source);
      }
    }

    if (description === "UNKNOWN") {
      unknowns.push({ field: `modules[${module.id}].description`, reason: UNRESOLVED_REASON });
    }

    moduleContextEntries.push({
      description,
      description_evidence: descriptionEvidence,
      id: module.id,
      name: module.name,
      root: module.root
    });
  }

  const resolvedAssumptions: Array<{ evidence: SemanticEvidence; statement: string }> = [];

  if (Array.isArray(patchObject.assumptions)) {
    for (const entry of patchObject.assumptions as unknown[]) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const typedEntry = entry as BuildContextAssumptionPatchEntry;

      if (typeof typedEntry.statement !== "string" || !typedEntry.statement.trim()) {
        continue;
      }

      const evidence = validateSemanticEvidence(
        typedEntry.evidence,
        preparation.documents,
        preparation.manifestDescriptionCandidates
      );

      if (!evidence) {
        continue;
      }

      resolvedAssumptions.push({ evidence, statement: typedEntry.statement.trim() });
      usedSources.add(evidence.source);
    }
  }

  unknowns.sort((left, right) => (left.field < right.field ? -1 : left.field > right.field ? 1 : 0));
  const sources = [...usedSources].sort();

  await mkdir(discoveryReportsDir(projectRootPath), { recursive: true });
  await mkdir(contextDir(projectRootPath), { recursive: true });

  await writeJson(path.join(contextDir(projectRootPath), "PROJECT_CONTEXT.json"), {
    assumptions: resolvedAssumptions,
    business_domain: {
      entities: preparation.entities,
      name: resolvedDomainName,
      name_evidence: domainNameEvidence
    },
    metadata: buildMetadata(),
    modules: moduleContextEntries,
    project: {
      evidence: { purpose: purposeEvidence, type: typeEvidence },
      name: preparation.projectName,
      purpose: resolvedPurpose,
      root_path: ".",
      type: resolvedType
    },
    sources,
    technology_stack: preparation.technologyStack,
    unknowns,
    user_roles: preparation.userRoles
  });

  await writeJson(path.join(discoveryReportsDir(projectRootPath), "MODULE_MAP_BASE.json"), {
    metadata: buildMetadata(),
    modules: preparation.modules.map((module) => {
      const contextEntry = moduleContextEntries.find((entry) => entry.id === module.id);

      return {
        description: contextEntry?.description ?? "UNKNOWN",
        description_evidence: contextEntry?.description_evidence ?? null,
        id: module.id,
        name: module.name,
        paths: module.paths,
        root: module.root,
        summary: module.summary
      };
    })
  });

  return {
    entity_count: preparation.entities.length,
    module_count: preparation.modules.length,
    unknown_count: unknowns.length,
    user_role_count: preparation.userRoles.length
  };
};
