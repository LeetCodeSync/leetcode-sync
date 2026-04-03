import {
  appendSyncRecord,
  clearAuthSession,
  clearPendingDeviceAuth,
  getAuthSession,
  getDashboardStats,
  getPendingDeviceAuth,
  getSettings,
  getSyncHistory,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings
} from "../lib/storage";
import {
  commitSubmission,
  parseGitHubRepoUrl,
  pollForAccessToken,
  startDeviceFlow
} from "../lib/github";
import { logger } from "../lib/logger";
import type { SubmissionPayload, SyncRecord } from "../types";

const syncLocks = new Set<string>();

function buildSubmissionKey(submission: SubmissionPayload): string {
  return [
    submission.problemNumber,
    submission.slug,
    submission.language,
    submission.code.length,
    submission.code.slice(0, 80)
  ].join(":");
}

async function checkPendingAuth() {
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

async function beginDeviceAuth() {
  const settings = await getSettings();

  if (!settings.githubClientId) {
    return { ok: false, error: "Missing GitHub Client ID" };
  }

  const device = await startDeviceFlow(
    settings.githubClientId,
    settings.githubScope
  );

  const pending = {
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
}

async function syncSubmission(submission: SubmissionPayload) {
  logger.info("background", "syncSubmission called", {
    slug: submission.slug,
    language: submission.language,
    problemNumber: submission.problemNumber
  });

  const settings = await getSettings();
  const session = await getAuthSession();

  logger.debug("background", "repo config", {
    repositoryUrl: settings.repositoryUrl,
    branch: settings.repoBranch
  });

  if (!session?.accessToken) {
    logger.warn("background", "no GitHub token available");
    return { ok: false, error: "GitHub is not connected" };
  }

  const parsedRepo = parseGitHubRepoUrl(settings.repositoryUrl);
  if (!parsedRepo || !settings.repoBranch) {
    logger.warn("background", "repository settings are incomplete or invalid");
    return { ok: false, error: "Repository URL or branch is invalid" };
  }

  if (settings.autoSyncAcceptedOnly && !submission.accepted) {
    logger.info("background", "submission skipped because not accepted");
    return { ok: true };
  }

  const submissionKey = buildSubmissionKey(submission);

  if (syncLocks.has(submissionKey)) {
    logger.warn("background", "duplicate submission sync blocked", {
      submissionKey
    });
    return { ok: false, error: "A sync for this submission is already in progress" };
  }

  syncLocks.add(submissionKey);

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
      status: "success"
    };

    await appendSyncRecord(record);

    logger.info("background", "commit success", result);
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync failure";

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
      error: message
    };

    await appendSyncRecord(failedRecord);

    if (message.includes("fast forward")) {
      logger.warn("background", "commit failed after retry due to branch race", {
        message
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  logger.debug("background", "message received", message);

  (async () => {
    try {
      if (message.type === "GET_SETTINGS") {
        sendResponse({ ok: true, data: await getSettings() });
        return;
      }

      if (message.type === "SAVE_SETTINGS") {
        await saveSettings(message.payload);
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
        await clearAuthSession();
        await clearPendingDeviceAuth();
        logger.info("background", "GitHub disconnected");
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "SYNC_SUBMISSION") {
        sendResponse(await syncSubmission(message.payload));
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

      sendResponse({ ok: false, error: "Unsupported message" });
    } catch (error) {
      logger.error("background", "message handler failed", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  })();

  return true;
});
