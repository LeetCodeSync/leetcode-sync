import {
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL
} from "./constants";
import type {
  GitHubAuthSession,
  PendingDeviceAuth
} from "../types";

export async function startDeviceFlow(clientId: string, scope: string) {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description || data.error || "Failed to start device flow"
    );
  }

  return data;
}

export async function pollForAccessToken(
  clientId: string,
  pending: PendingDeviceAuth
): Promise<GitHubAuthSession | null> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });

  const data = await response.json();

  if (data.error) {
    if (data.error === "authorization_pending" || data.error === "slow_down") {
      return null;
    }

    throw new Error(
      data.error_description || data.error || "Failed to get access token"
    );
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
    createdAt: Date.now()
  };
}
