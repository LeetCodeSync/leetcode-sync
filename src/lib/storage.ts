const SETTINGS_KEY = "settings";
const AUTH_KEY = "githubAuthSession";
const PENDING_AUTH_KEY = "pendingGitHubDeviceAuth";

const DEFAULT_SETTINGS = {
  githubClientId: "",
  githubScope: "repo",
  repoOwner: "",
  repoName: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);

  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] || {})
  };
}

export async function saveSettings(settings: typeof DEFAULT_SETTINGS) {
  await chrome.storage.local.set({
    [SETTINGS_KEY]: settings
  });
}

export async function getAuthSession() {
  const result = await chrome.storage.local.get(AUTH_KEY);
  return result[AUTH_KEY] || null;
}

export async function saveAuthSession(session: any) {
  await chrome.storage.local.set({
    [AUTH_KEY]: session
  });
}

export async function clearAuthSession() {
  await chrome.storage.local.remove(AUTH_KEY);
}

export async function getPendingDeviceAuth() {
  const result = await chrome.storage.local.get(PENDING_AUTH_KEY);
  return result[PENDING_AUTH_KEY] || null;
}

export async function savePendingDeviceAuth(pending: any) {
  await chrome.storage.local.set({
    [PENDING_AUTH_KEY]: pending
  });
}

export async function clearPendingDeviceAuth() {
  await chrome.storage.local.remove(PENDING_AUTH_KEY);
}
