export type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

export interface SyncRecord {
  id: string;
  title: string;
  difficulty: Difficulty;
}

export interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}