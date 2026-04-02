import {
  clearAuthSession,
  clearPendingDeviceAuth,
  getAuthSession,
  getPendingDeviceAuth,
  getSettings,
  saveAuthSession,
  savePendingDeviceAuth,
  saveSettings
} from "@/lib/storage";
import { pollForAccessToken, startDeviceFlow } from "@/lib/github";

let isPolling = false;

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
        return;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, pending.intervalSeconds * 1000)
      );
    }

    await clearPendingDeviceAuth();
  } finally {
    isPolling = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === "GET_SETTINGS") {
        sendResponse({ ok: true, data: await getSettings() });
        return;
      }

      if (message.type === "SAVE_SETTINGS") {
        await saveSettings(message.payload);
        sendResponse({ ok: true });
        return;
      }

      if (message.type === "GET_AUTH_STATE") {
        const session = await getAuthSession();
        const pending = await getPendingDeviceAuth();

        sendResponse({
          ok: true,
          data: {
            connected: !!session?.accessToken,
            pending
          }
        });
        return;
      }

      if (message.type === "START_GITHUB_DEVICE_AUTH") {
        sendResponse(await beginDeviceAuth());
        return;
      }

      if (message.type === "DISCONNECT_GITHUB") {
        await clearAuthSession();
        await clearPendingDeviceAuth();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unsupported message" });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  })();

  return true;
});
