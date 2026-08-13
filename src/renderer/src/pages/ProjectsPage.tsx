import { type ReactElement, useEffect } from "react";

import { CloudRunPanel } from "@renderer/components/CloudRunPanel";
import { ProviderPanel } from "@renderer/components/ProviderPanel";
import { TaskRunnerPanel } from "@renderer/components/TaskRunnerPanel";
import { useProjectStore } from "@renderer/stores/projectStore";
import type { Project } from "@shared/schemas/project";

const formatDate = (value: string | null): string => {
  if (!value) {
    return "Never opened";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
};

const ProjectCard = ({ project }: { project: Project }): ReactElement => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const isLoading = useProjectStore((state) => state.isLoading);
  const openProject = useProjectStore((state) => state.openProject);
  const removeProject = useProjectStore((state) => state.removeProject);
  const isActive = activeProject?.id === project.id;

  return (
    <article className={`project-row${isActive ? " is-selected" : ""}`}>
      <div className="project-row-main">
        <h2>{project.name}</h2>
        <p>{project.rootPath}</p>
      </div>
      <dl className="project-meta">
        <div>
          <dt>Added</dt>
          <dd>{formatDate(project.addedAt)}</dd>
        </div>
        <div>
          <dt>Last opened</dt>
          <dd>{formatDate(project.lastOpenedAt)}</dd>
        </div>
      </dl>
      <div className="project-actions">
        <button type="button" disabled={isLoading} onClick={() => void openProject(project.id)}>
          Open
        </button>
        <button type="button" disabled={isLoading} onClick={() => void removeProject(project.id)}>
          Remove
        </button>
      </div>
    </article>
  );
};

export const ProjectsPage = (): ReactElement => {
  const addProject = useProjectStore((state) => state.addProject);
  const errorMessage = useProjectStore((state) => state.errorMessage);
  const isLoading = useProjectStore((state) => state.isLoading);
  const loadProjects = useProjectStore((state) => state.loadProjects);
  const projects = useProjectStore((state) => state.projects);
  const statusMessage = useProjectStore((state) => state.statusMessage);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <div className="projects-page">
      <header className="workspace-heading">
        <div>
          <p className="eyebrow">Local workspace</p>
          <h1 id="workspace-title">Projects</h1>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={isLoading}
          onClick={() => void addProject()}
        >
          Add Project
        </button>
      </header>

      <section className="project-summary" aria-live="polite">
        <span>
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </span>
        <span>{statusMessage}</span>
      </section>

      {errorMessage ? <p className="error-message">{errorMessage}</p> : null}

      {projects.length === 0 ? (
        <section className="empty-projects">
          <h2>No projects yet</h2>
          <p>Add a local folder to let ForgePilot remember it for the next launch.</p>
        </section>
      ) : (
        <section className="project-list" aria-label="Known projects">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </section>
      )}

      <ProviderPanel />
      <CloudRunPanel />
      <TaskRunnerPanel />
    </div>
  );
};
