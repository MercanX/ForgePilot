export const isDev = (): boolean => !appIsPackaged();

export const appIsPackaged = (): boolean => process.env.NODE_ENV === "production";
