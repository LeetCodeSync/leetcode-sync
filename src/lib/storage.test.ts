import {
  clearAuthSession,
  clearPendingDeviceAuth,
  getAuthSession,
  getPendingDeviceAuth,
  getSettings,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings
} from "./storage";
import type {
  ExtensionSettings,
  GitHubAuthSession,
  PendingDeviceAuth
} from "../types";

type StorageMap = Record<string, unknown>;

describe("src/lib/storage.ts", () => {
  let store: StorageMap;

  beforeEach(() => {
    store = {};

    (global as any).chrome = {
      storage: {
        local: {
          get: jest.fn(async (key: string) => ({
            [key]: store[key]
          })),
          set: jest.fn(async (value: StorageMap) => {
            Object.assign(store, value);
          }),
          remove: jest.fn(async (key: string) => {
            delete store[key];
          })
        }
      }
    };
  });

  it("getSettings returns defaults when storage is empty", async () => {
    const settings = await getSettings();

    expect(settings).toEqual({
      githubClientId: "",
      githubScope: "repo",
      repositoryUrl: "",
      repoBranch: "main",
    });
  });

  it("getSettings merges stored values over defaults", async () => {
    store.settings = {
      githubClientId: "client-123",
      repositoryUrl: "https://github.com/LeetCodeSync/leetcode-private"
    };

    const settings = await getSettings();

    expect(settings).toEqual({
      githubClientId: "client-123",
      githubScope: "repo",
      repositoryUrl: "https://github.com/LeetCodeSync/leetcode-private",
      repoBranch: "main",
    });
  });

  it("saveSettings writes settings to chrome storage", async () => {
    const settings: ExtensionSettings = {
      githubClientId: "client-123",
      githubScope: "public_repo",
      repositoryUrl: "https://github.com/LeetCodeSync/leetcode-public",
      repoBranch: "main",
    };

    await saveSettings(settings);

    expect(store.settings).toEqual(settings);
  });

  it("saveAuthSession and getAuthSession round-trip correctly", async () => {
    const session: GitHubAuthSession = {
      accessToken: "token-123",
      tokenType: "bearer",
      scope: "repo",
      createdAt: 123456
    };

    await saveAuthSession(session);
    const result = await getAuthSession();

    expect(result).toEqual(session);
  });

  it("clearAuthSession removes saved auth session", async () => {
    store.githubAuthSession = {
      accessToken: "token-123",
      tokenType: "bearer",
      scope: "repo",
      createdAt: 123456
    };

    await clearAuthSession();

    expect(store.githubAuthSession).toBeUndefined();
    await expect(getAuthSession()).resolves.toBeNull();
  });

  it("savePendingDeviceAuth and getPendingDeviceAuth round-trip correctly", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: 999999,
      intervalSeconds: 5
    };

    await savePendingDeviceAuth(pending);
    const result = await getPendingDeviceAuth();

    expect(result).toEqual(pending);
  });

  it("clearPendingDeviceAuth removes pending device auth", async () => {
    store.pendingGitHubDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: 999999,
      intervalSeconds: 5
    };

    await clearPendingDeviceAuth();

    expect(store.pendingGitHubDeviceAuth).toBeUndefined();
    await expect(getPendingDeviceAuth()).resolves.toBeNull();
  });
});
