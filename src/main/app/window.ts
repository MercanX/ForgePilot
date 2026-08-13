import { join } from "node:path";

import electron, {
  type BrowserWindow as ElectronBrowserWindow,
  type WebPreferences
} from "electron";

import { installNavigationGuard } from "@main/security/navGuard";

const { BrowserWindow } = electron;

export type MainWindowOptions = {
  isDev: boolean;
  openDevTools?: boolean;
  rendererUrl?: string;
};

export const DEFAULT_WINDOW_BOUNDS = {
  width: 1180,
  height: 760,
  minWidth: 960,
  minHeight: 640
} as const;

export const getDefaultWebPreferences = (preloadPath: string): WebPreferences => ({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  preload: preloadPath
});

export const createMainWindow = async (
  options: MainWindowOptions
): Promise<ElectronBrowserWindow> => {
  const mainWindow = new BrowserWindow({
    ...DEFAULT_WINDOW_BOUNDS,
    show: false,
    title: "ForgePilot",
    webPreferences: getDefaultWebPreferences(join(__dirname, "../preload/index.cjs"))
  });

  installNavigationGuard(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (options.isDev && options.rendererUrl) {
    await mainWindow.loadURL(options.rendererUrl);
    if (options.openDevTools) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    return mainWindow;
  }

  await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  return mainWindow;
};
