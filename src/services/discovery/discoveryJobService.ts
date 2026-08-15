import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { parse as parseToml } from "smol-toml";
import ts from "typescript";

import { isDirectory, runGit, toPosixRelative } from "../shared/fsUtils";

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

type ClassifiedFile = {
  format: FileFormat;
  kind: FileKind;
  path: string;
  signals: FileSignal[];
};

const DISCOVERY_REPORTS_SEGMENTS = [".ai-factory", "020-Discovery", "reports"];
const ROOT_EXCLUDED_DIRECTORIES = new Set([
  ".ai-factory",
  ".ai-factory-runs",
  ".claude",
  ".git",
  "node_modules",
  "vendor"
]);
const EXCLUDED_FILE_NAME = "RUN_ENV.json";

const byPath = <T extends { path: string }>(left: T, right: T): number =>
  left.path < right.path ? -1 : left.path > right.path ? 1 : 0;

const buildMetadata = (): Record<string, unknown> => ({
  generated_at: new Date().toISOString(),
  generated_by: "ForgePilot",
  stage: "Discovery",
  version: "1.0.0"
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
  vcsStatusFor: (relativePath: string) => VcsStatus
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

    if (entry.isDirectory()) {
      directories.push({ included: true, path: relativePath });
      await scanTree(rootPath, entryPath, false, files, directories, vcsStatusFor);
      continue;
    }

    if (!entry.isFile()) {
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
  await scanTree(projectRootPath, projectRootPath, true, files, directories, vcsStatusFor);

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
      root_directories: [...ROOT_EXCLUDED_DIRECTORIES].sort()
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
  ".editorconfig"
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
      path: file.path,
      signals: computeSignals(file.path)
    };
  });
  const unknownFiles = classifiedFiles.filter((file) => file.kind === "unknown");

  await mkdir(reportsDir, { recursive: true });

  await writeJson(path.join(reportsDir, "CLASSIFIED_FILES.json"), {
    files: classifiedFiles.map((file) => ({
      format: file.format,
      kind: file.kind,
      path: file.path,
      signals: file.signals
    })),
    metadata: buildMetadata(),
    unknown: unknownFiles.map((file) => file.path)
  });

  await writeJson(path.join(reportsDir, "UNKNOWN_FILES.json"), {
    files: unknownFiles.map((file) => ({
      format: null,
      path: file.path,
      reason: "no deterministic kind rule matched",
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

type TechnologyStackCategory = "Build Backend" | "Language" | "Package Manager" | "Runtime";

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
  manifestPaths: Set<string>,
  packageJson: Record<string, unknown>
): { packages: DependencyPackage[]; stack: TechnologyStackEntry[] } => {
  const stack: TechnologyStackEntry[] = [];
  const packageManagerField =
    typeof packageJson.packageManager === "string" ? packageJson.packageManager : null;

  if (packageManagerField) {
    stack.push({
      category: "Package Manager",
      evidence: { field: "packageManager", note: "packageManager alani.", source: "package.json" },
      name: packageManagerField.split("@")[0] ?? packageManagerField
    });
  } else if (manifestPaths.has("pnpm-lock.yaml")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: "pnpm-lock.yaml" },
      name: "pnpm"
    });
  } else if (manifestPaths.has("yarn.lock")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: "yarn.lock" },
      name: "Yarn"
    });
  } else if (manifestPaths.has("package-lock.json") || manifestPaths.has("npm-shrinkwrap.json")) {
    stack.push({
      category: "Package Manager",
      evidence: {
        note: "lockfile bulundu.",
        source: manifestPaths.has("package-lock.json") ? "package-lock.json" : "npm-shrinkwrap.json"
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
      evidence: { field: "engines.node", note: "engines.node alani.", source: "package.json" },
      name: "Node.js"
    });
  }

  const packages = extractScopedPackages(
    "package.json",
    (packageJson.dependencies as Record<string, unknown>) ?? {},
    (packageJson.devDependencies as Record<string, unknown>) ?? {},
    "package dependency kaydi."
  );

  return { packages, stack };
};

const buildComposerJsonRecords = (
  manifestPaths: Set<string>,
  composerJson: Record<string, unknown>
): { packages: DependencyPackage[]; stack: TechnologyStackEntry[] } => {
  const stack: TechnologyStackEntry[] = [];

  if (manifestPaths.has("composer.lock")) {
    stack.push({
      category: "Package Manager",
      evidence: { note: "lockfile bulundu.", source: "composer.lock" },
      name: "Composer"
    });
  }

  const packages = extractScopedPackages(
    "composer.json",
    (composerJson.require as Record<string, unknown>) ?? {},
    (composerJson["require-dev"] as Record<string, unknown>) ?? {},
    "composer dependency kaydi.",
    (name) => name === "php" || name.startsWith("ext-")
  );

  return { packages, stack };
};

const buildPyprojectTomlRecords = (
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
          source: "pyproject.toml"
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
        evidence: { note: "pyproject dependency kaydi.", source: "pyproject.toml" },
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
          evidence: { note: "pyproject dependency kaydi.", source: "pyproject.toml" },
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
    if (file.kind !== "source" || !file.format) {
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
    .filter((file) => file.kind === "manifest")
    .map((file) => file.path)
    .sort();
  const manifestPathSet = new Set(manifests);

  const packages: DependencyPackage[] = [];
  const stack: TechnologyStackEntry[] = [...buildLanguageStack(classified.files)];
  const parsedManifests: string[] = [];

  if (manifestPathSet.has("package.json")) {
    parsedManifests.push("package.json");
    const packageJson = await readJsonFile<Record<string, unknown>>(
      path.join(projectRootPath, "package.json")
    );
    const result = buildPackageJsonRecords(manifestPathSet, packageJson);
    packages.push(...result.packages);
    stack.push(...result.stack);
  }

  if (manifestPathSet.has("composer.json")) {
    parsedManifests.push("composer.json");
    const composerJson = await readJsonFile<Record<string, unknown>>(
      path.join(projectRootPath, "composer.json")
    );
    const result = buildComposerJsonRecords(manifestPathSet, composerJson);
    packages.push(...result.packages);
    stack.push(...result.stack);
  }

  if (manifestPathSet.has("pyproject.toml")) {
    parsedManifests.push("pyproject.toml");
    let pyproject: Record<string, unknown>;

    try {
      const raw = await readFile(path.join(projectRootPath, "pyproject.toml"), "utf8");
      pyproject = parseToml(raw);
    } catch (error) {
      throw new Error(`Unable to parse pyproject.toml: ${(error as Error).message}`);
    }

    const result = buildPyprojectTomlRecords(pyproject);
    packages.push(...result.packages);
    stack.push(...result.stack);
  }

  parsedManifests.sort();
  const parsedManifestSet = new Set(parsedManifests);
  const unparsedManifests = manifests.filter((manifestPath) => !parsedManifestSet.has(manifestPath));

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

const extractCanonicalText = async (absolutePath: string, format: FileFormat): Promise<string> => {
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
    if (file.kind !== "documentation") {
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
    if (file.kind !== "manifest" || !isModuleDefiningManifestPath(file.path)) {
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

  const sortedInventoryPaths = [...inventoryPaths].sort();
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

// ---------------------------------------------------------------------------
// RULE-D08 — map_module_dependencies
// ---------------------------------------------------------------------------

export type MapModuleDependenciesResult = {
  edge_count: number;
  module_count: number;
  unresolved_count: number;
};

type ModuleMapBaseEntry = {
  description: unknown;
  description_evidence: unknown;
  id: string;
  name: string;
  paths: string[];
  root: string;
  summary: ModuleSummary;
};

type ModuleMapBaseDocument = {
  modules: ModuleMapBaseEntry[];
};

type DependencyEdgeEvidence = {
  field: string | null;
  kind: "manifest_reference" | "source_reference";
  line: number | null;
  raw_target: string;
  resolver: string;
  source: string;
};

type DependencyEdge = {
  evidence: DependencyEdgeEvidence;
  source_module: string;
  target_module: string;
};

type UnresolvedReason =
  | "ambiguous_local_module"
  | "ambiguous_local_namespace"
  | "ambiguous_local_package"
  | "ambiguous_target"
  | "dynamic_reference"
  | "outside_project"
  | "target_not_found"
  | "unsupported_alias"
  | "unsupported_reference_form";

type UnresolvedReferenceEntry = {
  field: string | null;
  line: number | null;
  raw_target: string;
  reason: UnresolvedReason;
  source: string;
};

type UnsupportedSourceFile = { format: FileFormat; path: string; reason: "unsupported_format" };
type UnparsedSourceFile = { format: FileFormat; path: string; reason: "parse_error" };
type UnsupportedManifestFile = { path: string; reason: "unsupported_manifest_reference" };
type UnparsedManifestFile = { path: string; reason: "parse_error" };

type Resolution =
  | { kind: "external" }
  | { kind: "module"; moduleId: string }
  | { kind: "path"; path: string }
  | { kind: "unresolved"; reason: UnresolvedReason };

type ManifestLocation = { manifestPath: string; moduleId: string; moduleRoot: string };

// "ambiguous" is one possible value of this string type; the union collapses
// structurally but the literal is still used as a sentinel at runtime.
type PackageRegistryEntry = string;

type GoRegistryValue = "ambiguous" | { moduleId: string; moduleRoot: string };

type Psr4Entry = { baseDirs: Set<string>; moduleId: string };
type Psr4Registry = Map<string, Map<string, Psr4Entry>>;

const SUPPORTED_SOURCE_FORMATS = new Set<FileFormat>([
  "go",
  "javascript",
  "jsx",
  "php",
  "python",
  "tsx",
  "typescript"
]);
const MODULE_DEFINING_UNSUPPORTED_MANIFEST_NAMES = [
  "pyproject.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "Pipfile"
];
const PACKAGE_JSON_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
const COMPOSER_DEPENDENCY_FIELDS = ["require", "require-dev"];
const CARGO_DEPENDENCY_FIELDS = ["dependencies", "dev-dependencies", "build-dependencies"];
const JS_TS_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const JS_TS_SCRIPT_KIND: Partial<Record<NonNullable<FileFormat>, ts.ScriptKind>> = {
  javascript: ts.ScriptKind.JS,
  jsx: ts.ScriptKind.JSX,
  tsx: ts.ScriptKind.TSX,
  typescript: ts.ScriptKind.TS
};
const GO_MODULE_DIRECTIVE_PATTERN = /^[ \t]*module[ \t]+(\S+)[ \t]*$/m;
const GO_REQUIRE_BLOCK_PATTERN = /^[ \t]*require[ \t]*\(\n([\s\S]*?)\n\)/gm;
const GO_REQUIRE_SINGLE_PATTERN = /^[ \t]*require[ \t]+(\S+)[ \t]+(\S+)[ \t]*(?:\/\/.*)?$/gm;
const GO_REQUIRE_BLOCK_LINE_PATTERN = /^[ \t]*(\S+)[ \t]+(\S+)[ \t]*(?:\/\/.*)?$/gm;
const GO_REPLACE_PATTERN = /^[ \t]*replace[ \t]+\S+/gm;
const GO_IMPORT_BLOCK_PATTERN = /^[ \t]*import[ \t]*\(\n([\s\S]*?)\n\)/gm;
const GO_IMPORT_BLOCK_LINE_PATTERN = /^[ \t]*(?:[A-Za-z_]\w*[ \t]+)?"([^"\n]*)"[ \t]*$/gm;
const GO_IMPORT_SINGLE_PATTERN = /^[ \t]*import[ \t]+"([^"\n]*)"[ \t]*$/gm;
const PHP_USE_PATTERN = /^[ \t]*use[ \t]+([^;]+);/gm;
const PYTHON_FROM_IMPORT_PATTERN = /^[ \t]*from[ \t]+(\.+)([A-Za-z_][\w.]*)?[ \t]+import[ \t]+([^\n]+)/gm;
const MSBUILD_PROJECT_REFERENCE_PATTERN = /<ProjectReference\b[^>]*\bInclude="([^"]+)"[^>]*\/?>/g;

const compareNullableLast = (left: number | string | null, right: number | string | null): number => {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left < right ? -1 : left > right ? 1 : 0;
};

const buildLineIndex = (text: string): number[] => {
  const offsets = [0];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      offsets.push(i + 1);
    }
  }

  return offsets;
};

const lineNumberForOffset = (lineOffsets: number[], offset: number): number => {
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if ((lineOffsets[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low + 1;
};

type NoiseMaskRules = {
  blockComment?: [string, string];
  lineCommentPrefixes: string[];
  quoteChars: string[];
  tripleQuotes?: string[];
};

const maskNoise = (source: string, rules: NoiseMaskRules): string => {
  const { blockComment, lineCommentPrefixes, quoteChars, tripleQuotes = [] } = rules;
  let result = "";
  let i = 0;
  const n = source.length;

  while (i < n) {
    const lineCommentPrefix = lineCommentPrefixes.find((prefix) => source.startsWith(prefix, i));

    if (lineCommentPrefix) {
      let j = i;

      while (j < n && source[j] !== "\n") {
        j += 1;
      }

      result += " ".repeat(j - i);
      i = j;
      continue;
    }

    if (blockComment && source.startsWith(blockComment[0], i)) {
      const end = source.indexOf(blockComment[1], i + blockComment[0].length);
      const stop = end === -1 ? n : end + blockComment[1].length;

      for (let k = i; k < stop; k += 1) {
        result += source[k] === "\n" ? "\n" : " ";
      }

      i = stop;
      continue;
    }

    const tripleQuote = tripleQuotes.find((quote) => source.startsWith(quote, i));

    if (tripleQuote) {
      const end = source.indexOf(tripleQuote, i + tripleQuote.length);
      const stop = end === -1 ? n : end + tripleQuote.length;

      for (let k = i; k < stop; k += 1) {
        result += source[k] === "\n" ? "\n" : " ";
      }

      i = stop;
      continue;
    }

    const ch = source[i] ?? "";

    if (quoteChars.includes(ch)) {
      let j = i + 1;

      while (j < n && source[j] !== ch) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }

        j += 1;
      }

      const stop = j < n ? j + 1 : n;

      for (let k = i; k < stop; k += 1) {
        result += source[k] === "\n" ? "\n" : " ";
      }

      i = stop;
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
};

const joinUnderModuleRoot = (
  moduleRoot: string,
  relativeValue: string
): { escapesRoot: boolean; resolved: string } => {
  const base = moduleRoot === "." ? "" : moduleRoot;
  const joined = path.posix.normalize(path.posix.join(base, relativeValue));
  const escapesRoot = joined === ".." || joined.startsWith("../");

  return { escapesRoot, resolved: joined };
};

const manifestAtModuleRoot = (module: ModuleMapBaseEntry, basename: string): string | null => {
  const expected = module.root === "." ? basename : `${module.root}/${basename}`;

  return module.paths.includes(expected) ? expected : null;
};

const locateModuleRootManifests = (
  modules: ModuleMapBaseEntry[],
  basename: string
): ManifestLocation[] => {
  const results: ManifestLocation[] = [];

  for (const module of modules) {
    const manifestPath = manifestAtModuleRoot(module, basename);

    if (manifestPath) {
      results.push({ manifestPath, moduleId: module.id, moduleRoot: module.root });
    }
  }

  return results;
};

const MSBUILD_PROJECT_EXTENSIONS = new Set([".csproj", ".fsproj", ".vbproj"]);

const locateModuleRootProjectFiles = (modules: ModuleMapBaseEntry[]): ManifestLocation[] => {
  const results: ManifestLocation[] = [];

  for (const module of modules) {
    for (const filePath of module.paths) {
      if (path.posix.dirname(filePath) !== module.root) {
        continue;
      }

      if (MSBUILD_PROJECT_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase())) {
        results.push({ manifestPath: filePath, moduleId: module.id, moduleRoot: module.root });
      }
    }
  }

  return results;
};

const ascendPosixPath = (dir: string, count: number): { escapesRoot: boolean; path: string } => {
  let current = dir;

  for (let i = 0; i < count; i += 1) {
    if (current === ".") {
      return { escapesRoot: true, path: "" };
    }

    current = path.posix.dirname(current);
  }

  return { escapesRoot: false, path: current };
};

const makeManifestEdge = (
  sourceModuleId: string,
  targetModuleId: string,
  source: string,
  field: string | null,
  line: number | null,
  rawTarget: string,
  resolver: string
): DependencyEdge => ({
  evidence: { field, kind: "manifest_reference", line, raw_target: rawTarget, resolver, source },
  source_module: sourceModuleId,
  target_module: targetModuleId
});

const applyResolution = (
  sourceModuleId: string,
  resolution: Resolution,
  evidence: {
    field: string | null;
    kind: "manifest_reference" | "source_reference";
    line: number | null;
    rawTarget: string;
    resolver: string;
    source: string;
  },
  pathToModuleId: Map<string, string>,
  edges: DependencyEdge[],
  unresolved: UnresolvedReferenceEntry[]
): void => {
  if (resolution.kind === "external") {
    return;
  }

  if (resolution.kind === "unresolved") {
    unresolved.push({
      field: evidence.field,
      line: evidence.line,
      raw_target: evidence.rawTarget,
      reason: resolution.reason,
      source: evidence.source
    });
    return;
  }

  const targetModuleId =
    resolution.kind === "module" ? resolution.moduleId : pathToModuleId.get(resolution.path);

  if (!targetModuleId) {
    unresolved.push({
      field: evidence.field,
      line: evidence.line,
      raw_target: evidence.rawTarget,
      reason: "target_not_found",
      source: evidence.source
    });
    return;
  }

  if (targetModuleId === sourceModuleId) {
    return;
  }

  edges.push({
    evidence: {
      field: evidence.field,
      kind: evidence.kind,
      line: evidence.line,
      raw_target: evidence.rawTarget,
      resolver: evidence.resolver,
      source: evidence.source
    },
    source_module: sourceModuleId,
    target_module: targetModuleId
  });
};

// --- Manifest content caches -------------------------------------------------

const readJsonManifestCache = async (
  projectRootPath: string,
  locations: ManifestLocation[],
  unparsedManifestPaths: Set<string>
): Promise<Map<string, Record<string, unknown>>> => {
  const cache = new Map<string, Record<string, unknown>>();

  for (const location of locations) {
    try {
      cache.set(
        location.manifestPath,
        await readJsonFile<Record<string, unknown>>(path.join(projectRootPath, location.manifestPath))
      );
    } catch {
      unparsedManifestPaths.add(location.manifestPath);
    }
  }

  return cache;
};

const readTomlManifestCache = async (
  projectRootPath: string,
  locations: ManifestLocation[],
  unparsedManifestPaths: Set<string>
): Promise<Map<string, Record<string, unknown>>> => {
  const cache = new Map<string, Record<string, unknown>>();

  for (const location of locations) {
    try {
      const raw = await readFile(path.join(projectRootPath, location.manifestPath), "utf8");
      cache.set(location.manifestPath, parseToml(raw));
    } catch {
      unparsedManifestPaths.add(location.manifestPath);
    }
  }

  return cache;
};

const readRawManifestCache = async (
  projectRootPath: string,
  locations: ManifestLocation[],
  unparsedManifestPaths: Set<string>,
  validate: (content: string) => boolean
): Promise<Map<string, string>> => {
  const cache = new Map<string, string>();

  for (const location of locations) {
    try {
      const content = normalizeCanonicalText(
        await readFile(path.join(projectRootPath, location.manifestPath), "utf8")
      );

      if (!validate(content)) {
        unparsedManifestPaths.add(location.manifestPath);
        continue;
      }

      cache.set(location.manifestPath, content);
    } catch {
      unparsedManifestPaths.add(location.manifestPath);
    }
  }

  return cache;
};

const readXmlManifestCache = async (
  projectRootPath: string,
  locations: ManifestLocation[],
  unparsedManifestPaths: Set<string>
): Promise<Map<string, string>> => {
  const cache = new Map<string, string>();

  for (const location of locations) {
    try {
      cache.set(
        location.manifestPath,
        normalizeCanonicalText(await readFile(path.join(projectRootPath, location.manifestPath), "utf8"))
      );
    } catch {
      unparsedManifestPaths.add(location.manifestPath);
    }
  }

  return cache;
};

// --- Registries ---------------------------------------------------------------

const buildNameRegistry = (
  locations: ManifestLocation[],
  cache: Map<string, Record<string, unknown>>
): Map<string, PackageRegistryEntry> => {
  const registry = new Map<string, PackageRegistryEntry>();

  for (const location of locations) {
    const json = cache.get(location.manifestPath);

    if (!json) {
      continue;
    }

    const name = typeof json.name === "string" && json.name.trim() ? json.name.trim() : null;

    if (!name) {
      continue;
    }

    const existing = registry.get(name);

    if (existing && existing !== "ambiguous" && existing !== location.moduleId) {
      registry.set(name, "ambiguous");
    } else if (!existing) {
      registry.set(name, location.moduleId);
    }
  }

  return registry;
};

const addPsr4Table = (
  registry: Psr4Registry,
  moduleId: string,
  moduleRoot: string,
  table: unknown
): void => {
  if (typeof table !== "object" || table === null) {
    return;
  }

  for (const [prefix, rawValue] of Object.entries(table as Record<string, unknown>)) {
    const values = Array.isArray(rawValue)
      ? rawValue.filter((value): value is string => typeof value === "string")
      : typeof rawValue === "string"
        ? [rawValue]
        : [];
    const baseDirs = new Set<string>();

    for (const value of values) {
      const { escapesRoot, resolved } = joinUnderModuleRoot(moduleRoot, value);

      if (!escapesRoot) {
        baseDirs.add(resolved);
      }
    }

    if (baseDirs.size === 0) {
      continue;
    }

    const byModule = registry.get(prefix) ?? new Map<string, Psr4Entry>();
    const existingEntry = byModule.get(moduleId);

    if (existingEntry) {
      for (const dir of baseDirs) {
        existingEntry.baseDirs.add(dir);
      }
    } else {
      byModule.set(moduleId, { baseDirs, moduleId });
    }

    registry.set(prefix, byModule);
  }
};

const buildPsr4Registry = (
  locations: ManifestLocation[],
  cache: Map<string, Record<string, unknown>>
): Psr4Registry => {
  const registry: Psr4Registry = new Map();

  for (const location of locations) {
    const json = cache.get(location.manifestPath);

    if (!json) {
      continue;
    }

    const autoload = json.autoload;
    const autoloadDev = json["autoload-dev"];

    if (typeof autoload === "object" && autoload !== null) {
      addPsr4Table(
        registry,
        location.moduleId,
        location.moduleRoot,
        (autoload as Record<string, unknown>)["psr-4"]
      );
    }

    if (typeof autoloadDev === "object" && autoloadDev !== null) {
      addPsr4Table(
        registry,
        location.moduleId,
        location.moduleRoot,
        (autoloadDev as Record<string, unknown>)["psr-4"]
      );
    }
  }

  return registry;
};

const extractGoModuleDirective = (content: string): string | null => {
  const match = GO_MODULE_DIRECTIVE_PATTERN.exec(content);

  return match?.[1] ?? null;
};

const buildGoModuleRegistry = (
  locations: ManifestLocation[],
  cache: Map<string, string>
): Map<string, GoRegistryValue> => {
  const registry = new Map<string, GoRegistryValue>();

  for (const location of locations) {
    const content = cache.get(location.manifestPath);

    if (!content) {
      continue;
    }

    const modulePath = extractGoModuleDirective(content);

    if (!modulePath) {
      continue;
    }

    const existing = registry.get(modulePath);

    if (existing && existing !== "ambiguous" && existing.moduleId !== location.moduleId) {
      registry.set(modulePath, "ambiguous");
    } else if (!existing) {
      registry.set(modulePath, { moduleId: location.moduleId, moduleRoot: location.moduleRoot });
    }
  }

  return registry;
};

// --- Manifest-reference analysis ----------------------------------------------

const analyzePackageJsonReferences = (
  locations: ManifestLocation[],
  cache: Map<string, Record<string, unknown>>,
  packageRegistry: Map<string, PackageRegistryEntry>,
  rootToModuleId: Map<string, string>
): { edges: DependencyEdge[]; unresolved: UnresolvedReferenceEntry[] } => {
  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  for (const location of locations) {
    const json = cache.get(location.manifestPath);

    if (!json) {
      continue;
    }

    for (const fieldName of PACKAGE_JSON_DEPENDENCY_FIELDS) {
      const table = json[fieldName];

      if (typeof table !== "object" || table === null || Array.isArray(table)) {
        continue;
      }

      for (const [depName, depValueRaw] of Object.entries(table as Record<string, unknown>)) {
        const depValue = typeof depValueRaw === "string" ? depValueRaw : "";
        const field = `${fieldName}.${depName}`;
        const pathPrefixMatch = /^(?:file:|link:)(.+)$/.exec(depValue);

        if (pathPrefixMatch) {
          const relativeValue = pathPrefixMatch[1] ?? "";
          const { escapesRoot, resolved } = joinUnderModuleRoot(location.moduleRoot, relativeValue);

          if (escapesRoot) {
            unresolved.push({
              field,
              line: null,
              raw_target: depValue,
              reason: "outside_project",
              source: location.manifestPath
            });
            continue;
          }

          const targetModuleId = rootToModuleId.get(resolved);

          if (!targetModuleId) {
            unresolved.push({
              field,
              line: null,
              raw_target: depValue,
              reason: "target_not_found",
              source: location.manifestPath
            });
            continue;
          }

          if (targetModuleId !== location.moduleId) {
            edges.push(
              makeManifestEdge(
                location.moduleId,
                targetModuleId,
                location.manifestPath,
                field,
                null,
                depValue,
                "package_json_local_path_dependency"
              )
            );
          }

          continue;
        }

        const registryEntry = packageRegistry.get(depName);

        if (registryEntry === "ambiguous") {
          unresolved.push({
            field,
            line: null,
            raw_target: depValue,
            reason: "ambiguous_local_package",
            source: location.manifestPath
          });
          continue;
        }

        if (typeof registryEntry === "string" && registryEntry !== location.moduleId) {
          edges.push(
            makeManifestEdge(
              location.moduleId,
              registryEntry,
              location.manifestPath,
              field,
              null,
              depValue,
              "package_json_local_dependency"
            )
          );
        }
      }
    }
  }

  return { edges, unresolved };
};

const analyzeComposerJsonReferences = (
  locations: ManifestLocation[],
  cache: Map<string, Record<string, unknown>>,
  packageRegistry: Map<string, PackageRegistryEntry>
): { edges: DependencyEdge[]; unresolved: UnresolvedReferenceEntry[] } => {
  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  for (const location of locations) {
    const json = cache.get(location.manifestPath);

    if (!json) {
      continue;
    }

    for (const fieldName of COMPOSER_DEPENDENCY_FIELDS) {
      const table = json[fieldName];

      if (typeof table !== "object" || table === null || Array.isArray(table)) {
        continue;
      }

      for (const depName of Object.keys(table)) {
        if (depName === "php" || depName.startsWith("ext-")) {
          continue;
        }

        const field = `${fieldName}.${depName}`;
        const registryEntry = packageRegistry.get(depName);

        if (registryEntry === "ambiguous") {
          unresolved.push({
            field,
            line: null,
            raw_target: depName,
            reason: "ambiguous_local_package",
            source: location.manifestPath
          });
          continue;
        }

        if (typeof registryEntry === "string" && registryEntry !== location.moduleId) {
          edges.push(
            makeManifestEdge(
              location.moduleId,
              registryEntry,
              location.manifestPath,
              field,
              null,
              depName,
              "composer_json_local_dependency"
            )
          );
        }
      }
    }
  }

  return { edges, unresolved };
};

type GoRequireEntry = { line: number; modulePath: string };

const extractGoRequireEntries = (
  content: string
): { entries: GoRequireEntry[]; hasReplace: boolean; replaceLine: number | null } => {
  const lineOffsets = buildLineIndex(content);
  const entries: GoRequireEntry[] = [];

  const blockPattern = new RegExp(GO_REQUIRE_BLOCK_PATTERN.source, "gm");
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(content))) {
    const blockContent = blockMatch[1] ?? "";
    const openParenIndex = blockMatch[0].indexOf("(\n");
    const blockContentStart = blockMatch.index + (openParenIndex === -1 ? 0 : openParenIndex + 2);
    const linePattern = new RegExp(GO_REQUIRE_BLOCK_LINE_PATTERN.source, "gm");
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = linePattern.exec(blockContent))) {
      const modulePath = lineMatch[1] ?? "";

      if (modulePath) {
        entries.push({
          line: lineNumberForOffset(lineOffsets, blockContentStart + lineMatch.index),
          modulePath
        });
      }
    }
  }

  const singlePattern = new RegExp(GO_REQUIRE_SINGLE_PATTERN.source, "gm");
  let singleMatch: RegExpExecArray | null;

  while ((singleMatch = singlePattern.exec(content))) {
    const modulePath = singleMatch[1] ?? "";

    if (modulePath) {
      entries.push({ line: lineNumberForOffset(lineOffsets, singleMatch.index), modulePath });
    }
  }

  const replaceMatch = GO_REPLACE_PATTERN.exec(content);

  return {
    entries,
    hasReplace: replaceMatch !== null,
    replaceLine: replaceMatch ? lineNumberForOffset(lineOffsets, replaceMatch.index) : null
  };
};

const analyzeGoModReferences = (
  locations: ManifestLocation[],
  cache: Map<string, string>,
  goRegistry: Map<string, GoRegistryValue>
): { edges: DependencyEdge[]; unresolved: UnresolvedReferenceEntry[] } => {
  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  for (const location of locations) {
    const content = cache.get(location.manifestPath);

    if (!content) {
      continue;
    }

    const { entries, hasReplace, replaceLine } = extractGoRequireEntries(content);

    if (hasReplace) {
      unresolved.push({
        field: null,
        line: replaceLine,
        raw_target: "replace",
        reason: "unsupported_reference_form",
        source: location.manifestPath
      });
    }

    for (const entry of entries) {
      const registryEntry = goRegistry.get(entry.modulePath);

      if (registryEntry === "ambiguous") {
        unresolved.push({
          field: null,
          line: entry.line,
          raw_target: entry.modulePath,
          reason: "ambiguous_local_module",
          source: location.manifestPath
        });
        continue;
      }

      if (registryEntry && registryEntry.moduleId !== location.moduleId) {
        edges.push(
          makeManifestEdge(
            location.moduleId,
            registryEntry.moduleId,
            location.manifestPath,
            null,
            entry.line,
            entry.modulePath,
            "go_mod_local_dependency"
          )
        );
      }
    }
  }

  return { edges, unresolved };
};

const analyzeCargoTomlReferences = (
  locations: ManifestLocation[],
  cache: Map<string, Record<string, unknown>>,
  pathToModuleId: Map<string, string>,
  classifiedPaths: Set<string>
): { edges: DependencyEdge[]; unresolved: UnresolvedReferenceEntry[] } => {
  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  for (const location of locations) {
    const parsed = cache.get(location.manifestPath);

    if (!parsed) {
      continue;
    }

    for (const fieldName of CARGO_DEPENDENCY_FIELDS) {
      const table = parsed[fieldName];

      if (typeof table !== "object" || table === null || Array.isArray(table)) {
        continue;
      }

      for (const [depName, depValue] of Object.entries(table as Record<string, unknown>)) {
        if (typeof depValue !== "object" || depValue === null || Array.isArray(depValue)) {
          continue;
        }

        const pathValue = (depValue as Record<string, unknown>).path;

        if (typeof pathValue !== "string" || !pathValue.trim()) {
          continue;
        }

        const field = `${fieldName}.${depName}.path`;
        const { escapesRoot, resolved } = joinUnderModuleRoot(location.moduleRoot, pathValue);

        if (escapesRoot) {
          unresolved.push({
            field,
            line: null,
            raw_target: pathValue,
            reason: "outside_project",
            source: location.manifestPath
          });
          continue;
        }

        const targetCargoToml = resolved === "." ? "Cargo.toml" : `${resolved}/Cargo.toml`;
        const targetModuleId = classifiedPaths.has(targetCargoToml)
          ? pathToModuleId.get(targetCargoToml)
          : undefined;

        if (!targetModuleId) {
          unresolved.push({
            field,
            line: null,
            raw_target: pathValue,
            reason: "target_not_found",
            source: location.manifestPath
          });
          continue;
        }

        if (targetModuleId !== location.moduleId) {
          edges.push(
            makeManifestEdge(
              location.moduleId,
              targetModuleId,
              location.manifestPath,
              field,
              null,
              pathValue,
              "cargo_toml_local_path_dependency"
            )
          );
        }
      }
    }
  }

  return { edges, unresolved };
};

const analyzeMsBuildReferences = (
  locations: ManifestLocation[],
  cache: Map<string, string>,
  pathToModuleId: Map<string, string>,
  classifiedPaths: Set<string>
): { edges: DependencyEdge[]; unresolved: UnresolvedReferenceEntry[] } => {
  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  for (const location of locations) {
    const content = cache.get(location.manifestPath);

    if (!content) {
      continue;
    }

    const lineOffsets = buildLineIndex(content);
    const pattern = new RegExp(MSBUILD_PROJECT_REFERENCE_PATTERN.source, "g");
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content))) {
      const includeRaw = (match[1] ?? "").replace(/\\/g, "/");
      const line = lineNumberForOffset(lineOffsets, match.index);
      const { escapesRoot, resolved } = joinUnderModuleRoot(location.moduleRoot, includeRaw);

      if (escapesRoot) {
        unresolved.push({
          field: null,
          line,
          raw_target: includeRaw,
          reason: "outside_project",
          source: location.manifestPath
        });
        continue;
      }

      const targetModuleId = classifiedPaths.has(resolved) ? pathToModuleId.get(resolved) : undefined;

      if (!targetModuleId) {
        unresolved.push({
          field: null,
          line,
          raw_target: includeRaw,
          reason: "target_not_found",
          source: location.manifestPath
        });
        continue;
      }

      if (targetModuleId !== location.moduleId) {
        edges.push(
          makeManifestEdge(
            location.moduleId,
            targetModuleId,
            location.manifestPath,
            null,
            line,
            includeRaw,
            "msbuild_project_reference"
          )
        );
      }
    }
  }

  return { edges, unresolved };
};

// --- JavaScript / TypeScript source references --------------------------------

type JsTsExtraction = {
  dynamicReferences: Array<{ line: number; rawTarget: string }>;
  parseError: boolean;
  references: Array<{ line: number; rawTarget: string }>;
};

const extractJsTsReferences = (
  filePath: string,
  sourceText: string,
  format: NonNullable<FileFormat>
): JsTsExtraction => {
  const scriptKind = JS_TS_SCRIPT_KIND[format] ?? ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const parseDiagnostics = (sourceFile as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics;
  const parseError = Array.isArray(parseDiagnostics) && parseDiagnostics.length > 0;

  const references: Array<{ line: number; rawTarget: string }> = [];
  const dynamicReferences: Array<{ line: number; rawTarget: string }> = [];
  const lineOf = (pos: number): number => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      references.push({
        line: lineOf(node.moduleSpecifier.getStart(sourceFile)),
        rawTarget: node.moduleSpecifier.text
      });
    } else if (ts.isCallExpression(node)) {
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImportCall = node.expression.kind === ts.SyntaxKind.ImportKeyword;

      if (isRequireCall || isDynamicImportCall) {
        const [firstArg] = node.arguments;

        if (firstArg && ts.isStringLiteralLike(firstArg)) {
          references.push({ line: lineOf(firstArg.getStart(sourceFile)), rawTarget: firstArg.text });
        } else {
          dynamicReferences.push({
            line: lineOf(node.getStart(sourceFile)),
            rawTarget: node.getText(sourceFile).trim()
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { dynamicReferences, parseError, references };
};

type RelativeResolution =
  | { kind: "ambiguous" }
  | { kind: "not_found" }
  | { kind: "resolved"; path: string };

const hasExplicitJsExtension = (target: string): boolean =>
  JS_TS_EXTENSIONS.some((extension) => target.endsWith(extension));

const resolveDirectFileCandidates = (base: string, classifiedPaths: Set<string>): RelativeResolution => {
  const candidates = JS_TS_EXTENSIONS.map((extension) => `${base}${extension}`).filter((candidate) =>
    classifiedPaths.has(candidate)
  );

  if (candidates.length === 1) {
    return { kind: "resolved", path: candidates[0] as string };
  }

  return candidates.length === 0 ? { kind: "not_found" } : { kind: "ambiguous" };
};

const resolveIndexFallback = (base: string, classifiedPaths: Set<string>): RelativeResolution => {
  const candidates = JS_TS_EXTENSIONS.map((extension) => `${base}/index${extension}`).filter(
    (candidate) => classifiedPaths.has(candidate)
  );

  if (candidates.length === 1) {
    return { kind: "resolved", path: candidates[0] as string };
  }

  return candidates.length === 0 ? { kind: "not_found" } : { kind: "ambiguous" };
};

const resolveJsTsRelativeTarget = async (
  projectRootPath: string,
  normalizedTarget: string,
  classifiedPaths: Set<string>
): Promise<RelativeResolution> => {
  if (hasExplicitJsExtension(normalizedTarget)) {
    return classifiedPaths.has(normalizedTarget)
      ? { kind: "resolved", path: normalizedTarget }
      : { kind: "not_found" };
  }

  const directResolution = resolveDirectFileCandidates(normalizedTarget, classifiedPaths);

  if (directResolution.kind !== "not_found") {
    return directResolution;
  }

  const packageJsonPath = `${normalizedTarget}/package.json`;

  if (classifiedPaths.has(packageJsonPath)) {
    let mainValue: string | null = null;

    try {
      const json = await readJsonFile<Record<string, unknown>>(
        path.join(projectRootPath, packageJsonPath)
      );
      mainValue = typeof json.main === "string" && json.main.trim() ? json.main.trim() : null;
    } catch {
      mainValue = null;
    }

    if (mainValue) {
      const { resolvedPath: mainTarget } = resolveRelativeTarget(packageJsonPath, mainValue);
      const mainResolution = hasExplicitJsExtension(mainTarget)
        ? classifiedPaths.has(mainTarget)
          ? ({ kind: "resolved", path: mainTarget } as RelativeResolution)
          : ({ kind: "not_found" } as RelativeResolution)
        : resolveDirectFileCandidates(mainTarget, classifiedPaths);

      if (mainResolution.kind !== "not_found") {
        return mainResolution;
      }
    }
  }

  return resolveIndexFallback(normalizedTarget, classifiedPaths);
};

const extractJsPackageKey = (specifier: string): string => {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");

    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  return specifier.split("/")[0] ?? specifier;
};

const resolveJsTsSpecifier = async (
  projectRootPath: string,
  sourcePath: string,
  rawTarget: string,
  format: NonNullable<FileFormat>,
  classifiedPaths: Set<string>,
  packageRegistry: Map<string, PackageRegistryEntry>
): Promise<{ resolution: Resolution; resolver: string }> => {
  if (rawTarget.startsWith("./") || rawTarget.startsWith("../")) {
    const resolver = `${format}_relative`;

    if (/[?#]/.test(rawTarget)) {
      return { resolution: { kind: "unresolved", reason: "unsupported_reference_form" }, resolver };
    }

    const { escapesRoot, resolvedPath } = resolveRelativeTarget(sourcePath, rawTarget);

    if (escapesRoot) {
      return { resolution: { kind: "unresolved", reason: "outside_project" }, resolver };
    }

    const relativeResolution = await resolveJsTsRelativeTarget(
      projectRootPath,
      resolvedPath,
      classifiedPaths
    );

    if (relativeResolution.kind === "resolved") {
      return { resolution: { kind: "path", path: relativeResolution.path }, resolver };
    }

    return {
      resolution: {
        kind: "unresolved",
        reason: relativeResolution.kind === "ambiguous" ? "ambiguous_target" : "target_not_found"
      },
      resolver
    };
  }

  const resolver = `${format}_local_package`;
  const packageKey = extractJsPackageKey(rawTarget);
  const registryEntry = packageRegistry.get(packageKey);

  if (registryEntry === "ambiguous") {
    return { resolution: { kind: "unresolved", reason: "ambiguous_local_package" }, resolver };
  }

  if (typeof registryEntry === "string") {
    return { resolution: { kind: "module", moduleId: registryEntry }, resolver };
  }

  if (rawTarget.startsWith("@/") || rawTarget.startsWith("~/") || rawTarget === "~" || rawTarget.startsWith("#")) {
    return { resolution: { kind: "unresolved", reason: "unsupported_alias" }, resolver };
  }

  return { resolution: { kind: "external" }, resolver };
};

// --- Python source references --------------------------------------------------

type PythonReferenceEntry =
  | { dots: number; kind: "module"; line: number; tail: string }
  | { dots: number; kind: "names"; line: number; names: string[] };

const extractPythonReferences = (sourceText: string): PythonReferenceEntry[] => {
  const masked = maskNoise(sourceText, {
    lineCommentPrefixes: ["#"],
    quoteChars: ['"', "'"],
    tripleQuotes: ['"""', "'''"]
  });
  const lineOffsets = buildLineIndex(masked);
  const pattern = new RegExp(PYTHON_FROM_IMPORT_PATTERN.source, "gm");
  const results: PythonReferenceEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked))) {
    const dots = (match[1] ?? "").length;
    const tail = match[2] ?? "";
    const namesRaw = match[3] ?? "";
    const line = lineNumberForOffset(lineOffsets, match.index);

    if (tail) {
      results.push({ dots, kind: "module", line, tail });
      continue;
    }

    const names = namesRaw
      .split(",")
      .map((part) => part.trim().split(/[ \t]+as[ \t]+/)[0]?.trim() ?? "")
      .filter((name) => /^[A-Za-z_]\w*$/.test(name));

    results.push({ dots, kind: "names", line, names });
  }

  return results;
};

const resolvePythonReference = (
  sourcePath: string,
  entry: PythonReferenceEntry,
  classifiedPaths: Set<string>
): Array<{ rawTarget: string; resolution: Resolution }> => {
  const ascendCount = entry.dots - 1;
  const sourceDir = path.posix.dirname(sourcePath);
  const ascended = ascendPosixPath(sourceDir, ascendCount);

  if (ascended.escapesRoot) {
    const rawTarget = entry.kind === "module" ? entry.tail : entry.names.join(", ");
    return [{ rawTarget, resolution: { kind: "unresolved", reason: "outside_project" } }];
  }

  const base = ascended.path;
  const prefix = base === "." ? "" : `${base}/`;

  if (entry.kind === "module") {
    const tailPath = entry.tail.replace(/\./g, "/");
    const candidates = [`${prefix}${tailPath}.py`, `${prefix}${tailPath}/__init__.py`].map((candidate) =>
      path.posix.normalize(candidate)
    );
    const existing = candidates.filter((candidate) => classifiedPaths.has(candidate));

    if (existing.length === 1) {
      return [{ rawTarget: entry.tail, resolution: { kind: "path", path: existing[0] as string } }];
    }

    return [
      {
        rawTarget: entry.tail,
        resolution: {
          kind: "unresolved",
          reason: existing.length === 0 ? "target_not_found" : "ambiguous_target"
        }
      }
    ];
  }

  return entry.names.map((name) => {
    const candidates = [`${prefix}${name}.py`, `${prefix}${name}/__init__.py`].map((candidate) =>
      path.posix.normalize(candidate)
    );
    const existing = candidates.filter((candidate) => classifiedPaths.has(candidate));

    if (existing.length === 1) {
      return { rawTarget: name, resolution: { kind: "path", path: existing[0] as string } };
    }

    return {
      rawTarget: name,
      resolution: { kind: "unresolved", reason: "unsupported_reference_form" }
    };
  });
};

// --- PHP source references ------------------------------------------------------

const parseSinglePhpUseSegment = (segment: string): { alias: string | null; namespace: string } => {
  const asMatch = /^(.*?)[ \t]+as[ \t]+([A-Za-z_]\w*)$/.exec(segment.trim());

  if (asMatch) {
    return { alias: asMatch[2] ?? null, namespace: (asMatch[1] ?? "").trim().replace(/^\\/, "") };
  }

  return { alias: null, namespace: segment.trim().replace(/^\\/, "") };
};

const parsePhpUseStatement = (body: string): Array<{ alias: string | null; namespace: string }> => {
  const groupMatch = /^(.*)\\\{([^}]*)\}$/.exec(body.trim());

  if (groupMatch) {
    const prefix = groupMatch[1]?.trim() ?? "";
    const members = (groupMatch[2] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    return members.map((member) => parseSinglePhpUseSegment(`${prefix}\\${member}`));
  }

  return body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parseSinglePhpUseSegment(part));
};

const extractPhpReferences = (
  sourceText: string
): Array<{ line: number; namespace: string; rawTarget: string }> => {
  const masked = maskNoise(sourceText, {
    blockComment: ["/*", "*/"],
    lineCommentPrefixes: ["//", "#"],
    quoteChars: ['"', "'"]
  });
  const lineOffsets = buildLineIndex(masked);
  const references: Array<{ line: number; namespace: string; rawTarget: string }> = [];
  const pattern = new RegExp(PHP_USE_PATTERN.source, "gm");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked))) {
    const body = (match[1] ?? "").trim();

    if (/^function\b/.test(body) || /^const\b/.test(body)) {
      continue;
    }

    const line = lineNumberForOffset(lineOffsets, match.index);

    for (const segment of parsePhpUseStatement(body)) {
      if (segment.namespace) {
        references.push({ line, namespace: segment.namespace, rawTarget: segment.namespace });
      }
    }
  }

  return references;
};

const resolvePsr4Namespace = (
  namespace: string,
  registry: Psr4Registry,
  classifiedPaths: Set<string>
): Resolution => {
  const matchingPrefixes = [...registry.keys()].filter((prefix) => namespace.startsWith(prefix));

  if (matchingPrefixes.length === 0) {
    return { kind: "external" };
  }

  const longestPrefix = matchingPrefixes.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best
  );
  const byModule = registry.get(longestPrefix);

  if (!byModule || byModule.size === 0) {
    return { kind: "external" };
  }

  if (byModule.size > 1) {
    return { kind: "unresolved", reason: "ambiguous_local_namespace" };
  }

  const entry = [...byModule.values()][0] as Psr4Entry;
  const remainder = namespace.slice(longestPrefix.length).replace(/\\+/g, "/");
  const candidates = [...entry.baseDirs].map((baseDir) =>
    path.posix.normalize(remainder ? `${baseDir}/${remainder}.php` : `${baseDir}.php`)
  );
  const existing = candidates.filter((candidate) => classifiedPaths.has(candidate));

  if (existing.length === 1) {
    return { kind: "module", moduleId: entry.moduleId };
  }

  return { kind: "unresolved", reason: existing.length === 0 ? "target_not_found" : "ambiguous_target" };
};

// --- Go source references -------------------------------------------------------

const extractGoReferences = (sourceText: string): Array<{ line: number; rawTarget: string }> => {
  const lineOffsets = buildLineIndex(sourceText);
  const references: Array<{ line: number; rawTarget: string }> = [];

  const blockPattern = new RegExp(GO_IMPORT_BLOCK_PATTERN.source, "gm");
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(sourceText))) {
    const blockContent = blockMatch[1] ?? "";
    const openParenIndex = blockMatch[0].indexOf("(\n");
    const blockContentStart = blockMatch.index + (openParenIndex === -1 ? 0 : openParenIndex + 2);
    const linePattern = new RegExp(GO_IMPORT_BLOCK_LINE_PATTERN.source, "gm");
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = linePattern.exec(blockContent))) {
      references.push({
        line: lineNumberForOffset(lineOffsets, blockContentStart + lineMatch.index),
        rawTarget: lineMatch[1] ?? ""
      });
    }
  }

  const singlePattern = new RegExp(GO_IMPORT_SINGLE_PATTERN.source, "gm");
  let singleMatch: RegExpExecArray | null;

  while ((singleMatch = singlePattern.exec(sourceText))) {
    references.push({
      line: lineNumberForOffset(lineOffsets, singleMatch.index),
      rawTarget: singleMatch[1] ?? ""
    });
  }

  return references;
};

const resolveGoImport = (
  importPath: string,
  goRegistry: Map<string, GoRegistryValue>,
  classifiedByPath: Map<string, ClassifiedFile>
): Resolution => {
  const matchingModulePaths = [...goRegistry.keys()].filter(
    (modulePath) => importPath === modulePath || importPath.startsWith(`${modulePath}/`)
  );

  if (matchingModulePaths.length === 0) {
    return { kind: "external" };
  }

  const longest = matchingModulePaths.reduce((best, candidate) =>
    candidate.length > best.length ? candidate : best
  );
  const entry = goRegistry.get(longest);

  if (entry === "ambiguous") {
    return { kind: "unresolved", reason: "ambiguous_local_module" };
  }

  if (!entry) {
    return { kind: "external" };
  }

  const suffix = importPath === longest ? "" : importPath.slice(longest.length + 1);
  const targetDir = path.posix.normalize(
    suffix ? `${entry.moduleRoot === "." ? "" : `${entry.moduleRoot}/`}${suffix}` : entry.moduleRoot
  );
  const hasDirectGoSource = [...classifiedByPath.entries()].some(
    ([filePath, file]) =>
      path.posix.dirname(filePath) === targetDir && file.kind === "source" && file.format === "go"
  );

  if (!hasDirectGoSource) {
    return { kind: "unresolved", reason: "target_not_found" };
  }

  return { kind: "module", moduleId: entry.moduleId };
};

// --- Orchestration ----------------------------------------------------------

export const runMapModuleDependenciesJob = async (
  projectRootPath: string
): Promise<MapModuleDependenciesResult> => {
  const reportsDir = discoveryReportsDir(projectRootPath);

  let classified: ClassifiedFilesDocument;

  try {
    classified = JSON.parse(
      await readFile(path.join(reportsDir, "CLASSIFIED_FILES.json"), "utf8")
    ) as ClassifiedFilesDocument;
  } catch (error) {
    throw new Error(`Unable to read CLASSIFIED_FILES.json: ${(error as Error).message}`);
  }

  let base: ModuleMapBaseDocument;

  try {
    base = JSON.parse(
      await readFile(path.join(reportsDir, "MODULE_MAP_BASE.json"), "utf8")
    ) as ModuleMapBaseDocument;
  } catch (error) {
    throw new Error(`Unable to read MODULE_MAP_BASE.json: ${(error as Error).message}`);
  }

  if (!Array.isArray(classified.files) || !Array.isArray(base.modules)) {
    throw new Error("Invalid structured input for map_module_dependencies.");
  }

  const pathToModuleId = new Map<string, string>();
  const moduleIds = new Set<string>();

  for (const module of base.modules) {
    if (moduleIds.has(module.id)) {
      throw new Error(`Duplicate module id: ${module.id}`);
    }

    moduleIds.add(module.id);

    for (const filePath of module.paths) {
      if (pathToModuleId.has(filePath)) {
        throw new Error(`Duplicate path ownership: ${filePath}`);
      }

      pathToModuleId.set(filePath, module.id);
    }
  }

  const classifiedByPath = new Map(classified.files.map((file) => [file.path, file]));

  if (classifiedByPath.size !== classified.files.length) {
    throw new Error("Duplicate classified path detected.");
  }

  const classifiedPaths = new Set(classifiedByPath.keys());
  const basePaths = new Set(pathToModuleId.keys());

  if (
    classifiedPaths.size !== basePaths.size ||
    [...classifiedPaths].some((filePath) => !basePaths.has(filePath))
  ) {
    throw new Error("CLASSIFIED_FILES.json and MODULE_MAP_BASE.json path sets do not match.");
  }

  const rootToModuleId = new Map(base.modules.map((module) => [module.root, module.id]));
  const unparsedManifestPaths = new Set<string>();

  const packageJsonLocations = locateModuleRootManifests(base.modules, "package.json");
  const packageJsonCache = await readJsonManifestCache(
    projectRootPath,
    packageJsonLocations,
    unparsedManifestPaths
  );
  const jsPackageRegistry = buildNameRegistry(packageJsonLocations, packageJsonCache);

  const composerJsonLocations = locateModuleRootManifests(base.modules, "composer.json");
  const composerJsonCache = await readJsonManifestCache(
    projectRootPath,
    composerJsonLocations,
    unparsedManifestPaths
  );
  const composerPackageRegistry = buildNameRegistry(composerJsonLocations, composerJsonCache);
  const psr4Registry = buildPsr4Registry(composerJsonLocations, composerJsonCache);

  const goModLocations = locateModuleRootManifests(base.modules, "go.mod");
  const goModCache = await readRawManifestCache(
    projectRootPath,
    goModLocations,
    unparsedManifestPaths,
    (content) => extractGoModuleDirective(content) !== null
  );
  const goModuleRegistry = buildGoModuleRegistry(goModLocations, goModCache);

  const cargoTomlLocations = locateModuleRootManifests(base.modules, "Cargo.toml");
  const cargoTomlCache = await readTomlManifestCache(
    projectRootPath,
    cargoTomlLocations,
    unparsedManifestPaths
  );

  const projectFileLocations = locateModuleRootProjectFiles(base.modules);
  const projectFileCache = await readXmlManifestCache(
    projectRootPath,
    projectFileLocations,
    unparsedManifestPaths
  );

  const analyzedManifestPaths = new Set<string>([
    ...packageJsonCache.keys(),
    ...composerJsonCache.keys(),
    ...goModCache.keys(),
    ...cargoTomlCache.keys(),
    ...projectFileCache.keys()
  ]);

  const unsupportedManifestFiles: UnsupportedManifestFile[] = [];

  for (const module of base.modules) {
    for (const unsupportedName of MODULE_DEFINING_UNSUPPORTED_MANIFEST_NAMES) {
      const manifestPath = manifestAtModuleRoot(module, unsupportedName);

      if (manifestPath) {
        unsupportedManifestFiles.push({ path: manifestPath, reason: "unsupported_manifest_reference" });
      }
    }
  }

  const edges: DependencyEdge[] = [];
  const unresolved: UnresolvedReferenceEntry[] = [];

  const manifestAnalyses = [
    analyzePackageJsonReferences(packageJsonLocations, packageJsonCache, jsPackageRegistry, rootToModuleId),
    analyzeComposerJsonReferences(composerJsonLocations, composerJsonCache, composerPackageRegistry),
    analyzeGoModReferences(goModLocations, goModCache, goModuleRegistry),
    analyzeCargoTomlReferences(cargoTomlLocations, cargoTomlCache, pathToModuleId, classifiedPaths),
    analyzeMsBuildReferences(projectFileLocations, projectFileCache, pathToModuleId, classifiedPaths)
  ];

  for (const analysis of manifestAnalyses) {
    edges.push(...analysis.edges);
    unresolved.push(...analysis.unresolved);
  }

  const unsupportedSourceFiles: UnsupportedSourceFile[] = [];
  const unparsedSourceFiles: UnparsedSourceFile[] = [];
  const analyzedSourceFiles: string[] = [];

  for (const file of classified.files) {
    if (file.kind !== "source") {
      continue;
    }

    if (!file.format || !SUPPORTED_SOURCE_FORMATS.has(file.format)) {
      unsupportedSourceFiles.push({ format: file.format, path: file.path, reason: "unsupported_format" });
      continue;
    }

    const sourceModuleId = pathToModuleId.get(file.path);

    if (!sourceModuleId) {
      continue;
    }

    let sourceText: string;

    try {
      sourceText = normalizeCanonicalText(await readFile(path.join(projectRootPath, file.path), "utf8"));
    } catch (error) {
      throw new Error(`Unable to read source file for ${file.path}: ${(error as Error).message}`);
    }

    if (
      file.format === "javascript" ||
      file.format === "jsx" ||
      file.format === "typescript" ||
      file.format === "tsx"
    ) {
      const extraction = extractJsTsReferences(file.path, sourceText, file.format);

      if (extraction.parseError) {
        unparsedSourceFiles.push({ format: file.format, path: file.path, reason: "parse_error" });
        continue;
      }

      analyzedSourceFiles.push(file.path);

      for (const dynamicRef of extraction.dynamicReferences) {
        unresolved.push({
          field: null,
          line: dynamicRef.line,
          raw_target: dynamicRef.rawTarget,
          reason: "dynamic_reference",
          source: file.path
        });
      }

      for (const ref of extraction.references) {
        const resolved = await resolveJsTsSpecifier(
          projectRootPath,
          file.path,
          ref.rawTarget,
          file.format,
          classifiedPaths,
          jsPackageRegistry
        );
        applyResolution(
          sourceModuleId,
          resolved.resolution,
          {
            field: null,
            kind: "source_reference",
            line: ref.line,
            rawTarget: ref.rawTarget,
            resolver: resolved.resolver,
            source: file.path
          },
          pathToModuleId,
          edges,
          unresolved
        );
      }

      continue;
    }

    if (file.format === "python") {
      analyzedSourceFiles.push(file.path);

      for (const entry of extractPythonReferences(sourceText)) {
        for (const { rawTarget, resolution } of resolvePythonReference(file.path, entry, classifiedPaths)) {
          applyResolution(
            sourceModuleId,
            resolution,
            {
              field: null,
              kind: "source_reference",
              line: entry.line,
              rawTarget,
              resolver: "python_relative",
              source: file.path
            },
            pathToModuleId,
            edges,
            unresolved
          );
        }
      }

      continue;
    }

    if (file.format === "php") {
      analyzedSourceFiles.push(file.path);

      for (const ref of extractPhpReferences(sourceText)) {
        const resolution = resolvePsr4Namespace(ref.namespace, psr4Registry, classifiedPaths);
        applyResolution(
          sourceModuleId,
          resolution,
          {
            field: null,
            kind: "source_reference",
            line: ref.line,
            rawTarget: ref.rawTarget,
            resolver: "php_psr4_local_namespace",
            source: file.path
          },
          pathToModuleId,
          edges,
          unresolved
        );
      }

      continue;
    }

    if (file.format === "go") {
      analyzedSourceFiles.push(file.path);

      for (const ref of extractGoReferences(sourceText)) {
        const resolution = resolveGoImport(ref.rawTarget, goModuleRegistry, classifiedByPath);
        applyResolution(
          sourceModuleId,
          resolution,
          {
            field: null,
            kind: "source_reference",
            line: ref.line,
            rawTarget: ref.rawTarget,
            resolver: "go_local_module",
            source: file.path
          },
          pathToModuleId,
          edges,
          unresolved
        );
      }
    }
  }

  const dedupedEdgesMap = new Map<string, DependencyEdge>();

  for (const edge of edges) {
    dedupedEdgesMap.set(JSON.stringify(edge), edge);
  }

  const dedupedEdges = [...dedupedEdgesMap.values()];

  dedupedEdges.sort((left, right) => {
    if (left.source_module !== right.source_module) {
      return left.source_module < right.source_module ? -1 : 1;
    }

    if (left.target_module !== right.target_module) {
      return left.target_module < right.target_module ? -1 : 1;
    }

    if (left.evidence.source !== right.evidence.source) {
      return left.evidence.source < right.evidence.source ? -1 : 1;
    }

    const lineDiff = compareNullableLast(left.evidence.line, right.evidence.line);

    if (lineDiff !== 0) {
      return lineDiff;
    }

    const fieldDiff = compareNullableLast(left.evidence.field, right.evidence.field);

    if (fieldDiff !== 0) {
      return fieldDiff;
    }

    return left.evidence.raw_target < right.evidence.raw_target
      ? -1
      : left.evidence.raw_target > right.evidence.raw_target
        ? 1
        : 0;
  });

  const dependsOnByModule = new Map<string, Set<string>>();

  for (const edge of dedupedEdges) {
    const set = dependsOnByModule.get(edge.source_module) ?? new Set<string>();
    set.add(edge.target_module);
    dependsOnByModule.set(edge.source_module, set);
  }

  unresolved.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source < right.source ? -1 : 1;
    }

    const lineDiff = compareNullableLast(left.line, right.line);

    if (lineDiff !== 0) {
      return lineDiff;
    }

    const fieldDiff = compareNullableLast(left.field, right.field);

    if (fieldDiff !== 0) {
      return fieldDiff;
    }

    if (left.raw_target !== right.raw_target) {
      return left.raw_target < right.raw_target ? -1 : 1;
    }

    return left.reason < right.reason ? -1 : left.reason > right.reason ? 1 : 0;
  });

  const unparsedManifestFiles: UnparsedManifestFile[] = [...unparsedManifestPaths]
    .sort()
    .map((filePath) => ({ path: filePath, reason: "parse_error" }));

  await mkdir(contextDir(projectRootPath), { recursive: true });

  await writeJson(path.join(contextDir(projectRootPath), "MODULE_MAP.json"), {
    analysis_coverage: {
      analyzed_manifest_files: [...analyzedManifestPaths].sort(),
      analyzed_source_files: [...analyzedSourceFiles].sort(),
      unparsed_manifest_files: unparsedManifestFiles,
      unparsed_source_files: [...unparsedSourceFiles].sort(byPath),
      unresolved_references: unresolved,
      unsupported_manifest_files: [...unsupportedManifestFiles].sort(byPath),
      unsupported_source_files: [...unsupportedSourceFiles].sort(byPath)
    },
    dependency_edges: dedupedEdges,
    metadata: buildMetadata(),
    modules: base.modules.map((module) => ({
      depends_on: [...(dependsOnByModule.get(module.id) ?? new Set<string>())].sort(),
      description: module.description,
      description_evidence: module.description_evidence,
      id: module.id,
      name: module.name,
      paths: module.paths,
      root: module.root,
      summary: module.summary
    }))
  });

  return {
    edge_count: dedupedEdges.length,
    module_count: base.modules.length,
    unresolved_count: unresolved.length
  };
};
