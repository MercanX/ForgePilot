export const IPC_CHANNELS = {
  app: {
    ping: "app:ping"
  },
  projects: {
    list: "projects:list",
    add: "projects:add",
    remove: "projects:remove",
    open: "projects:open"
  },
  providers: {
    list: "providers:list",
    detect: "providers:detect",
    refresh: "providers:refresh"
  },
  jobs: {
    request: "jobs:request",
    get: "jobs:get",
    workflow: "jobs:workflow",
    heartbeat: "jobs:heartbeat",
    submitResult: "jobs:submit-result",
    fail: "jobs:fail",
    syncFindings: "jobs:sync-findings"
  },
  logs: {
    list: "logs:list"
  },
  localization: {
    getActiveLocale: "localization:get-active-locale",
    listLanguagePacks: "localization:list-language-packs",
    installLanguagePack: "localization:install-language-pack",
    setActiveLocale: "localization:set-active-locale"
  }
} as const;
