import type { ExtensionSettings } from "../types";

export const STORAGE_KEYS = {
  settings: "settings",
  auth: "githubAuthSession",
  pendingAuth: "pendingGitHubDeviceAuth"
} as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "",
  githubScope: "repo",
  repositoryUrl: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
