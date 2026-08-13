import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { resolveDirectoryRealPath } from "@main/filesystem/pathGuard";
import { type Project, projectListResponseSchema } from "@shared/schemas/project";

export type ProjectRepository = {
  list: () => Promise<Project[]>;
  add: (rootPath: string) => Promise<Project>;
  remove: (projectId: string) => Promise<boolean>;
  open: (projectId: string) => Promise<Project>;
};

export const createProjectRepository = (userDataPath: string): ProjectRepository => {
  const storagePath = join(userDataPath, "projects.json");

  const loadProjects = async (): Promise<Project[]> => {
    try {
      const rawContent = await readFile(storagePath, "utf8");
      return projectListResponseSchema.parse(JSON.parse(rawContent));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  };

  const saveProjects = async (projects: Project[]): Promise<void> => {
    await mkdir(dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
    await rename(tempPath, storagePath);
  };

  const list = async (): Promise<Project[]> => loadProjects();

  const add = async (rootPath: string): Promise<Project> => {
    const realRootPath = await resolveDirectoryRealPath(rootPath);
    const projects = await loadProjects();
    const existingProject = projects.find((project) => project.rootPath === realRootPath);

    if (existingProject) {
      return existingProject;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: basename(realRootPath),
      rootPath: realRootPath,
      addedAt: now,
      lastOpenedAt: now
    };

    const nextProjects = [project, ...projects];
    await saveProjects(nextProjects);
    return project;
  };

  const remove = async (projectId: string): Promise<boolean> => {
    const projects = await loadProjects();
    const nextProjects = projects.filter((project) => project.id !== projectId);

    if (nextProjects.length === projects.length) {
      return false;
    }

    await saveProjects(nextProjects);
    return true;
  };

  const open = async (projectId: string): Promise<Project> => {
    const projects = await loadProjects();
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      throw new Error("Project was not found.");
    }

    const project = projects[projectIndex];

    if (!project) {
      throw new Error("Project was not found.");
    }

    const openedProject: Project = {
      ...project,
      lastOpenedAt: new Date().toISOString()
    };
    const nextProjects = [...projects];
    nextProjects[projectIndex] = openedProject;
    await saveProjects(nextProjects);

    return openedProject;
  };

  return {
    add,
    list,
    open,
    remove
  };
};
