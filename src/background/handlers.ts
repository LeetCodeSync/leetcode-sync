import {
  appendSyncRecord,
  clearAuthSession,
  clearPendingDeviceAuth,
  clearSyncState,
  getAuthSession,
  getDashboardStats,
  getPendingDeviceAuth,
  getSettings,
  getSyncHistory,
  getSyncState,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings,
  saveSyncState
} from "../lib/storage";
import {
  commitSubmission,
  parseGitHubRepoUrl,
  pollForAccessToken,
  startDeviceFlow
} from "../lib/github";
import { AppError, toUserMessage } from "../lib/errors";
import { logger } from "../lib/logger";
import type {
  PendingDeviceAuth,
  RuntimeResponse,
  SubmissionPayload,
  SyncRecord,
  SyncState
} from "../types";

const syncLocks = new Set<string>();
const recentAttemptTimestamps = new Map<string, number>();

export const ATTEMPT_COOLDOWN_MS = 15_000;
export const SUBMIT_TRIGGER_DELAY_MS = 2_500;
export const TAB_MESSAGE_RETRY_DELAY_MS = 1_000;
export const MAX_TAB_MESSAGE_ATTEMPTS = 6;

export type CompletedRequestDetails = {
  tabId: number;
  method?: string;
  statusCode: number;
  url: string;
};

export async function setSyncState(state: SyncState): Promise<void> {
  await saveSyncState(state);
}

export function buildSubmissionKey(submission: SubmissionPayload): string {
  if (submission.submissionId?.trim()) {
    return `submission:${submission.submissionId.trim()}`;
  }

  return [
    submission.problemNumber,
    submission.slug,
    submission.language,
    submission.code.length,
    submission.code.slice(0, 80)
  ].join(":");
}

export function cleanupRecentAttempts(now: number): void {
  for (const [key, timestamp] of recentAttemptTimestamps.entries()) {
    if (now - timestamp > ATTEMPT_COOLDOWN_MS) {
      recentAttemptTimestamps.delete(key);
    }
  }
}

export function isLeetCodeSubmitRequest(
  details: CompletedRequestDetails
): boolean {
  return (
    details.tabId >= 0 &&
    details.method === "POST" &&
    details.statusCode >= 200 &&
    details.statusCode < 400 &&
    /^https:\/\/leetcode\.com\/problems\/[^/]+\/submit\/?$/.test(details.url)
  );
}

function shouldRetryTabMessageDelivery(errorMessage?: string): boolean {
  return /Receiving end does not exist/i.test(errorMessage ?? "");
}

function sendAcceptedSubmissionFetchMessage(tabId: number, attempt: number): void {
  chrome.tabs.sendMessage(
    tabId,
    { type: "FETCH_LATEST_ACCEPTED_SUBMISSION" },
    () => {
      const err = chrome.runtime.lastError;

      if (!err) {
        logger.info("background", "fetch message delivered", {
          tabId,
          attempt
        });
        return;
      }

      logger.debug("background", "tab message delivery failed", {
        tabId,
        attempt,
        message: err.message
      });

      if (
        shouldRetryTabMessageDelivery(err.message) &&
        attempt < MAX_TAB_MESSAGE_ATTEMPTS
      ) {
        setTimeout(() => {
          sendAcceptedSubmissionFetchMessage(tabId, attempt + 1);
        }, TAB_MESSAGE_RETRY_DELAY_MS);
      }
    }
  );
}

export function triggerAcceptedSubmissionFetch(tabId: number): void {
  setTimeout(() => {
    sendAcceptedSubmissionFetchMessage(tabId, 1);
  }, SUBMIT_TRIGGER_DELAY_MS);
}

export async function checkPendingAuth(): Promise<
  RuntimeResponse<{ connected: boolean; pending: PendingDeviceAuth | null }>
> {
  logger.debug("background", "checkPendingAuth called");

  const settings = await getSettings();
  const pending = await getPendingDeviceAuth();

  if (!settings.githubClientId || !pending) {
    return { ok: true, data: { connected: false, pending: null } };
  }

  if (Date.now() >= pending.expiresAt) {
    logger.info("background", "pending auth expired");
    await clearPendingDeviceAuth();
    return { ok: true, data: { connected: false, pending: null } };
  }

  const session = await pollForAccessToken(settings.githubClientId, pending);

  if (session) {
    await saveAuthSession(session);
    await clearPendingDeviceAuth();
    logger.info("background", "auth session saved");

    return {
      ok: true,
      data: {
        connected: true,
        pending: null
      }
    };
  }

  logger.debug("background", "auth still pending");
  return {
    ok: true,
    data: {
      connected: false,
      pending
    }
  };
}

export async function beginDeviceAuth(): Promise<RuntimeResponse> {
  const settings = await getSettings();

  if (!settings.githubClientId.trim()) {
    return {
      ok: false,
      error: toUserMessage(
        new AppError(
          "INVALID_CLIENT_ID",
          "Enter your GitHub OAuth App Client ID first."
        )
      )
    };
  }

  try {
    const device = await startDeviceFlow(
      settings.githubClientId,
      settings.githubScope
    );

    const pending: PendingDeviceAuth = {
      deviceCode: device.device_code,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000,
      intervalSeconds: device.interval
    };

    await savePendingDeviceAuth(pending);

    logger.info("background", "device auth started", {
      verificationUri: pending.verificationUri,
      userCode: pending.userCode
    });

    return { ok: true, data: pending };
  } catch (error) {
    logger.error("background", "device auth failed", error);
    return {
      ok: false,
      error: toUserMessage(error, "GitHub authorization setup failed.")
    };
  }
}

export async function syncSubmission(
  submission: SubmissionPayload
): Promise<RuntimeResponse> {
  logger.info("background", "syncSubmission called", {
    slug: submission.slug,
    language: submission.language,
    problemNumber: submission.problemNumber,
    submissionId: submission.submissionId
  });

  const settings = await getSettings();
  const session = await getAuthSession();

  logger.debug("background", "repo config", {
    repositoryUrl: settings.repositoryUrl,
    branch: settings.repoBranch
  });

  if (!session?.accessToken) {
    const error = new AppError(
      "GITHUB_NOT_CONNECTED",
      "Connect GitHub before syncing submissions."
    );
    logger.warn("background", "no GitHub token available");
    return {
      ok: false,
      error: toUserMessage(error)
    };
  }

  const parsedRepo = parseGitHubRepoUrl(settings.repositoryUrl);
  if (!parsedRepo) {
    const error = new AppError(
      "INVALID_REPOSITORY_URL",
      "Enter a valid GitHub repository URL."
    );
    logger.warn("background", "repository URL is invalid", {
      repositoryUrl: settings.repositoryUrl
    });
    return {
      ok: false,
      error: toUserMessage(error)
    };
  }

  if (!settings.repoBranch.trim()) {
    const error = new AppError("INVALID_BRANCH", "Enter a branch name.");
    logger.warn("background", "repository branch is invalid", {
      branch: settings.repoBranch
    });
    return {
      ok: false,
      error: toUserMessage(error)
    };
  }

  if (settings.autoSyncAcceptedOnly && !submission.accepted) {
    logger.info("background", "submission skipped because not accepted");
    return { ok: true };
  }

  const submissionKey = buildSubmissionKey(submission);
  const now = Date.now();

  cleanupRecentAttempts(now);

  if (syncLocks.has(submissionKey)) {
    logger.warn("background", "duplicate submission sync blocked (in flight)", {
      submissionKey
    });

    return {
      ok: true,
      data: {
        skipped: true,
        reason: "in_progress"
      }
    };
  }

  const lastAttemptAt = recentAttemptTimestamps.get(submissionKey);
  if (lastAttemptAt && now - lastAttemptAt < ATTEMPT_COOLDOWN_MS) {
    logger.warn("background", "duplicate submission sync blocked (cooldown)", {
      submissionKey,
      ageMs: now - lastAttemptAt
    });

    return {
      ok: true,
      data: {
        skipped: true,
        reason: "cooldown"
      }
    };
  }

  syncLocks.add(submissionKey);
  recentAttemptTimestamps.set(submissionKey, now);

  await setSyncState({
    status: "syncing",
    startedAt: new Date().toISOString(),
    title: submission.title,
    difficulty: submission.difficulty,
    submissionId: submission.submissionId
  });

  try {
    const result = await commitSubmission({
      token: session.accessToken,
      settings,
      submission
    });

    const record: SyncRecord = {
      id: `${submission.problemNumber}-${submission.slug}-${submission.language}-${Date.now()}`,
      problemNumber: submission.problemNumber,
      slug: submission.slug,
      title: submission.title,
      difficulty: submission.difficulty,
      language: submission.language,
      submittedAt: submission.submittedAt,
      syncedAt: new Date().toISOString(),
      repoPath: result.repoPath,
      commitSha: result.commitSha,
      status: "success",
      submissionId: submission.submissionId,
      runtime: submission.runtime,
      memory: submission.memory,
      runtimePercentile: submission.runtimePercentile,
      memoryPercentile: submission.memoryPercentile
    };

    await appendSyncRecord(record);
    await setSyncState({
      status: "idle",
      title: submission.title,
      difficulty: submission.difficulty,
      submissionId: submission.submissionId
    });
    logger.info("background", "commit success", result);

    return { ok: true, data: result };
  } catch (error) {
    const message = toUserMessage(error);

    const failedRecord: SyncRecord = {
      id: `${submission.problemNumber}-${submission.slug}-${submission.language}-${Date.now()}`,
      problemNumber: submission.problemNumber,
      slug: submission.slug,
      title: submission.title,
      difficulty: submission.difficulty,
      language: submission.language,
      submittedAt: submission.submittedAt,
      syncedAt: new Date().toISOString(),
      repoPath: `${submission.problemNumber}-${submission.slug}`,
      status: "failed",
      error: message,
      submissionId: submission.submissionId,
      runtime: submission.runtime,
      memory: submission.memory,
      runtimePercentile: submission.runtimePercentile,
      memoryPercentile: submission.memoryPercentile
    };

    await appendSyncRecord(failedRecord);
    await setSyncState({
      status: "error",
      startedAt: new Date().toISOString(),
      title: submission.title,
      difficulty: submission.difficulty,
      submissionId: submission.submissionId,
      error: message
    });

    if (error instanceof AppError && error.code === "FAST_FORWARD_CONFLICT") {
      logger.warn("background", "commit failed after retry due to branch race", {
        message: error.message,
        details: error.details,
        submissionKey
      });
    } else {
      logger.error("background", "commit failed", error);
    }

    return {
      ok: false,
      error: message
    };
  } finally {
    syncLocks.delete(submissionKey);
  }
}

export async function disconnectGitHub(): Promise<RuntimeResponse> {
  await clearAuthSession();
  await clearPendingDeviceAuth();
  await clearSyncState();
  logger.info("background", "GitHub disconnected");

  return { ok: true };
}

export async function handleRuntimeMessage(
  message: { type?: string; payload?: unknown },
  sendResponse: (response: RuntimeResponse) => void
): Promise<void> {
  logger.debug("background", "message received", message);

  try {
    if (message.type === "GET_SETTINGS") {
      sendResponse({ ok: true, data: await getSettings() });
      return;
    }

    if (message.type === "SAVE_SETTINGS") {
      await saveSettings(message.payload as any);
      logger.info("background", "settings saved");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_AUTH_STATE") {
      const session = await getAuthSession();

      if (session?.accessToken) {
        sendResponse({
          ok: true,
          data: {
            connected: true,
            pending: null
          }
        });
        return;
      }

      sendResponse(await checkPendingAuth());
      return;
    }

    if (message.type === "START_GITHUB_DEVICE_AUTH") {
      sendResponse(await beginDeviceAuth());
      return;
    }

    if (message.type === "DISCONNECT_GITHUB") {
      sendResponse(await disconnectGitHub());
      return;
    }

    if (message.type === "SYNC_SUBMISSION") {
      sendResponse(await syncSubmission(message.payload as SubmissionPayload));
      return;
    }

    if (message.type === "SET_SYNC_STATE") {
      await setSyncState(message.payload as SyncState);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "GET_DASHBOARD_STATS") {
      sendResponse({ ok: true, data: await getDashboardStats() });
      return;
    }

    if (message.type === "GET_SYNC_HISTORY") {
      sendResponse({ ok: true, data: await getSyncHistory() });
      return;
    }

    if (message.type === "GET_SYNC_STATE") {
      sendResponse({ ok: true, data: await getSyncState() });
      return;
    }

    sendResponse({ ok: false, error: "Unsupported message" });
  } catch (error) {
    logger.error("background", "message handler failed", error);
    sendResponse({
      ok: false,
      error: toUserMessage(error)
    });
  }
}

export function handleCompletedRequest(details: CompletedRequestDetails): void {
  if (!isLeetCodeSubmitRequest(details)) {
    return;
  }

  logger.info("background", "LeetCode submit request detected", {
    url: details.url,
    tabId: details.tabId
  });

  triggerAcceptedSubmissionFetch(details.tabId);
}

export function __resetHandlerStateForTests(): void {
  syncLocks.clear();
  recentAttemptTimestamps.clear();
}
