import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

const TEMPLATE_MARKER =
  "<!-- STARTUP_REVIEW_REQUIRED: Bu dosyayi kontrol edin, gerekli degisiklikleri yaptiktan sonra onaylamak icin bu satiri silin. -->";
const CONFIG_FILE = "factory.config.yaml";
const FACTORY_DIR = ".ai-factory";
const RUN_ID_PATTERN = /^.+-\d{8}-\d{3}$/;
const RUNS_DIR = ".ai-factory-runs";
const RUN_SEAL_FILE = "RUN_SEAL.json";
const SUPPORTED_LOCALES = new Set(["tr-TR", "en-US", "de-DE"]);
const DEFAULT_CONFIG = [
  "version: unknown",
  "factory:",
  "  mode: unknown",
  "  locale: tr-TR",
  ""
].join("\n");
const SCOPE_TEMPLATE = [
  TEMPLATE_MARKER,
  "",
  "# SCOPE",
  "",
  "## Include",
  "",
  "-",
  "",
  "## Exclude",
  "",
  "-",
  "",
  "## Rationale",
  "",
  "-",
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

const isDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
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

const isFile = async (filePath: string): Promise<boolean> => {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
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

  const scope = await placeInputFile(projectRootPath, runPath, "SCOPE.md", SCOPE_TEMPLATE);
  const baseline = await placeInputFile(projectRootPath, runPath, "BASELINE.md", BASELINE_TEMPLATE);

  return {
    baseline,
    run_id: runId,
    scope,
    status: scope === "placed" && baseline === "placed" ? "ready" : "waiting_for_input"
  };
};
