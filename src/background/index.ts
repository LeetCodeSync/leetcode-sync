import {
  clearAuthSession,
  clearPendingDeviceAuth,
  getAuthSession,
  getPendingDeviceAuth,
  getSettings,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings
} from "../lib/storage";
import {
  commitSubmission,
  pollForAccessToken,
  startDeviceFlow
} from "../lib/github";
import { logger } from "../lib/logger";
import type { SubmissionPayload } from "../types";

let isPolling = false;

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

  void pollUntilAuthorized();

  return { ok: true, data: pending };
}

async function pollUntilAuthorized() {
  if (isPolling) return;
  isPolling = true;

  try {
    const settings = await getSettings();
    const pending = await getPendingDeviceAuth();

    if (!settings.githubClientId || !pending) return;

    while (Date.now() < pending.expiresAt) {
      const session = await pollForAccessToken(
        settings.githubClientId,
        pending
      );

      if (session) {
        await saveAuthSession(session);
        await clearPendingDeviceAuth();
        logger.info("background", "polling flow completed auth");
        return;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, pending.intervalSeconds * 1000)
      );
    }

    await clearPendingDeviceAuth();
    logger.warn("background", "pending auth expired during polling");
  } finally {
    isPolling = false;
  }
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
    owner: settings.repoOwner,
    repo: settings.repoName,
    branch: settings.repoBranch
  });

  if (!session?.accessToken) {
    logger.warn("background", "no GitHub token available");
    return { ok: false, error: "GitHub is not connected" };
  }

  if (!settings.repoOwner || !settings.repoName || !settings.repoBranch) {
    logger.warn("background", "repository settings are incomplete");
    return { ok: false, error: "Repository settings are incomplete" };
  }

  if (settings.autoSyncAcceptedOnly && !submission.accepted) {
    logger.info("background", "submission skipped because not accepted");
    return { ok: true };
  }

  try {
    const result = await commitSubmission({
      token: session.accessToken,
      settings,
      submission
    });

    logger.info("background", "commit success", result);
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync failure";

    if (message.includes("fast forward")) {
      logger.warn("background", "commit failed due to branch race", { message });
    } else {
      logger.error("background", "commit failed", error);
    }

    return {
      ok: false,
      error: message
    };
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
