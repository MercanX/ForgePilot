import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runSelectRunJob, runStartupJob } from "@services/startup/startupJobService";

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
});
