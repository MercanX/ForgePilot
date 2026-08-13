import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { createProjectRepository } from "@services/projects/projectRepository";

describe("projectRepository", () => {
  it("persists added projects and updates last opened time", async () => {
    const tempRoot = join(process.cwd(), "node_modules", ".tmp-project-repository");
    const userDataPath = join(tempRoot, crypto.randomUUID());
    const projectRoot = join(userDataPath, "sample-project");
    await mkdir(projectRoot, { recursive: true });

    const repository = createProjectRepository(userDataPath);
    const addedProject = await repository.add(projectRoot);
    const listedProjects = await repository.list();

    expect(listedProjects).toHaveLength(1);
    expect(listedProjects[0]).toEqual(addedProject);

    const reopenedRepository = createProjectRepository(userDataPath);
    expect(await reopenedRepository.list()).toEqual([addedProject]);

    const openedProject = await reopenedRepository.open(addedProject.id);
    expect(openedProject.lastOpenedAt).not.toBeNull();

    const rawStorage = await readFile(join(userDataPath, "projects.json"), "utf8");
    const storedProjects = JSON.parse(rawStorage) as Array<{ rootPath: string }>;
    expect(storedProjects[0]?.rootPath).toBe(addedProject.rootPath);
  });

  it("does not duplicate the same root path", async () => {
    const userDataPath = join(
      process.cwd(),
      "node_modules",
      ".tmp-project-repository",
      crypto.randomUUID()
    );
    const projectRoot = join(userDataPath, "sample-project");
    await mkdir(projectRoot, { recursive: true });

    const repository = createProjectRepository(userDataPath);
    const firstProject = await repository.add(projectRoot);
    const secondProject = await repository.add(projectRoot);

    expect(secondProject).toEqual(firstProject);
    expect(await repository.list()).toHaveLength(1);
  });

  it("removes projects by id", async () => {
    const userDataPath = join(
      process.cwd(),
      "node_modules",
      ".tmp-project-repository",
      crypto.randomUUID()
    );
    const projectRoot = join(userDataPath, "sample-project");
    await mkdir(projectRoot, { recursive: true });

    const repository = createProjectRepository(userDataPath);
    const project = await repository.add(projectRoot);

    await expect(repository.remove(project.id)).resolves.toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.remove(project.id)).resolves.toBe(false);
  });
});
