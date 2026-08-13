import { join } from "node:path";

import { BrowserWindow, type WebPreferences } from "electron";

import { installNavigationGuard } from "@main/security/navGuard";

export type MainWindowOptions = {
  isDev: boolean;
  rendererUrl?: string;
};

export const getDefaultWebPreferences = (preloadPath: string): WebPreferences => ({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  preload: preloadPath
});

export const createMainWindow = async (options: MainWindowOptions): Promise<BrowserWindow> => {
  const mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "ForgePilot",
    webPreferences: getDefaultWebPreferences(join(__dirname, "../preload/index.mjs"))
  });

  installNavigationGuard(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (options.isDev && options.rendererUrl) {
    await mainWindow.loadURL(options.rendererUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return mainWindow;
  }

  await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  return mainWindow;
};
