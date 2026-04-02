import type {
  ExtensionSettings,
  GitHubAuthSession,
  PendingDeviceAuth
} from "@/types";

const SETTINGS_KEY = "settings";
const AUTH_KEY = "githubAuthSession";
const PENDING_AUTH_KEY = "pendingGitHubDeviceAuth";

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "",
  githubScope: "repo",
  repoOwner: "",
  repoName: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);

  return {
    ...DEFAULT_SETTINGS,
    ...((result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined) ?? {})
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getAuthSession(): Promise<GitHubAuthSession | null> {
  const result = await chrome.storage.local.get(AUTH_KEY);
  return (result[AUTH_KEY] as GitHubAuthSession | undefined) ?? null;
}

export async function saveAuthSession(
  session: GitHubAuthSession
): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: session });
}

export async function clearAuthSession(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

export async function getPendingDeviceAuth(): Promise<PendingDeviceAuth | null> {
  const result = await chrome.storage.local.get(PENDING_AUTH_KEY);
  return (result[PENDING_AUTH_KEY] as PendingDeviceAuth | undefined) ?? null;
}

export async function savePendingDeviceAuth(
  pending: PendingDeviceAuth
): Promise<void> {
  await chrome.storage.local.set({ [PENDING_AUTH_KEY]: pending });
}

export async function clearPendingDeviceAuth(): Promise<void> {
  await chrome.storage.local.remove(PENDING_AUTH_KEY);
}
