import type {
  DashboardStats,
  ExtensionSettings,
  GitHubAuthSession,
  PendingDeviceAuth,
  SyncRecord
} from "../types";

const SETTINGS_KEY = "settings";
const AUTH_KEY = "githubAuthSession";
const PENDING_AUTH_KEY = "pendingGitHubDeviceAuth";
const SYNC_HISTORY_KEY = "syncHistory";

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "",
  githubScope: "repo",
  repositoryUrl: "",
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

export async function getSyncHistory(): Promise<SyncRecord[]> {
  const result = await chrome.storage.local.get(SYNC_HISTORY_KEY);
  return (result[SYNC_HISTORY_KEY] as SyncRecord[] | undefined) ?? [];
}

export async function appendSyncRecord(record: SyncRecord): Promise<void> {
  const current = await getSyncHistory();
  const next = [record, ...current].slice(0, 100);
  await chrome.storage.local.set({ [SYNC_HISTORY_KEY]: next });
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const history = await getSyncHistory();

  const successful = history.filter((record) => record.status === "success");

  const uniqueByProblem = new Map<string, SyncRecord>();
  for (const record of successful) {
    const key = `${record.problemNumber}-${record.slug}`;
    if (!uniqueByProblem.has(key)) {
      uniqueByProblem.set(key, record);
    }
  }

  const solved = Array.from(uniqueByProblem.values());

  const easyCount = solved.filter((item) => item.difficulty === "Easy").length;
  const mediumCount = solved.filter((item) => item.difficulty === "Medium").length;
  const hardCount = solved.filter((item) => item.difficulty === "Hard").length;

  const latest = successful[0];

  return {
    totalSolved: solved.length,
    easyCount,
    mediumCount,
    hardCount,
    lastSyncedAt: latest?.syncedAt,
    lastProblemTitle: latest?.title
  };
}
