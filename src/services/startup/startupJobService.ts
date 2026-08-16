import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  startupScopeDocumentSchema,
  startupScopeProposalSchema,
  startupSealSchema,
  startupWorkspaceManifestSchema,
  type StartupApprovedScope,
  type StartupScopeDocument,
  type StartupScopeProposal,
  type StartupSeal,
  type StartupState,
  type StartupWorkspaceManifest
} from "@shared/schemas/startup";

const STARTUP_DIR = path.join(".ai-factory", "010-Startup");
const SCOPE_FILE = "SCOPE.json";
const MANIFEST_FILE = "WORKSPACE_MANIFEST.json";
const SEAL_FILE = "STARTUP_SEAL.json";

const RESERVED_ROOTS = new Set([".ai-factory", ".ai-factory-runs", ".forgepilot", ".git"]);

export type StartupScopeStatusResult = {
  approved: boolean;
  hasProposal: boolean;
  sealed: boolean;
  state: "approved" | "missing" | "proposal_pending" | "sealed";
  workspace_hash: string | null;
};

export type StartupProposalSavedResult = {
  status: "pending_approval";
};

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const stableStringify = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const normalizeScopePath = (value: string): string => {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/g, "");

  if (normalized === "" || normalized === ".") {
    return ".";
  }

  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`Scope path must be project-relative: ${value}`);
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "..")) {
    throw new Error(`Scope path may not traverse outside the project root: ${value}`);
  }

  return parts.join("/");
};

const normalizeUniquePaths = (values: string[]): string[] =>
  [...new Set(values.map(normalizeScopePath))].sort((left, right) => left.localeCompare(right));

const reservedRootFor = (relativePath: string): string =>
  relativePath === "." ? "." : relativePath.split("/")[0] ?? relativePath;

const isReservedPath = (relativePath: string): boolean =>
  relativePath !== "." && RESERVED_ROOTS.has(reservedRootFor(relativePath));

const isPathInsideProject = (projectRootPath: string, candidate: string): boolean => {
  const relative = path.relative(projectRootPath, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const resolveScopePath = (projectRootPath: string, relativePath: string): string => {
  const resolved = path.resolve(projectRootPath, relativePath === "." ? "." : relativePath);
  if (!isPathInsideProject(projectRootPath, resolved)) {
    throw new Error(`Scope path escapes the selected project root: ${relativePath}`);
  }
  return resolved;
};

const pathMatchesOrIsBelow = (relativePath: string, scopePath: string): boolean =>
  scopePath === "." || relativePath === scopePath || relativePath.startsWith(`${scopePath}/`);

const startupDirectory = (projectRootPath: string): string => path.join(projectRootPath, STARTUP_DIR);
const scopePath = (projectRootPath: string): string => path.join(startupDirectory(projectRootPath), SCOPE_FILE);
const manifestPath = (projectRootPath: string): string =>
  path.join(startupDirectory(projectRootPath), MANIFEST_FILE);
const sealPath = (projectRootPath: string): string => path.join(startupDirectory(projectRootPath), SEAL_FILE);

const readJsonIfPresent = async <T>(filePath: string, parser: { parse: (value: unknown) => T }): Promise<T | null> => {
  try {
    return parser.parse(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const readScope = async (projectRootPath: string): Promise<StartupScopeDocument | null> =>
  readJsonIfPresent(scopePath(projectRootPath), startupScopeDocumentSchema);

const readManifest = async (projectRootPath: string): Promise<StartupWorkspaceManifest | null> =>
  readJsonIfPresent(manifestPath(projectRootPath), startupWorkspaceManifestSchema);

const readSeal = async (projectRootPath: string): Promise<StartupSeal | null> =>
  readJsonIfPresent(sealPath(projectRootPath), startupSealSchema);

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stableStringify(value), "utf8");
};

const projectRootId = (projectRootPath: string): string =>
  sha256(path.resolve(projectRootPath).replaceAll("\\", "/").toLowerCase());

const canonicalApprovedScope = (approved: StartupApprovedScope): StartupApprovedScope => ({
  exclude: normalizeUniquePaths(approved.exclude),
  explicit_files: normalizeUniquePaths(approved.explicit_files),
  include: normalizeUniquePaths(approved.include)
});

const assertApprovalPaths = async (
  projectRootPath: string,
  approved: StartupApprovedScope
): Promise<void> => {
  if (approved.include.length === 0 && approved.explicit_files.length === 0) {
    throw new Error("Approved scope must include at least one path or explicit file.");
  }

  for (const relativePath of [...approved.include, ...approved.explicit_files]) {
    if (isReservedPath(relativePath)) {
      throw new Error(`ForgePilot runtime/VCS path cannot be included in audit scope: ${relativePath}`);
    }

    const absolutePath = resolveScopePath(projectRootPath, relativePath);
    try {
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink()) {
        throw new Error(`Symlink paths are not allowed in approved scope: ${relativePath}`);
      }
      if (approved.explicit_files.includes(relativePath) && !info.isFile()) {
        throw new Error(`Explicit scope entry must be a file: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Approved scope path does not exist: ${relativePath}`);
      }
      throw error;
    }
  }
}

export const readStartupState = async (projectRootPath: string): Promise<StartupState> => ({
  manifest: await readManifest(projectRootPath),
  scope: await readScope(projectRootPath),
  seal: await readSeal(projectRootPath)
});

export const approveStartupScope = async (
  projectRootPath: string,
  approvedInput: StartupApprovedScope
): Promise<StartupScopeDocument> => {
  const current = await readScope(projectRootPath);
  if (!current) {
    throw new Error("AI scope proposal does not exist yet.");
  }

  const approved = canonicalApprovedScope(approvedInput);
  await assertApprovalPaths(projectRootPath, approved);

  const unresolved = current.proposal.needs_user_decision
    .map((entry) => normalizeScopePath(entry.path))
    .filter((decisionPath) => {
      const included = approved.include.some((candidate) =>
        pathMatchesOrIsBelow(decisionPath, candidate)
      );
      const excluded = approved.exclude.some((candidate) =>
        pathMatchesOrIsBelow(decisionPath, candidate)
      );
      const explicit = approved.explicit_files.some((candidate) =>
        candidate === decisionPath || pathMatchesOrIsBelow(candidate, decisionPath)
      );
      return !included && !excluded && !explicit;
    });

  if (unresolved.length > 0) {
    throw new Error(
      `Resolve every AI needs_user_decision path before approval: ${unresolved.join(", ")}`
    );
  }

  const scopeHash = sha256(JSON.stringify(approved));
  const next: StartupScopeDocument = {
    ...current,
    approved,
    approved_at: new Date().toISOString(),
    scope_hash: scopeHash,
    status: "approved"
  };

  await writeJson(scopePath(projectRootPath), next);
  await rm(manifestPath(projectRootPath), { force: true });
  await rm(sealPath(projectRootPath), { force: true });
  return next;
};

export const runScopeStatusJob = async (
  projectRootPath: string,
  reset = false
): Promise<StartupScopeStatusResult> => {
  if (reset) {
    await rm(scopePath(projectRootPath), { force: true });
    await rm(manifestPath(projectRootPath), { force: true });
    await rm(sealPath(projectRootPath), { force: true });
  }

  const scope = await readScope(projectRootPath);
  const manifest = await readManifest(projectRootPath);
  const seal = await readSeal(projectRootPath);

  const sealed = Boolean(
    scope?.status === "approved" &&
      scope.scope_hash &&
      manifest &&
      seal &&
      manifest.scope_hash === scope.scope_hash &&
      seal.scope_hash === scope.scope_hash &&
      seal.manifest_hash === manifest.manifest_hash &&
      seal.workspace_hash === manifest.workspace_hash &&
      seal.status === "READY_FOR_DISCOVERY"
  );

  if (sealed) {
    return {
      approved: true,
      hasProposal: true,
      sealed: true,
      state: "sealed",
      workspace_hash: seal?.workspace_hash ?? null
    };
  }

  if (scope?.status === "approved") {
    return {
      approved: true,
      hasProposal: true,
      sealed: false,
      state: "approved",
      workspace_hash: manifest?.workspace_hash ?? null
    };
  }

  if (scope) {
    return {
      approved: false,
      hasProposal: true,
      sealed: false,
      state: "proposal_pending",
      workspace_hash: null
    };
  }

  return {
    approved: false,
    hasProposal: false,
    sealed: false,
    state: "missing",
    workspace_hash: null
  };
};

const normalizeProposal = (proposalInput: unknown): StartupScopeProposal => {
  const proposal = startupScopeProposalSchema.parse(proposalInput);
  const normalizeEntries = (entries: StartupScopeProposal["include"]): StartupScopeProposal["include"] =>
    entries.map((entry) => ({ ...entry, path: normalizeScopePath(entry.path) }));

  const normalized = {
    exclude: normalizeEntries(proposal.exclude),
    include: normalizeEntries(proposal.include),
    needs_user_decision: normalizeEntries(proposal.needs_user_decision),
    summary: proposal.summary.trim()
  };

  const illegalIncludes = normalized.include
    .map((entry) => entry.path)
    .filter((relativePath) => isReservedPath(relativePath));
  if (illegalIncludes.length > 0) {
    throw new Error(
      `AI scope proposal attempted to include reserved runtime/VCS paths: ${illegalIncludes.join(", ")}`
    );
  }

  return normalized;
};

export const runSaveScopeProposalJob = async (
  projectRootPath: string,
  proposalInput: unknown
): Promise<StartupProposalSavedResult> => {
  const proposal = normalizeProposal(proposalInput);
  const document: StartupScopeDocument = {
    approved: null,
    approved_at: null,
    project_root_id: projectRootId(projectRootPath),
    proposal,
    proposal_created_at: new Date().toISOString(),
    schema_version: "1.0",
    scope_hash: null,
    status: "pending_approval"
  };

  await writeJson(scopePath(projectRootPath), document);
  await rm(manifestPath(projectRootPath), { force: true });
  await rm(sealPath(projectRootPath), { force: true });
  return { status: "pending_approval" };
};

type ManifestRecord = StartupWorkspaceManifest["files"][number];

const hashFile = async (projectRootPath: string, absolutePath: string): Promise<ManifestRecord> => {
  const body = await readFile(absolutePath);
  const info = await stat(absolutePath);
  return {
    path: path.relative(projectRootPath, absolutePath).replaceAll("\\", "/"),
    sha256: sha256(body),
    size: info.size
  };
};

const collectDirectoryFiles = async (
  projectRootPath: string,
  absoluteDirectory: string,
  approved: StartupApprovedScope,
  records: Map<string, ManifestRecord>
): Promise<void> => {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(absoluteDirectory, entry.name);
    const relative = path.relative(projectRootPath, absolute).replaceAll("\\", "/");

    if (!relative || isReservedPath(relative)) {
      continue;
    }

    if (approved.exclude.some((candidate) => pathMatchesOrIsBelow(relative, candidate))) {
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectDirectoryFiles(projectRootPath, absolute, approved, records);
      continue;
    }

    if (entry.isFile()) {
      records.set(relative, await hashFile(projectRootPath, absolute));
    }
  }
};

const collectApprovedFiles = async (
  projectRootPath: string,
  approved: StartupApprovedScope
): Promise<ManifestRecord[]> => {
  const records = new Map<string, ManifestRecord>();

  for (const relativePath of approved.include) {
    if (isReservedPath(relativePath)) {
      continue;
    }

    const absolute = resolveScopePath(projectRootPath, relativePath);
    const info = await lstat(absolute);

    if (info.isSymbolicLink()) {
      continue;
    }

    if (info.isDirectory()) {
      await collectDirectoryFiles(projectRootPath, absolute, approved, records);
    } else if (info.isFile()) {
      const normalized = relativePath === "." ? path.basename(absolute) : relativePath;
      if (!approved.exclude.some((candidate) => pathMatchesOrIsBelow(normalized, candidate))) {
        records.set(normalized, await hashFile(projectRootPath, absolute));
      }
    }
  }

  for (const relativePath of approved.explicit_files) {
    if (isReservedPath(relativePath)) {
      continue;
    }

    const absolute = resolveScopePath(projectRootPath, relativePath);
    const info = await lstat(absolute);
    if (info.isFile() && !info.isSymbolicLink()) {
      records.set(relativePath, await hashFile(projectRootPath, absolute));
    }
  }

  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path));
};

export const runBuildWorkspaceManifestJob = async (
  projectRootPath: string
): Promise<StartupWorkspaceManifest> => {
  const scope = await readScope(projectRootPath);
  if (!scope || scope.status !== "approved" || !scope.approved || !scope.scope_hash) {
    throw new Error("Startup scope must be approved before building the workspace manifest.");
  }

  await assertApprovalPaths(projectRootPath, scope.approved);
  const files = await collectApprovedFiles(projectRootPath, scope.approved);
  const canonicalFiles = files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n");
  const manifestHash = sha256(JSON.stringify(files));
  const workspaceHash = sha256(`scope:${scope.scope_hash}\n${canonicalFiles}`);

  const manifest: StartupWorkspaceManifest = {
    created_at: new Date().toISOString(),
    file_count: files.length,
    files,
    manifest_hash: manifestHash,
    schema_version: "1.0",
    scope_hash: scope.scope_hash,
    workspace_hash: workspaceHash
  };

  await writeJson(manifestPath(projectRootPath), manifest);
  await rm(sealPath(projectRootPath), { force: true });
  return manifest;
};

export const runSealWorkspaceJob = async (projectRootPath: string): Promise<StartupSeal> => {
  const scope = await readScope(projectRootPath);
  const manifest = await readManifest(projectRootPath);

  if (!scope || scope.status !== "approved" || !scope.approved || !scope.scope_hash) {
    throw new Error("Startup scope is not approved.");
  }

  if (!manifest) {
    throw new Error("Workspace manifest does not exist.");
  }

  if (manifest.scope_hash !== scope.scope_hash) {
    throw new Error("Workspace manifest was built from a different scope.");
  }

  const expectedManifestHash = sha256(JSON.stringify(manifest.files));
  if (expectedManifestHash !== manifest.manifest_hash) {
    throw new Error("Workspace manifest hash is invalid.");
  }

  const seal: StartupSeal = {
    file_count: manifest.file_count,
    manifest_hash: manifest.manifest_hash,
    schema_version: "1.0",
    scope_hash: scope.scope_hash,
    sealed_at: new Date().toISOString(),
    status: "READY_FOR_DISCOVERY",
    workspace_hash: manifest.workspace_hash
  };

  await writeJson(sealPath(projectRootPath), seal);
  return seal;
};

export type StartupWorkspaceSnapshotVerification = {
  current_workspace_hash: string;
  expected_workspace_hash: string;
  matches: boolean;
};

export const verifyStartupWorkspaceSnapshot = async (
  projectRootPath: string
): Promise<StartupWorkspaceSnapshotVerification> => {
  const scope = await readScope(projectRootPath);
  const seal = await readSeal(projectRootPath);

  if (!scope || scope.status !== "approved" || !scope.approved || !scope.scope_hash) {
    throw new Error("Startup scope is not approved.");
  }
  if (!seal || seal.status !== "READY_FOR_DISCOVERY" || seal.scope_hash !== scope.scope_hash) {
    throw new Error("Startup seal is missing or does not match the approved scope.");
  }

  const files = await collectApprovedFiles(projectRootPath, scope.approved);
  const canonicalFiles = files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join("\n");
  const currentWorkspaceHash = sha256(`scope:${scope.scope_hash}\n${canonicalFiles}`);

  return {
    current_workspace_hash: currentWorkspaceHash,
    expected_workspace_hash: seal.workspace_hash,
    matches: currentWorkspaceHash === seal.workspace_hash
  };
};
