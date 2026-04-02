import { useEffect, useState } from "react";
import { logger } from "../lib/logger";
import type {
  ExtensionSettings,
  PendingDeviceAuth,
  RuntimeResponse
} from "../types";

type AuthState = {
  connected: boolean;
  pending: PendingDeviceAuth | null;
};

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "",
  githubScope: "repo",
  repoOwner: "",
  repoName: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
    pending: null
  });
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  async function refreshState() {
    logger.debug("popup", "refreshState called");

    const response = (await chrome.runtime.sendMessage({
      type: "GET_AUTH_STATE"
    })) as RuntimeResponse<AuthState>;

    logger.debug("popup", "refreshState response", response);

    if (response.ok && response.data) {
      setAuthState(response.data);
    }
  }

  async function loadSettings() {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_SETTINGS"
    })) as RuntimeResponse<ExtensionSettings>;

    if (response.ok && response.data) {
      setSettings(response.data);
    }
  }

  useEffect(() => {
    void refreshState();
    void loadSettings();
  }, []);

  function updateSetting<K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ) {
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsMessage("");

    const response = (await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: settings
    })) as RuntimeResponse;

    if (response.ok) {
      setSettingsMessage("Settings saved.");
    } else {
      setSettingsMessage(response.error ?? "Failed to save settings.");
    }

    setSettingsSaving(false);
  }

  async function connectGitHub() {
    setLoading(true);
    setMessage("");

    const response = (await chrome.runtime.sendMessage({
      type: "START_GITHUB_DEVICE_AUTH"
    })) as RuntimeResponse<PendingDeviceAuth>;

    if (response.ok && response.data) {
      setAuthState((current) => ({
        ...current,
        pending: response.data ?? null
      }));
      setMessage("Authorize on GitHub using the code below.");
    } else {
      setMessage(response.error ?? "Failed to start GitHub auth.");
    }

    setLoading(false);
  }

  async function disconnectGitHub() {
    setLoading(true);
    await chrome.runtime.sendMessage({ type: "DISCONNECT_GITHUB" });
    await refreshState();
    setLoading(false);
  }

  async function openGitHubDevicePage() {
    if (!authState.pending?.verificationUri) return;
    await chrome.tabs.create({ url: authState.pending.verificationUri });
  }

  return (
    <div className="page">
      <h1>LeetCode GitHub Sync</h1>

      <div className="card">
        <div className="row-between">
          <h2>GitHub</h2>
          {authState.connected ? (
            <span className="badge ok">Connected</span>
          ) : authState.pending ? (
            <span className="badge warn">Pending</span>
          ) : (
            <span className="badge error">Disconnected</span>
          )}
        </div>

        {authState.pending && !authState.connected ? (
          <div style={{ marginTop: 10 }}>
            <p className="muted">Open GitHub and enter this code:</p>
            <div className="card" style={{ marginTop: 8, marginBottom: 8 }}>
              <div className="kpi">{authState.pending.userCode}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {authState.pending.verificationUri}
              </div>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {!authState.connected && !authState.pending ? (
            <button onClick={() => void connectGitHub()} disabled={loading}>
              Connect GitHub
            </button>
          ) : null}

          {authState.pending && !authState.connected ? (
            <>
              <button onClick={() => void openGitHubDevicePage()}>
                Open GitHub
              </button>
              <button className="secondary" onClick={() => void refreshState()}>
                Refresh status
              </button>
              <button className="secondary" onClick={() => void disconnectGitHub()}>
                Cancel
              </button>
            </>
          ) : null}

          {authState.connected ? (
            <button
              className="danger"
              onClick={() => void disconnectGitHub()}
              disabled={loading}
            >
              Disconnect
            </button>
          ) : null}

          <button
            className="secondary"
            onClick={() => setShowSettings((current) => !current)}
          >
            {showSettings ? "Hide settings" : "Settings"}
          </button>
        </div>

        {message ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {message}
          </p>
        ) : null}
      </div>

      {showSettings ? (
        <div className="card">
          <h2>Settings</h2>

          <div className="form-group">
            <label htmlFor="clientId">GitHub OAuth App Client ID</label>
            <input
              id="clientId"
              value={settings.githubClientId}
              onChange={(event) =>
                updateSetting("githubClientId", event.target.value)
              }
              placeholder="GitHub OAuth App Client ID"
            />
          </div>

          <div className="form-group">
            <label htmlFor="scope">Repository access</label>
            <select
              id="scope"
              value={settings.githubScope}
              onChange={(event) =>
                updateSetting(
                  "githubScope",
                  event.target.value as ExtensionSettings["githubScope"]
                )
              }
            >
              <option value="repo">Public and private repositories</option>
              <option value="public_repo">Public repositories only</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="repoOwner">Repository owner</label>
            <input
              id="repoOwner"
              value={settings.repoOwner}
              onChange={(event) => updateSetting("repoOwner", event.target.value)}
              placeholder="pshynin"
            />
          </div>

          <div className="form-group">
            <label htmlFor="repoName">Repository name</label>
            <input
              id="repoName"
              value={settings.repoName}
              onChange={(event) => updateSetting("repoName", event.target.value)}
              placeholder="leetcode-private"
            />
          </div>

          <div className="form-group">
            <label htmlFor="repoBranch">Branch</label>
            <input
              id="repoBranch"
              value={settings.repoBranch}
              onChange={(event) => updateSetting("repoBranch", event.target.value)}
              placeholder="main"
            />
          </div>

          <div className="row-between" style={{ marginTop: 8 }}>
            <div>
              <h3>Sync accepted submissions only</h3>
              <p className="muted">
                Recommended for normal use.
              </p>
            </div>

            <input
              type="checkbox"
              checked={settings.autoSyncAcceptedOnly}
              onChange={(event) =>
                updateSetting("autoSyncAcceptedOnly", event.target.checked)
              }
              style={{ width: 18, height: 18 }}
            />
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={() => void saveSettings()} disabled={settingsSaving}>
              Save settings
            </button>

            {settingsMessage ? (
              <span className="muted">{settingsMessage}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
