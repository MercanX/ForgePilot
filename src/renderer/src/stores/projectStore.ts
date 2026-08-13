import { create } from "zustand";

import type { Project } from "@shared/schemas/project";

type ProjectStoreState = {
  activeProject: Project | null;
  errorMessage: string | null;
  isLoading: boolean;
  projects: Project[];
  statusMessage: string;
  addProject: () => Promise<void>;
  loadProjects: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Project action failed.";

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  activeProject: null,
  errorMessage: null,
  isLoading: false,
  projects: [],
  statusMessage: "Ready",

  addProject: async () => {
    set({ errorMessage: null, isLoading: true, statusMessage: "Selecting project folder" });

    try {
      const project = await window.forgepilot.projects.add();

      if (!project) {
        set({ isLoading: false, statusMessage: "Project selection canceled" });
        return;
      }

      const projects = await window.forgepilot.projects.list();
      set({
        activeProject: project,
        isLoading: false,
        projects,
        statusMessage: "Project added"
      });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false, statusMessage: "Ready" });
    }
  },

  loadProjects: async () => {
    set({ errorMessage: null, isLoading: true, statusMessage: "Loading projects" });

    try {
      const projects = await window.forgepilot.projects.list();
      set({ isLoading: false, projects, statusMessage: "Ready" });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false, statusMessage: "Ready" });
    }
  },

  openProject: async (projectId: string) => {
    set({ errorMessage: null, isLoading: true, statusMessage: "Opening project" });

    try {
      const activeProject = await window.forgepilot.projects.open(projectId);
      const projects = get().projects.map((project) =>
        project.id === activeProject.id ? activeProject : project
      );
      set({
        activeProject,
        isLoading: false,
        projects,
        statusMessage: "Project opened"
      });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false, statusMessage: "Ready" });
    }
  },

  removeProject: async (projectId: string) => {
    set({ errorMessage: null, isLoading: true, statusMessage: "Removing project" });

    try {
      await window.forgepilot.projects.remove(projectId);
      const projects = await window.forgepilot.projects.list();
      const activeProject = get().activeProject;
      set({
        activeProject: activeProject?.id === projectId ? null : activeProject,
        isLoading: false,
        projects,
        statusMessage: "Project removed"
      });
    } catch (error) {
      set({ errorMessage: getErrorMessage(error), isLoading: false, statusMessage: "Ready" });
    }
  }
}));
