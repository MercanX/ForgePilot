import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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
