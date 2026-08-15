import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  collectManifestEntries,
  ignoredByProject,
  isDirectory,
  isFile,
  readGitignorePatterns,
  runGit,
  sha256,
  writeCsvManifest
} from "../shared/fsUtils";

export type StartupJobResult = {
  check_factory: {
    created: boolean;
    path: string;
  };
  read_config: {
    locale: string;
    mode: string;
    version: string;
  };
};

export type SelectRunResult = {
  decision: "already_sealed" | "continue" | "new";
  run_id: string;
};

export type PlaceInputsResult = {
  baseline: "missing" | "placed";
  run_id: string;
  scope: "missing" | "placed";
  status: "ready" | "waiting_for_input";
};

export type CaptureGitStateResult = {
  has_git: boolean;
  run_id: string;
};

export type ManifestResult = {
  file_count: number;
  run_id: string;
};

export type SealRunResult = {
  decision: "FAIL" | "PASS";
  missing: string[];
  pre_run_manifest_sha256: string;
  run_id: string;
};

const TEMPLATE_MARKER =
  "<!-- STARTUP_REVIEW_REQUIRED: Bu dosyayi kontrol edin, gerekli degisiklikleri yaptiktan sonra onaylamak icin bu satiri silin. -->";
const CONFIG_FILE = "factory.config.yaml";
const FACTORY_DIR = ".ai-factory";
const RUN_ID_PATTERN = /^.+-\d{8}-\d{3}$/;
const RUNS_DIR = ".ai-factory-runs";
const RUN_SEAL_FILE = "RUN_SEAL.json";
const NO_GIT_REPOSITORY = "NO GIT REPOSITORY\n";
const SOURCE_EXCLUDE = new Set([
  ".ai-factory",
  ".ai-factory-runs",
  ".claude",
  ".git",
  "node_modules",
  "vendor"
]);
const FACTORY_TOP_LEVEL_EXCLUDE = new Set([
  "artifacts",
  "cache",
  "context",
  "logs",
  "memory",
  "reports",
  "state"
]);
const SEALED_FILES = [
  "SCOPE.md",
  "BASELINE.md",
  "git-head.txt",
  "git-status.txt",
  "working-tree.patch",
  "SOURCE_MANIFEST.csv",
  "FACTORY_MANIFEST.csv"
];
const SUPPORTED_LOCALES = new Set(["tr-TR", "en-US", "de-DE"]);
const DEFAULT_CONFIG = [
  "version: unknown",
  "factory:",
  "  mode: unknown",
  "  locale: tr-TR",
  ""
].join("\n");
const BASELINE_TEMPLATE = [
  TEMPLATE_MARKER,
  "",
  "# BASELINE",
  "",
  "## Known Gaps",
  "",
  "-",
  "",
  "## Known Technical Debt",
  "",
  "-",
  "",
  "## Unfinished Work",
  "",
  "-",
  ""
].join("\n");

const readField = (content: string, pattern: RegExp, fallback: string): string => {
  const match = content.match(pattern);
  const value = match?.[1]?.trim();

  return value ? value : fallback;
};

const parseFactoryConfig = (content: string): StartupJobResult["read_config"] => {
  const locale = readField(content, /^\s*locale:\s*(.+?)\s*$/m, "tr-TR");

  return {
    locale: SUPPORTED_LOCALES.has(locale) ? locale : "tr-TR",
    mode: readField(content, /^\s+mode:\s*(.+?)\s*$/m, "unknown"),
    version: readField(content, /^version:\s*(.+?)\s*$/m, "unknown")
  };
};

export const runStartupJob = async (projectRootPath: string): Promise<StartupJobResult> => {
  const factoryPath = path.join(projectRootPath, FACTORY_DIR);
  let created = false;

  try {
    await mkdir(factoryPath);
    created = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "EEXIST") {
      throw error;
    }
  }

  const configPath = path.join(factoryPath, CONFIG_FILE);
  let configContent: string;

  try {
    configContent = await readFile(configPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }

    await writeFile(configPath, DEFAULT_CONFIG, "utf8");
    configContent = DEFAULT_CONFIG;
  }

  return {
    check_factory: {
      created,
      path: factoryPath
    },
    read_config: parseFactoryConfig(configContent)
  };
};

const listRunIds = async (runsPath: string): Promise<string[]> => {
  const entries = await readdir(runsPath, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const readSealDecision = async (runPath: string): Promise<string | null> => {
  try {
    const seal = JSON.parse(await readFile(path.join(runPath, RUN_SEAL_FILE), "utf8")) as unknown;

    if (typeof seal === "object" && seal !== null && "decision" in seal) {
      const decision = (seal as { decision?: unknown }).decision;

      return typeof decision === "string" ? decision : null;
    }
  } catch {
    return null;
  }

  return null;
};

const createNextRunId = async (projectRootPath: string, runsPath: string): Promise<string> => {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = `${path.basename(projectRootPath)}-${stamp}-`;
  const used = new Set((await isDirectory(runsPath)) ? await readdir(runsPath) : []);
  let sequence = 1;

  while (used.has(`${prefix}${String(sequence).padStart(3, "0")}`)) {
    sequence += 1;
  }

  return `${prefix}${String(sequence).padStart(3, "0")}`;
};

export const runSelectRunJob = async (
  projectRootPath: string,
  newRun = false
): Promise<SelectRunResult> => {
  const runsPath = path.join(projectRootPath, RUNS_DIR);
  await mkdir(runsPath, { recursive: true });

  const gitignorePath = path.join(runsPath, ".gitignore");
  try {
    const gitignoreContent = await readFile(gitignorePath, "utf8");

    if (gitignoreContent !== "*\n") {
      await writeFile(gitignorePath, "*\n", "utf8");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== "ENOENT") {
      throw error;
    }

    await writeFile(gitignorePath, "*\n", "utf8");
  }

  const runs = await listRunIds(runsPath);
  const latest = runs.at(-1) ?? null;

  if (!latest || newRun) {
    const runId = await createNextRunId(projectRootPath, runsPath);
    await mkdir(path.join(runsPath, runId));

    return {
      decision: "new",
      run_id: runId
    };
  }

  const sealDecision = await readSealDecision(path.join(runsPath, latest));

  if (sealDecision === "PASS") {
    return {
      decision: "already_sealed",
      run_id: latest
    };
  }

  return {
    decision: "continue",
    run_id: latest
  };
};

const bulletList = (values: string[]): string =>
  values.length > 0 ? values.map((value) => `- \`${value}\``).join("\n") : "-";

const createScopeTemplate = async (projectRootPath: string): Promise<string> => {
  const ignoredPatterns = await readGitignorePatterns(projectRootPath);
  const entries = await readdir(projectRootPath, { withFileTypes: true });
  const include: string[] = [];
  const exclude: string[] = [];

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  )) {
    const displayName = `${entry.name}${entry.isDirectory() ? "/" : ""}`;

    if (SOURCE_EXCLUDE.has(entry.name) || ignoredByProject(entry.name, ignoredPatterns)) {
      exclude.push(displayName);
    } else {
      include.push(displayName);
    }
  }

  return [
    TEMPLATE_MARKER,
    "",
    "# SCOPE",
    "",
    "## Include",
    "",
    bulletList(include),
    "",
    "## Exclude",
    "",
    bulletList(exclude),
    "",
    "## Rationale",
    "",
    "-",
    ""
  ].join("\n");
};

const placeInputFile = async (
  projectRootPath: string,
  runPath: string,
  fileName: "BASELINE.md" | "SCOPE.md",
  template: string
): Promise<"missing" | "placed"> => {
  const targetPath = path.join(runPath, fileName);

  if (!(await isFile(targetPath))) {
    const fallbackPath = path.join(projectRootPath, fileName);

    if (await isFile(fallbackPath)) {
      await copyFile(fallbackPath, targetPath);
    } else {
      await writeFile(targetPath, template, "utf8");
    }
  }

  const body = await readFile(targetPath, "utf8");

  if (!body.trim() || body.includes(TEMPLATE_MARKER)) {
    return "missing";
  }

  return "placed";
};

export const runPlaceInputsJob = async (
  projectRootPath: string,
  runId: string
): Promise<PlaceInputsResult> => {
  const runPath = path.join(projectRootPath, RUNS_DIR, runId);

  if (!(await isDirectory(runPath))) {
    throw new Error(`Run directory not found: ${runPath}`);
  }

  const scope = await placeInputFile(
    projectRootPath,
    runPath,
    "SCOPE.md",
    await createScopeTemplate(projectRootPath)
  );
  const baseline = await placeInputFile(projectRootPath, runPath, "BASELINE.md", BASELINE_TEMPLATE);

  return {
    baseline,
    run_id: runId,
    scope,
    status: scope === "placed" && baseline === "placed" ? "ready" : "waiting_for_input"
  };
};

export const runCaptureGitStateJob = async (
  projectRootPath: string,
  runId: string
): Promise<CaptureGitStateResult> => {
  const runPath = path.join(projectRootPath, RUNS_DIR, runId);

  if (!(await isDirectory(runPath))) {
    throw new Error(`Run directory not found: ${runPath}`);
  }

  const headPath = path.join(runPath, "git-head.txt");
  const statusPath = path.join(runPath, "git-status.txt");
  const patchPath = path.join(runPath, "working-tree.patch");

  try {
    const head = await runGit(projectRootPath, ["rev-parse", "HEAD"]);
    const statusOutput = await runGit(projectRootPath, ["status", "--short"]);
    const diffOutput = await runGit(projectRootPath, ["diff", "--binary"]);

    await writeFile(headPath, `${head.toString("utf8").trimEnd()}\n`, "utf8");
    await writeFile(statusPath, statusOutput);
    await writeFile(patchPath, diffOutput);

    return {
      has_git: true,
      run_id: runId
    };
  } catch {
    await writeFile(headPath, NO_GIT_REPOSITORY, "utf8");
    await writeFile(statusPath, NO_GIT_REPOSITORY, "utf8");
    await writeFile(patchPath, NO_GIT_REPOSITORY, "utf8");

    return {
      has_git: false,
      run_id: runId
    };
  }
};

export const runBuildSourceManifestJob = async (
  projectRootPath: string,
  runId: string
): Promise<ManifestResult> => {
  const runPath = path.join(projectRootPath, RUNS_DIR, runId);

  if (!(await isDirectory(runPath))) {
    throw new Error(`Run directory not found: ${runPath}`);
  }

  const entries = await collectManifestEntries(projectRootPath, (relativePath) =>
    relativePath.split("/").some((part) => SOURCE_EXCLUDE.has(part))
  );

  await writeCsvManifest(path.join(runPath, "SOURCE_MANIFEST.csv"), entries);

  return {
    file_count: entries.length,
    run_id: runId
  };
};

export const runBuildFactoryManifestJob = async (
  projectRootPath: string,
  runId: string
): Promise<ManifestResult> => {
  const runPath = path.join(projectRootPath, RUNS_DIR, runId);
  const factoryPath = path.join(projectRootPath, FACTORY_DIR);

  if (!(await isDirectory(runPath))) {
    throw new Error(`Run directory not found: ${runPath}`);
  }

  if (!(await isDirectory(factoryPath))) {
    throw new Error(`Factory directory not found: ${factoryPath}`);
  }

  const entries = await collectManifestEntries(factoryPath, (relativePath) => {
    const firstSegment = relativePath.split("/")[0] ?? "";

    return FACTORY_TOP_LEVEL_EXCLUDE.has(firstSegment);
  });

  await writeCsvManifest(path.join(runPath, "FACTORY_MANIFEST.csv"), entries);

  return {
    file_count: entries.length,
    run_id: runId
  };
};

const countCsvDataRows = async (csvPath: string): Promise<number> => {
  const content = await readFile(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);

  return Math.max(0, lines.length - 1);
};

const findPreviousPassRun = async (
  projectRootPath: string,
  currentRunId: string
): Promise<{ pre_run_manifest_sha256: string; run_id: string } | null> => {
  const runsPath = path.join(projectRootPath, RUNS_DIR);
  const previousRunIds = (await listRunIds(runsPath)).filter((runId) => runId < currentRunId);
  const latestPreviousRunId = previousRunIds.at(-1);

  if (!latestPreviousRunId) {
    return null;
  }

  try {
    const seal = JSON.parse(
      await readFile(path.join(runsPath, latestPreviousRunId, RUN_SEAL_FILE), "utf8")
    ) as unknown;

    if (
      typeof seal === "object" &&
      seal !== null &&
      (seal as { decision?: unknown }).decision === "PASS" &&
      typeof (seal as { pre_run_manifest_sha256?: unknown }).pre_run_manifest_sha256 === "string"
    ) {
      return {
        pre_run_manifest_sha256: (seal as { pre_run_manifest_sha256: string })
          .pre_run_manifest_sha256,
        run_id: latestPreviousRunId
      };
    }
  } catch {
    return null;
  }

  return null;
};

export const runSealRunJob = async (
  projectRootPath: string,
  runId: string
): Promise<SealRunResult> => {
  const runPath = path.join(projectRootPath, RUNS_DIR, runId);

  if (!(await isDirectory(runPath))) {
    throw new Error(`Run directory not found: ${runPath}`);
  }

  const config = parseFactoryConfig(
    await readFile(path.join(projectRootPath, FACTORY_DIR, CONFIG_FILE), "utf8")
  );
  const files: Record<string, string> = {};
  const missing: string[] = [];

  for (const fileName of SEALED_FILES) {
    const filePath = path.join(runPath, fileName);

    if (await isFile(filePath)) {
      files[fileName] = sha256(await readFile(filePath));
    } else {
      missing.push(`${fileName} uretilemedi`);
    }
  }

  const previousRun =
    config.mode === "continuation" ? await findPreviousPassRun(projectRootPath, runId) : null;
  const warnings =
    config.mode === "continuation" && !previousRun
      ? ["mode continuation, ancak devam edilecek PASS muhur bulunamadi"]
      : [];
  const createdAt = new Date().toISOString();
  const preRunManifest = {
    counts: {
      factory_files: await countCsvDataRows(path.join(runPath, "FACTORY_MANIFEST.csv")).catch(
        () => 0
      ),
      source_files: await countCsvDataRows(path.join(runPath, "SOURCE_MANIFEST.csv")).catch(() => 0)
    },
    created_at: createdAt,
    factory_version: config.version,
    files,
    previous_run: previousRun,
    project_mode: config.mode,
    project_root: path.basename(projectRootPath),
    run_id: runId
  };
  const preRunManifestPath = path.join(runPath, "PRE_RUN_MANIFEST.json");
  await writeFile(preRunManifestPath, `${JSON.stringify(preRunManifest, null, 2)}\n`, "utf8");

  const preRunManifestSha256 = sha256(await readFile(preRunManifestPath));
  const decision = missing.length === 0 ? "PASS" : "FAIL";
  const runSeal = {
    created_at: createdAt,
    decision,
    factory_version: config.version,
    missing,
    pre_run_manifest_sha256: preRunManifestSha256,
    previous_run: previousRun,
    project_mode: config.mode,
    run_id: runId,
    warnings
  };
  await writeFile(
    path.join(runPath, RUN_SEAL_FILE),
    `${JSON.stringify(runSeal, null, 2)}\n`,
    "utf8"
  );

  return {
    decision,
    missing,
    pre_run_manifest_sha256: preRunManifestSha256,
    run_id: runId
  };
};
