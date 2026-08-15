import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const MANIFEST_CSV_HEADER = "RelativePath,SHA256,Size";

export type ManifestEntry = {
  relativePath: string;
  sha256: string;
  size: number;
};

export const sha256 = (content: Buffer): string => createHash("sha256").update(content).digest("hex");

export const isDirectory = async (targetPath: string): Promise<boolean> => {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
};

export const isFile = async (targetPath: string): Promise<boolean> => {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
};

export const toPosixRelative = (rootPath: string, targetPath: string): string =>
  path.relative(rootPath, targetPath).split(path.sep).join("/");

export const collectManifestEntries = async (
  rootPath: string,
  shouldExcludeRelativePath: (relativePath: string) => boolean
): Promise<ManifestEntry[]> => {
  const entries: ManifestEntry[] = [];

  const visit = async (directoryPath: string): Promise<void> => {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });

    for (const entry of directoryEntries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = toPosixRelative(rootPath, entryPath);

      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (!entry.isFile() || shouldExcludeRelativePath(relativePath)) {
        continue;
      }

      const content = await readFile(entryPath);
      entries.push({
        relativePath,
        sha256: sha256(content),
        size: content.byteLength
      });
    }
  };

  await visit(rootPath);

  return entries.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
};

export const writeCsvManifest = async (
  manifestPath: string,
  entries: ManifestEntry[]
): Promise<void> => {
  await writeFile(
    manifestPath,
    [
      MANIFEST_CSV_HEADER,
      ...entries.map((entry) => `${entry.relativePath},${entry.sha256},${entry.size}`),
      ""
    ].join("\n"),
    "utf8"
  );
};

export const readGitignorePatterns = async (projectRootPath: string): Promise<string[]> => {
  try {
    const content = await readFile(path.join(projectRootPath, ".gitignore"), "utf8");

    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => line.replace(/^\/+/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
};

export const wildcardToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replaceAll("*", ".*");

  return new RegExp(`^${escaped}$`);
};

export const ignoredByProject = (relativeName: string, patterns: string[]): boolean => {
  const relativeDirectory = `${relativeName}/`;

  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/\/+$/, "");

    if (!cleanPattern) {
      continue;
    }

    if (
      !cleanPattern.includes("/") &&
      (relativeName === cleanPattern || relativeDirectory.startsWith(`${cleanPattern}/`))
    ) {
      return true;
    }

    if (
      wildcardToRegex(cleanPattern).test(relativeName) ||
      wildcardToRegex(`${cleanPattern}/`).test(relativeDirectory)
    ) {
      return true;
    }
  }

  return false;
};

export const runGit = async (projectRootPath: string, args: string[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd: projectRootPath,
        encoding: "buffer",
        maxBuffer: 50 * 1024 * 1024,
        shell: false,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(error.message));
          return;
        }

        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
      }
    );
  });
