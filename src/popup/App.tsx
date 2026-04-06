import { useEffect, useMemo, useState } from "react";
import type {
  ExtensionSettings,
  PendingDeviceAuth,
  RuntimeResponse,
  SyncRecord
} from "../types";
import "./styles.css";

type AuthState = {
  connected: boolean;
  pending: PendingDeviceAuth | null;
};

type WeeklySummary = {
  total: number;
  easy: number;
  medium: number;
  hard: number;
  checks: boolean[];
};

type LatestSubmission = {
  title: string;
  difficulty: "Easy" | "Medium" | "Hard" | "Unknown";
  syncedAt?: string;
} | null;

type EditableField = "githubClientId" | "repositoryUrl" | "repoBranch" | null;

const APP_VERSION = "v0.1.0";

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "",
  githubScope: "repo",
  repositoryUrl: "",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

const ISSUES_URL = "https://github.com/pshynin/leetcode-github-sync/issues";

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

function parseRepository(url: string): { owner: string; repo: string } | null {
  const match = url
    .trim()
    .match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);

  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2]
  };
}

function getRepositoryLabel(url: string): string {
  const parsed = parseRepository(url);
  if (!parsed) return "Repository not set";
  return parsed.repo;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeekMonday(date: Date): Date {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setDate(date.getDate() + diffToMonday);
  return startOfLocalDay(start);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getSuccessfulRecords(history: SyncRecord[]): SyncRecord[] {
  return history.filter((record) => record.status === "success");
}

function getLatestSubmission(history: SyncRecord[]): LatestSubmission {
  const successful = getSuccessfulRecords(history).sort((a, b) => {
    return new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime();
  });

  const latest = successful[0];
  if (!latest) return null;

  return {
    title: latest.title,
    difficulty: latest.difficulty,
    syncedAt: latest.syncedAt
  };
}

function getWeeklySummary(history: SyncRecord[]): WeeklySummary {
  const now = new Date();
  const weekStart = startOfWeekMonday(now);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

  const successful = getSuccessfulRecords(history);

  const uniqueProblemsThisWeek = new Map<string, SyncRecord>();
  const checks = weekDays.map(() => false);

  for (const record of successful) {
    const date = new Date(record.syncedAt);
    if (Number.isNaN(date.getTime())) continue;

    if (date < weekStart || date >= addDays(weekStart, 7)) {
      continue;
    }

    const key = record.problemNumber || record.slug;
    const existing = uniqueProblemsThisWeek.get(key);

    if (
      !existing ||
      new Date(record.syncedAt).getTime() > new Date(existing.syncedAt).getTime()
    ) {
      uniqueProblemsThisWeek.set(key, record);
    }

    weekDays.forEach((weekDay, index) => {
      if (isSameLocalDay(date, weekDay)) {
        checks[index] = true;
      }
    });
  }

  let easy = 0;
  let medium = 0;
  let hard = 0;

  for (const record of uniqueProblemsThisWeek.values()) {
    if (record.difficulty === "Easy") easy += 1;
    else if (record.difficulty === "Medium") medium += 1;
    else if (record.difficulty === "Hard") hard += 1;
  }

  return {
    total: uniqueProblemsThisWeek.size,
    easy,
    medium,
    hard,
    checks
  };
}

function GitHubMark() {
  return (
    <svg
      className="repo-link__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12 2C6.48 2 2 6.58 2 12.22c0 4.5 2.87 8.31 6.84 9.66.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.21-3.37-1.21-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.58 2.35 1.12 2.92.86.09-.67.35-1.12.64-1.38-2.22-.26-4.56-1.15-4.56-5.1 0-1.13.39-2.06 1.03-2.79-.1-.26-.45-1.31.1-2.73 0 0 .85-.28 2.8 1.06A9.45 9.45 0 0 1 12 6.84c.85 0 1.7.12 2.5.35 1.95-1.34 2.8-1.06 2.8-1.06.56 1.42.21 2.47.1 2.73.64.73 1.03 1.66 1.03 2.79 0 3.96-2.35 4.83-4.58 5.08.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.59.69.49A10.19 10.19 0 0 0 22 12.22C22 6.58 17.52 2 12 2Z" />
    </svg>
  );
}

function startConnectErrorMessage(settings: ExtensionSettings): string | null {
  if (!settings.githubClientId.trim()) {
    return "Enter your GitHub OAuth App Client ID in Settings first.";
  }

  if (!settings.repositoryUrl.trim()) {
    return "Enter a GitHub repository URL in Settings first.";
  }

  if (!isValidRepositoryUrl(settings.repositoryUrl)) {
    return "Enter a valid GitHub repository URL in Settings.";
  }

  return null;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
    pending: null
  });
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [editingField, setEditingField] = useState<EditableField>(null);

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

  async function loadHistory() {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_SYNC_HISTORY"
    })) as RuntimeResponse<SyncRecord[]>;

    if (response.ok && response.data) {
      setHistory(response.data);
    }
  }

  useEffect(() => {
    void refreshState();
    void loadSettings();
    void loadHistory();
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

  const repositoryLabel = useMemo(
    () => getRepositoryLabel(settings.repositoryUrl),
    [settings.repositoryUrl]
  );

  const latestSubmission = useMemo(() => getLatestSubmission(history), [history]);
  const weeklySummary = useMemo(() => getWeeklySummary(history), [history]);

  const isRepoConnected =
    authState.connected &&
    settings.repositoryUrl.trim().length > 0 &&
    repositoryLabel !== "Repository not set";

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
      setEditingField(null);
    } else {
      setSettingsMessage(response.error ?? "Failed to save settings.");
    }

    setSettingsSaving(false);
  }

  async function connectGitHub() {
    setLoading(true);
    setMessage("");

    const validationError = startConnectErrorMessage(settings);
    if (validationError) {
      setMessage(validationError);
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
    setShowSettings(false);
  }

  async function openGitHubDevicePage() {
    if (!authState.pending?.verificationUri) return;
    await chrome.tabs.create({ url: authState.pending.verificationUri });
  }

  async function openIssuesPage() {
    await chrome.tabs.create({ url: ISSUES_URL });
  }

  async function openRepoPage() {
    if (!settings.repositoryUrl.trim()) return;
    await chrome.tabs.create({ url: settings.repositoryUrl.trim() });
  }

  function renderEditableRow(
    field: Exclude<EditableField, null>,
    label: string,
    value: string,
    onChange: (value: string) => void,
    placeholder?: string,
    hint?: string
  ) {
    const isEditing = editingField === field;

    return (
      <div className="settings-row">
        <div className="settings-row__header">
          <div className="settings-row__label">{label}</div>
          {!isEditing ? (
            <button
              className="settings-row__edit"
              onClick={() => setEditingField(field)}
            >
              Edit
            </button>
          ) : (
            <button
              className="settings-row__edit"
              onClick={() => setEditingField(null)}
            >
              Done
            </button>
          )}
        </div>

        {isEditing ? (
          <input
            className="settings-row__input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            autoFocus
          />
        ) : (
          <div className="settings-row__value">
            {value || placeholder || "Not set"}
          </div>
        )}

        {hint ? <div className="settings-row__hint">{hint}</div> : null}
      </div>
    );
  }

  return (
    <div className="popup-shell">
      <div className="dashboard-root">
        <div className="dashboard-header">
          <div className="dashboard-title-row">
            <div className="dashboard-title">LeetCode Sync</div>
            <div className="dashboard-version">{APP_VERSION}</div>
          </div>

          <button
            className="settings-button"
            onClick={() => setShowSettings(true)}
            aria-label="Open settings"
            title="Settings"
          >
            <span className="settings-button__icon">⚙</span>
            <span className="settings-button__text">Settings</span>
          </button>
        </div>

        <section className="hero-section">
          <div className="weekday-row weekday-row--labels">
            {["M", "T", "W", "T", "F", "S", "S"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="weekday-row">
            {weeklySummary.checks.map((checked, index) => (
              <div
                key={index}
                className={checked ? "weekday-check weekday-check--on" : "weekday-check"}
              >
                {checked ? "✓" : "×"}
              </div>
            ))}
          </div>

          <div className="stats-grid">
            <div className="stat-box stat-box--total">
              <div className="stat-box__value">{weeklySummary.total}</div>
              <div className="stat-box__label">Total</div>
            </div>
            <div className="stat-box stat-box--easy">
              <div className="stat-box__value">{weeklySummary.easy}</div>
              <div className="stat-box__label">Easy</div>
            </div>
            <div className="stat-box stat-box--medium">
              <div className="stat-box__value">{weeklySummary.medium}</div>
              <div className="stat-box__label">Medium</div>
            </div>
            <div className="stat-box stat-box--hard">
              <div className="stat-box__value">{weeklySummary.hard}</div>
              <div className="stat-box__label">Hard</div>
            </div>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="submission-row">
            <div className="submission-main">
              <div className="submission-title-line">
                <div className="problem-name">
                  {latestSubmission?.title ?? "No submissions yet"}
                </div>
                {latestSubmission ? (
                  <div className="difficulty-text difficulty-text--inline">
                    {latestSubmission.difficulty}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="submission-time">
              {formatRelativeTime(latestSubmission?.syncedAt)}
            </div>
          </div>
        </section>

        {authState.pending ? (
          <section className="dashboard-section dashboard-section--footer-meta">
            <div className="device-panel device-panel--embedded">
              <div className="device-panel__label">GitHub device code</div>
              <div className="device-panel__code">{authState.pending.userCode}</div>
              <div className="device-panel__url">
                {authState.pending.verificationUri}
              </div>
              <div className="device-panel__actions">
                <button
                  className="btn btn--primary btn--small"
                  onClick={() => void openGitHubDevicePage()}
                >
                  Open GitHub
                </button>
                <button
                  className="btn btn--secondary btn--small"
                  onClick={() => void refreshState()}
                >
                  Refresh
                </button>
              </div>
            </div>

            {message ? <div className="inline-message">{message}</div> : null}
          </section>
        ) : (
          <>
            <section className="dashboard-section dashboard-section--footer-meta">
              <div className="meta-row">
                {isRepoConnected ? (
                  <button
                    className="meta-link"
                    onClick={() => void openRepoPage()}
                    title={settings.repositoryUrl.trim()}
                  >
                    <GitHubMark />
                    <span>{repositoryLabel}</span>
                  </button>
                ) : (
                  <button
                    className="meta-cta"
                    onClick={() => void connectGitHub()}
                    disabled={loading}
                  >
                    Connect GitHub
                  </button>
                )}
              </div>
            </section>

            <footer className="dashboard-footer">
              <div className="dashboard-footer__row">
                <span className="dashboard-footer__text">Have feedback?</span>
                <div className="dashboard-footer__links">
                  <button
                    className="footer-link"
                    onClick={() => void openIssuesPage()}
                  >
                    Report issue
                  </button>
                </div>
              </div>
            </footer>

            {message ? <div className="inline-message">{message}</div> : null}
          </>
        )}
      </div>

      {showSettings ? (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">Settings</div>
              <button
                className="icon-button"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                ×
              </button>
            </div>

            <div className="settings-sheet">
              {renderEditableRow(
                "githubClientId",
                "GitHub OAuth App Client ID",
                settings.githubClientId,
                (value) => updateSetting("githubClientId", value),
                "Not set"
              )}

              {renderEditableRow(
                "repositoryUrl",
                "Repository URL",
                settings.repositoryUrl,
                (value) => updateSetting("repositoryUrl", value),
                "https://github.com/owner/repo",
                !repositoryUrlIsValid
                  ? "Enter a full GitHub URL like https://github.com/owner/repo"
                  : undefined
              )}

              {renderEditableRow(
                "repoBranch",
                "Branch",
                settings.repoBranch,
                (value) => updateSetting("repoBranch", value),
                "main"
              )}

              <div className="settings-row settings-row--toggle">
                <div className="settings-row__main">
                  <div className="settings-row__label">Private repository access</div>
                  <div className="settings-row__hint">
                    When on, access includes public and private repositories.
                  </div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.githubScope === "repo"}
                    onChange={(event) =>
                      updateSetting(
                        "githubScope",
                        event.target.checked ? "repo" : "public_repo"
                      )
                    }
                  />
                  <span className="toggle-switch__track" />
                </label>
              </div>

              <div className="settings-row settings-row--toggle">
                <div className="settings-row__main">
                  <div className="settings-row__label">Sync accepted submissions only</div>
                  <div className="settings-row__hint">
                    Recommended for normal use.
                  </div>
                </div>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={settings.autoSyncAcceptedOnly}
                    onChange={(event) =>
                      updateSetting("autoSyncAcceptedOnly", event.target.checked)
                    }
                  />
                  <span className="toggle-switch__track" />
                </label>
              </div>

              <div className="modal-actions modal-actions--sheet">
                <div className="modal-actions__left">
                  <button
                    className="btn btn--primary"
                    onClick={() => void saveSettings()}
                    disabled={settingsSaving}
                  >
                    Save
                  </button>
                </div>

                <div className="modal-actions__right">
                  {settingsMessage ? (
                    <div className="modal-actions__message">
                      {settingsMessage}
                    </div>
                  ) : null}
                </div>

                {authState.connected ? (
                  <button
                    className="btn btn--danger"
                    onClick={() => void disconnectGitHub()}
                    disabled={loading}
                  >
                    Disconnect
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
