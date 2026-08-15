import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  readStartupSealStatus,
  runBuildFactoryManifestJob,
  runBuildSourceManifestJob,
  runCaptureGitStateJob,
  runPlaceInputsJob,
  runSealRunJob,
  runSelectRunJob,
  runStartupJob
} from "@services/startup/startupJobService";

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

describe("startupJobService", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "forgepilot-startup-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { force: true, recursive: true });
  });

  it("creates the factory directory and default config when missing", async () => {
    const result = await runStartupJob(tempRoot);
    const config = await readFile(
      path.join(tempRoot, ".ai-factory", "factory.config.yaml"),
      "utf8"
    );

    expect(result).toEqual({
      check_factory: {
        created: true,
        path: path.join(tempRoot, ".ai-factory")
      },
      read_config: {
        locale: "tr-TR",
        mode: "unknown",
        version: "unknown"
      }
    });
    expect(config).toBe(
      ["version: unknown", "factory:", "  mode: unknown", "  locale: tr-TR", ""].join("\n")
    );
  });

  it("reads an existing config without replacing it", async () => {
    const factoryPath = path.join(tempRoot, ".ai-factory");
    const configPath = path.join(factoryPath, "factory.config.yaml");
    const existingConfig = [
      "version: 1.2.3",
      "factory:",
      "  mode: dev",
      "  locale: de-DE",
      ""
    ].join("\n");
    await runStartupJob(tempRoot);
    await writeFile(configPath, existingConfig, "utf8");

    const result = await runStartupJob(tempRoot);
    const config = await readFile(configPath, "utf8");

    expect(result).toEqual({
      check_factory: {
        created: false,
        path: factoryPath
      },
      read_config: {
        locale: "de-DE",
        mode: "dev",
        version: "1.2.3"
      }
    });
    expect(config).toBe(existingConfig);
  });

  it("falls back to tr-TR for unsupported locales", async () => {
    await runStartupJob(tempRoot);
    await writeFile(
      path.join(tempRoot, ".ai-factory", "factory.config.yaml"),
      ["version: 2", "factory:", "  mode: prod", "  locale: es-ES", ""].join("\n"),
      "utf8"
    );

    await expect(runStartupJob(tempRoot)).resolves.toMatchObject({
      read_config: {
        locale: "tr-TR",
        mode: "prod",
        version: "2"
      }
    });
  });

  it("creates a new run directory and .gitignore when no run exists", async () => {
    const result = await runSelectRunJob(tempRoot);
    const gitignore = await readFile(path.join(tempRoot, ".ai-factory-runs", ".gitignore"), "utf8");

    expect(result).toMatchObject({
      decision: "new"
    });
    expect(result.run_id).toMatch(/^.+-\d{8}-001$/);
    expect(gitignore).toBe("*\n");
  });

  it("continues the latest unsealed run", async () => {
    const runsPath = path.join(tempRoot, ".ai-factory-runs");
    await mkdir(path.join(runsPath, "sample-20260813-001"), { recursive: true });
    await mkdir(path.join(runsPath, "sample-20260814-001"), { recursive: true });

    await expect(runSelectRunJob(tempRoot)).resolves.toEqual({
      decision: "continue",
      run_id: "sample-20260814-001"
    });
  });

  it("returns already_sealed for the latest PASS sealed run", async () => {
    const runsPath = path.join(tempRoot, ".ai-factory-runs");
    const runPath = path.join(runsPath, "sample-20260814-001");
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(runPath, "RUN_SEAL.json"), '{"decision":"PASS"}', "utf8");

    await expect(runSelectRunJob(tempRoot)).resolves.toEqual({
      decision: "already_sealed",
      run_id: "sample-20260814-001"
    });
  });

  it("readStartupSealStatus reports false when no run directory exists yet", async () => {
    await expect(readStartupSealStatus(tempRoot)).resolves.toBe(false);
  });

  it("readStartupSealStatus reports true for a PASS-sealed latest run, without creating anything", async () => {
    const runsPath = path.join(tempRoot, ".ai-factory-runs");
    const runPath = path.join(runsPath, "sample-20260814-001");
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(runPath, "RUN_SEAL.json"), '{"decision":"PASS"}', "utf8");

    await expect(readStartupSealStatus(tempRoot)).resolves.toBe(true);
    await expect(readFile(path.join(runsPath, ".gitignore"), "utf8")).rejects.toThrow();
  });

  it("readStartupSealStatus reports false when the latest run is not sealed", async () => {
    const runsPath = path.join(tempRoot, ".ai-factory-runs");
    await mkdir(path.join(runsPath, "sample-20260814-001"), { recursive: true });

    await expect(readStartupSealStatus(tempRoot)).resolves.toBe(false);
  });

  it("places template input files when root files are missing", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    await mkdir(runPath, { recursive: true });
    await mkdir(path.join(tempRoot, "src"));
    await mkdir(path.join(tempRoot, "node_modules"));
    await mkdir(path.join(tempRoot, "dist"));
    await writeFile(path.join(tempRoot, "README.md"), "# Project\n", "utf8");
    await writeFile(path.join(tempRoot, ".gitignore"), "dist/\n*.log\n", "utf8");

    const result = await runPlaceInputsJob(tempRoot, runId);
    const scope = await readFile(path.join(runPath, "SCOPE.md"), "utf8");
    const baseline = await readFile(path.join(runPath, "BASELINE.md"), "utf8");

    expect(result).toEqual({
      baseline: "missing",
      run_id: runId,
      scope: "missing",
      status: "waiting_for_input"
    });
    expect(scope).toContain("STARTUP_REVIEW_REQUIRED");
    expect(scope).toContain("- `README.md`");
    expect(scope).toContain("- `src/`");
    expect(scope).toContain("- `dist/`");
    expect(scope).toContain("- `node_modules/`");
    expect(baseline).toContain("STARTUP_REVIEW_REQUIRED");
  });

  it("copies approved root input files into the selected run", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(tempRoot, "SCOPE.md"), "# Scope\n\nReal scope\n", "utf8");
    await writeFile(path.join(tempRoot, "BASELINE.md"), "# Baseline\n\nReal baseline\n", "utf8");

    const result = await runPlaceInputsJob(tempRoot, runId);

    await expect(readFile(path.join(runPath, "SCOPE.md"), "utf8")).resolves.toBe(
      "# Scope\n\nReal scope\n"
    );
    expect(result).toEqual({
      baseline: "placed",
      run_id: runId,
      scope: "placed",
      status: "ready"
    });
  });

  it("writes NO GIT REPOSITORY files when the project is not a git repository", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    await mkdir(runPath, { recursive: true });

    const result = await runCaptureGitStateJob(tempRoot, runId);

    await expect(readFile(path.join(runPath, "git-head.txt"), "utf8")).resolves.toBe(
      "NO GIT REPOSITORY\n"
    );
    await expect(readFile(path.join(runPath, "git-status.txt"), "utf8")).resolves.toBe(
      "NO GIT REPOSITORY\n"
    );
    await expect(readFile(path.join(runPath, "working-tree.patch"), "utf8")).resolves.toBe(
      "NO GIT REPOSITORY\n"
    );
    expect(result).toEqual({
      has_git: false,
      run_id: runId
    });
  });

  it("builds a source manifest for non-excluded project files", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    await mkdir(path.join(tempRoot, "src"), { recursive: true });
    await mkdir(path.join(tempRoot, "src", "vendor"), { recursive: true });
    await mkdir(path.join(tempRoot, "node_modules"), { recursive: true });
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(tempRoot, "README.md"), "# Project\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "app.ts"), "console.log('ok');\n", "utf8");
    await writeFile(path.join(tempRoot, "src", "vendor", "skip.ts"), "skip\n", "utf8");
    await writeFile(path.join(tempRoot, "node_modules", "skip.js"), "skip\n", "utf8");

    const result = await runBuildSourceManifestJob(tempRoot, runId);
    const manifest = await readFile(path.join(runPath, "SOURCE_MANIFEST.csv"), "utf8");

    expect(result).toEqual({
      file_count: 2,
      run_id: runId
    });
    expect(manifest).toContain("RelativePath,SHA256,Size\n");
    expect(manifest).toContain(`README.md,${sha256("# Project\n")},10`);
    expect(manifest).toContain(`src/app.ts,${sha256("console.log('ok');\n")},19`);
    expect(manifest).not.toContain("vendor");
    expect(manifest).not.toContain("node_modules");
  });

  it("builds a factory manifest with only top-level factory excludes", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    const factoryPath = path.join(tempRoot, ".ai-factory");
    await mkdir(path.join(factoryPath, "reports"), { recursive: true });
    await mkdir(path.join(factoryPath, "foo", "reports"), { recursive: true });
    await mkdir(runPath, { recursive: true });
    await writeFile(path.join(factoryPath, "factory.config.yaml"), "version: 1\n", "utf8");
    await writeFile(path.join(factoryPath, "reports", "skip.txt"), "skip\n", "utf8");
    await writeFile(path.join(factoryPath, "foo", "reports", "keep.txt"), "keep\n", "utf8");

    const result = await runBuildFactoryManifestJob(tempRoot, runId);
    const manifest = await readFile(path.join(runPath, "FACTORY_MANIFEST.csv"), "utf8");

    expect(result).toEqual({
      file_count: 2,
      run_id: runId
    });
    expect(manifest).toContain(`factory.config.yaml,${sha256("version: 1\n")},11`);
    expect(manifest).toContain(`foo/reports/keep.txt,${sha256("keep\n")},5`);
    expect(manifest).not.toContain("reports/skip.txt");
  });

  it("seals a run when all startup outputs exist", async () => {
    const runId = "sample-20260814-001";
    const runPath = path.join(tempRoot, ".ai-factory-runs", runId);
    await runStartupJob(tempRoot);
    await mkdir(runPath, { recursive: true });

    for (const fileName of [
      "SCOPE.md",
      "BASELINE.md",
      "git-head.txt",
      "git-status.txt",
      "working-tree.patch",
      "SOURCE_MANIFEST.csv",
      "FACTORY_MANIFEST.csv"
    ]) {
      await writeFile(
        path.join(runPath, fileName),
        fileName.endsWith(".csv") ? "RelativePath,SHA256,Size\n" : `${fileName}\n`,
        "utf8"
      );
    }

    const result = await runSealRunJob(tempRoot, runId);
    const preRunManifest = JSON.parse(
      await readFile(path.join(runPath, "PRE_RUN_MANIFEST.json"), "utf8")
    ) as { files: Record<string, string>; run_id: string };
    const runSeal = JSON.parse(await readFile(path.join(runPath, "RUN_SEAL.json"), "utf8")) as {
      decision: string;
      missing: string[];
      pre_run_manifest_sha256: string;
    };

    expect(result.decision).toBe("PASS");
    expect(result.missing).toEqual([]);
    expect(preRunManifest.run_id).toBe(runId);
    expect(Object.keys(preRunManifest.files)).toHaveLength(7);
    expect(runSeal).toMatchObject({
      decision: "PASS",
      missing: [],
      pre_run_manifest_sha256: result.pre_run_manifest_sha256
    });
  });
});
