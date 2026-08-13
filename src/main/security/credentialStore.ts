import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import electron from "electron";

const { safeStorage } = electron;

export type CredentialStore = {
  clearToken: () => Promise<void>;
  getToken: () => Promise<string | null>;
  setToken: (token: string) => Promise<void>;
};

export const createCredentialStore = (userDataPath: string): CredentialStore => {
  const storagePath = join(userDataPath, "cloud-token.bin");

  const getToken = async (): Promise<string | null> => {
    try {
      const encryptedToken = await readFile(storagePath);

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("OS credential encryption is not available.");
      }

      return safeStorage.decryptString(encryptedToken);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  };

  const setToken = async (token: string): Promise<void> => {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is not available.");
    }

    await mkdir(dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.tmp`;
    await writeFile(tempPath, safeStorage.encryptString(token));
    await rename(tempPath, storagePath);
  };

  const clearToken = async (): Promise<void> => {
    try {
      await unlink(storagePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }

      throw error;
    }
  };

  return {
    clearToken,
    getToken,
    setToken
  };
};
