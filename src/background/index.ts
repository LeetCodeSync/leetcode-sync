let isPolling = false;

async function beginDeviceAuth() {
    const setting = await getSettings();

    if (!setting.githubClientId) {
        return { ok: false, error: "Missing GitHub Client ID" };
    }

    const device = await startDeviceFlow(setting.)

  await savePendingDeviceAuth({});

    return { ok: true };
}
