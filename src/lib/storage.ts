import { DEFAULT_SETTINGS, STORAGE_KEYS } from "@/lib/constants";
import type {
  ExtensionSettings,
  PendingDeviceAuth,
} from "@/types";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined)
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getPendingDeviceAuth(): Promise<PendingDeviceAuth | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.pendingAuth);
  return (result[STORAGE_KEYS.pendingAuth] as PendingDeviceAuth | undefined) ?? null;
}

export async function savePendingDeviceAuth(pending: PendingDeviceAuth): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.pendingAuth]: pending });
}

export async function clearPendingDeviceAuth(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.pendingAuth);
}

clearAuthSession,
  clearPendingDeviceAuth,
  getAuthSession,
  getPendingDeviceAuth,
  getSettings,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings