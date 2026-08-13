import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const normalizeForComparison = (path: string): string => {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const resolveDirectoryRealPath = async (path: string): Promise<string> => {
  if (!isAbsolute(path)) {
    throw new Error("Path must be absolute.");
  }

  const resolvedPath = resolve(path);
  const pathStats = await stat(resolvedPath);

  if (!pathStats.isDirectory()) {
    throw new Error("Path must point to a directory.");
  }

  return realpath(resolvedPath);
};

export const isPathInsideRoot = (rootPath: string, candidatePath: string): boolean => {
  const normalizedRoot = normalizeForComparison(rootPath);
  const normalizedCandidate = normalizeForComparison(candidatePath);
  const relativePath = relative(normalizedRoot, normalizedCandidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

export const assertPathInsideRoot = (rootPath: string, candidatePath: string): string => {
  const resolvedCandidate = resolve(candidatePath);

  if (!isPathInsideRoot(rootPath, resolvedCandidate)) {
    throw new Error("Path is outside the selected project root.");
  }

  return resolvedCandidate;
};
