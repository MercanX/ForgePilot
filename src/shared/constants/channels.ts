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
  tasks: {
    start: "tasks:start",
    stop: "tasks:stop",
    output: "tasks:output",
    exit: "tasks:exit"
  },
  settings: {
    get: "settings:get",
    save: "settings:save"
  },
  startup: {
    getState: "startup:get-state",
    approveScope: "startup:approve-scope"
  },
  jobs: {
    status: "jobs:status",
    runOnce: "jobs:run-once",
    repairState: "jobs:repair-state",
    repairImport: "jobs:repair-import",
    repairValidate: "jobs:repair-validate",
    repairManual: "jobs:repair-manual",
    repairSave: "jobs:repair-save",
    request: "jobs:request",
    get: "jobs:get",
    workflow: "jobs:workflow",
    progress: "jobs:progress",
    debug: "jobs:debug",
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
