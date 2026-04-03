import { useEffect, useMemo, useState } from "react";
import type {
  DashboardStats,
  ExtensionSettings,
  PendingDeviceAuth,
  RuntimeResponse
} from "../types";
import "../styles.css";

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

function isValidRepositoryUrl(value: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/?(\.git)?$/i.test(
    value.trim()
  );
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
    const response = (await chrome.runtime.sendMessage({
      type: "GET_AUTH_STATE"
    })) as RuntimeResponse<AuthState>;

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

  const repositoryUrlIsValid = useMemo(
    () =>
      settings.repositoryUrl.trim().length === 0 ||
      isValidRepositoryUrl(settings.repositoryUrl),
    [settings.repositoryUrl]
  );

  async function saveSettings() {
    setSettingsSaving(true);
    setSettingsMessage("");

    if (!settings.repositoryUrl.trim()) {
      setSettingsMessage("Repository URL is required.");
      setSettingsSaving(false);
      return;
    }

    if (!repositoryUrlIsValid) {
      setSettingsMessage("Enter a valid GitHub repository URL.");
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

    if (!settings.repositoryUrl.trim()) {
      setMessage("Enter a GitHub repository URL first.");
      setLoading(false);
      return;
    }

    if (!repositoryUrlIsValid) {
      setMessage("Enter a valid GitHub repository URL.");
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

  const statusLabel = authState.connected
    ? "Connected"
    : authState.pending
      ? "Pending"
      : "Disconnected";

  const statusClass = authState.connected
    ? "status-badge status-badge--success"
    : authState.pending
      ? "status-badge status-badge--pending"
      : "status-badge status-badge--neutral";

  return (
    <div className="popup-shell">
      <div className="popup-app">
        <header className="hero-card">
          <div className="hero-card__top">
            <div>
              <div className="eyebrow">Extension</div>
              <h1 className="hero-title">LeetCode GitHub Sync</h1>
              <p className="hero-subtitle">
                Sync accepted submissions into your GitHub repo with a clean history.
              </p>
            </div>

            <div className={statusClass}>{statusLabel}</div>
          </div>

          <div className="hero-card__actions">
            {!authState.connected && !authState.pending ? (
              <button
                className="btn btn--primary"
                onClick={() => void connectGitHub()}
                disabled={loading}
              >
                Connect GitHub
              </button>
            ) : null}

            {authState.pending && !authState.connected ? (
              <>
                <button
                  className="btn btn--primary"
                  onClick={() => void openGitHubDevicePage()}
                >
                  Open GitHub
                </button>
                <button
                  className="btn btn--secondary"
                  onClick={() => void refreshState()}
                >
                  Refresh status
                </button>
                <button
                  className="btn btn--secondary"
                  onClick={() => void disconnectGitHub()}
                >
                  Cancel
                </button>
              </>
            ) : null}

            {authState.connected ? (
              <button
                className="btn btn--danger"
                onClick={() => void disconnectGitHub()}
                disabled={loading}
              >
                Disconnect
              </button>
            ) : null}

            <button
              className="btn btn--secondary"
              onClick={() => setShowSettings((current) => !current)}
            >
              {showSettings ? "Hide settings" : "Settings"}
            </button>
          </div>

          {authState.pending && !authState.connected ? (
            <div className="device-code-panel">
              <div className="device-code-panel__label">
                Open GitHub and enter this code
              </div>
              <div className="device-code-panel__code">
                {authState.pending.userCode}
              </div>
              <div className="device-code-panel__url">
                {authState.pending.verificationUri}
              </div>
            </div>
          ) : null}

          {message ? <div className="inline-message">{message}</div> : null}
        </header>

        {!showSettings ? (
          <section className="surface-card">
            <div className="section-head">
              <div>
                <div className="section-kicker">Dashboard</div>
                <h2 className="section-title">Progress</h2>
              </div>

              <button
                className="btn btn--secondary btn--small"
                onClick={() => void loadDashboard()}
              >
                Refresh
              </button>
            </div>

            <div className="stats-grid">
              <div className="stat-tile">
                <div className="stat-tile__value">{dashboard.totalSolved}</div>
                <div className="stat-tile__label">Total</div>
              </div>

              <div className="stat-tile">
                <div className="stat-tile__value">{dashboard.easyCount}</div>
                <div className="stat-tile__label">Easy</div>
              </div>

              <div className="stat-tile">
                <div className="stat-tile__value">{dashboard.mediumCount}</div>
                <div className="stat-tile__label">Medium</div>
              </div>

              <div className="stat-tile">
                <div className="stat-tile__value">{dashboard.hardCount}</div>
                <div className="stat-tile__label">Hard</div>
              </div>
            </div>

            <div className="last-sync-card">
              <div className="last-sync-card__label">Last synced</div>
              <div className="last-sync-card__title">
                {dashboard.lastProblemTitle ?? "No syncs yet"}
              </div>
              <div className="last-sync-card__time">
                {formatRelativeTime(dashboard.lastSyncedAt)}
              </div>
            </div>
          </section>
        ) : (
          <section className="surface-card">
            <div className="section-head">
              <div>
                <div className="section-kicker">Configuration</div>
                <h2 className="section-title">Settings</h2>
              </div>
            </div>

            <div className="form-stack">
              <label className="field">
                <span className="field__label">GitHub OAuth App Client ID</span>
                <input
                  className="field__input"
                  value={settings.githubClientId}
                  onChange={(event) =>
                    updateSetting("githubClientId", event.target.value)
                  }
                />
              </label>

              <label className="field">
                <span className="field__label">Repository access</span>
                <select
                  className="field__input"
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
              </label>

              <label className="field">
                <span className="field__label">Repository URL</span>
                <input
                  className="field__input"
                  value={settings.repositoryUrl}
                  onChange={(event) =>
                    updateSetting("repositoryUrl", event.target.value)
                  }
                />
                {!repositoryUrlIsValid ? (
                  <span className="field__hint">
                    Enter a full GitHub URL like https://github.com/owner/repo
                  </span>
                ) : null}
              </label>

              <label className="field">
                <span className="field__label">Branch</span>
                <input
                  className="field__input"
                  value={settings.repoBranch}
                  onChange={(event) =>
                    updateSetting("repoBranch", event.target.value)
                  }
                />
              </label>

              <label className="toggle-row" htmlFor="acceptedOnly">
                <div>
                  <div className="toggle-row__title">Sync accepted submissions only</div>
                  <div className="toggle-row__subtitle">
                    Recommended for normal use.
                  </div>
                </div>
                <input
                  id="acceptedOnly"
                  type="checkbox"
                  checked={settings.autoSyncAcceptedOnly}
                  onChange={(event) =>
                    updateSetting("autoSyncAcceptedOnly", event.target.checked)
                  }
                />
              </label>

              <div className="settings-footer">
                <button
                  className="btn btn--primary"
                  onClick={() => void saveSettings()}
                  disabled={settingsSaving}
                >
                  Save settings
                </button>

                {settingsMessage ? (
                  <div className="inline-message inline-message--soft">
                    {settingsMessage}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
