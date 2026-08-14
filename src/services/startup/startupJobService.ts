import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const CONFIG_FILE = "factory.config.yaml";
const FACTORY_DIR = ".ai-factory";
const SUPPORTED_LOCALES = new Set(["tr-TR", "en-US", "de-DE"]);
const DEFAULT_CONFIG = [
  "version: unknown",
  "factory:",
  "  mode: unknown",
  "  locale: tr-TR",
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
