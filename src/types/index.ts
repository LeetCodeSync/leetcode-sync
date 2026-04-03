export interface ExtensionSettings {
  githubClientId: string;
  githubScope: "public_repo" | "repo";
  repositoryUrl: string;
  repoBranch: string;
  autoSyncAcceptedOnly: boolean;
}

export interface GitHubAuthSession {
  accessToken: string;
  tokenType: string;
  scope: string;
  createdAt: number;
}

export interface PendingDeviceAuth {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalSeconds: number;
}

export type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

export interface SubmissionPayload {
  problemNumber: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  language: string;
  code: string;
  descriptionText: string;
  examplesText?: string;
  constraintsText?: string;
  followUpText?: string;
  problemUrl: string;
  submittedAt: string;
  accepted: boolean;
  submissionId?: string;
  runtime?: string;
  memory?: string;
  runtimePercentile?: number;
  memoryPercentile?: number;
}

export interface SyncRecord {
  id: string;
  problemNumber: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  language: string;
  submittedAt: string;
  syncedAt: string;
  repoPath: string;
  commitSha?: string;
  status: "success" | "failed";
  error?: string;
  submissionId?: string;
  runtime?: string;
  memory?: string;
  runtimePercentile?: number;
  memoryPercentile?: number;
}

export interface DashboardStats {
  totalSolved: number;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  lastSyncedAt?: string;
  lastProblemTitle?: string;
}

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
