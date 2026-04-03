import { useEffect, useState } from "react";
import { logger } from "../lib/logger";
import type {
  DashboardStats,
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
  repositoryUrl: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

const EMPTY_DASHBOARD: DashboardStats = {
  totalSolved: 0,
  easyCount: 0,
  mediumCount: 0,
  hardCount: 0
};

function formatRelativeTime(value?: string): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
    pending: null
  });
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [dashboard, setDashboard] = useState<DashboardStats>(EMPTY_DASHBOARD);
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

  async function loadDashboard() {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_DASHBOARD_STATS"
    })) as RuntimeResponse<DashboardStats>;

    if (response.ok && response.data) {
      setDashboard(response.data);
    }
  }

  useEffect(() => {
    void refreshState();
    void loadSettings();
    void loadDashboard();
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

    if (!settings.repositoryUrl.trim()) {
      setSettingsMessage("Repository URL is required.");
      setSettingsSaving(false);
      return;
    }

    if (!settings.repoBranch.trim()) {
      setSettingsMessage("Branch is required.");
      setSettingsSaving(false);
      return;
    }

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

    if (!settings.githubClientId.trim()) {
      setMessage("Enter your GitHub OAuth App Client ID first.");
      setLoading(false);
      return;
    }

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
            <div className="card inner-card">
              <div className="kpi">{authState.pending.userCode}</div>
              <div className="muted" style={{ marginTop: 6 }}>
                {authState.pending.verificationUri}
              </div>
            </div>
          </div>
        ) : null}

        <div className="row action-row">
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

        {message ? <p className="muted top-gap">{message}</p> : null}
      </div>

      {!showSettings ? (
        <div className="card compact-card">
          <div className="row-between">
            <h2>Progress</h2>
            <button className="secondary" onClick={() => void loadDashboard()}>
              Refresh
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <div className="stat-value">{dashboard.totalSolved}</div>
              <div className="stat-label">Total</div>
            </div>

            <div className="stat-box">
              <div className="stat-value">{dashboard.easyCount}</div>
              <div className="stat-label">Easy</div>
            </div>

            <div className="stat-box">
              <div className="stat-value">{dashboard.mediumCount}</div>
              <div className="stat-label">Medium</div>
            </div>

            <div className="stat-box">
              <div className="stat-value">{dashboard.hardCount}</div>
              <div className="stat-label">Hard</div>
            </div>
          </div>

          <div className="last-sync">
            <div className="last-sync-title">Last synced</div>
            <div className="last-sync-problem">
              {dashboard.lastProblemTitle ?? "No syncs yet"}
            </div>
            <div className="muted">
              {formatRelativeTime(dashboard.lastSyncedAt)}
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="card compact-card">
          <h2>Settings</h2>

          <div className="form-group">
            <label htmlFor="clientId">GitHub OAuth App Client ID</label>
            <input
              id="clientId"
              value={settings.githubClientId}
              onChange={(event) =>
                updateSetting("githubClientId", event.target.value)
              }
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
            <label htmlFor="repositoryUrl">Repository URL</label>
            <input
              id="repositoryUrl"
              value={settings.repositoryUrl}
              onChange={(event) =>
                updateSetting("repositoryUrl", event.target.value)
              }
            />
          </div>

          <div className="form-group">
            <label htmlFor="repoBranch">Branch</label>
            <input
              id="repoBranch"
              value={settings.repoBranch}
              onChange={(event) => updateSetting("repoBranch", event.target.value)}
            />
          </div>

          <label className="checkbox-row" htmlFor="acceptedOnly">
            <span>Sync accepted submissions only</span>
            <input
              id="acceptedOnly"
              type="checkbox"
              checked={settings.autoSyncAcceptedOnly}
              onChange={(event) =>
                updateSetting("autoSyncAcceptedOnly", event.target.checked)
              }
            />
          </label>

          <div className="row top-gap">
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
