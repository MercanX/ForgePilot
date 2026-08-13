import { DEFAULT_LOCALE, TRANSLATION_NAMESPACES } from "@shared/constants/locales";

export const embeddedDefaultLocale = {
  id: DEFAULT_LOCALE,
  namespaces: TRANSLATION_NAMESPACES,
  translations: {
    renderer: {
      projectsTitle: "Projects",
      addProject: "Add Project",
      emptyProjects: "Add a local folder to start.",
      openProject: "Open",
      removeProject: "Remove"
    }
  }
} as const;
