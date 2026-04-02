import { useEffect, useState } from "react";
import { logger } from "../lib/logger";
import type { PendingDeviceAuth, RuntimeResponse } from "../types";

type AuthState = {
  connected: boolean;
  pending: PendingDeviceAuth | null;
};

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
    pending: null
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

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

  useEffect(() => {
    void refreshState();

    const interval = window.setInterval(() => {
      void refreshState();
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

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

  async function openOptions() {
    await chrome.runtime.openOptionsPage();
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

        <div className="row" style={{ marginTop: 10 }}>
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

          <button className="secondary" onClick={() => void openOptions()}>
            Settings
          </button>
        </div>

        {message ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
