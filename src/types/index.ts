export type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

export interface ExtensionSettings {
  githubClientId: string;
  githubScope: "public_repo" | "repo";
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  autoSyncAcceptedOnly: boolean;
}

export interface GitHubAuthSession {
  accessToken: string;
  tokenType: string;
  scope: string;
  createdAt: number;
}

export interface SyncRecord {
  id: string;
  title: string;
  difficulty: Difficulty;
}

export interface GitHubAccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface PendingDeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export interface RuntimeResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}
