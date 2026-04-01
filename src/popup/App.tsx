import { useEffect, useState } from "react";
import type { PendingDeviceAuth, RuntimeResponse } from "@/types";

interface AuthState {
  connected: boolean;
  pending: PendingDeviceAuth | null;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>({
    connected: false,
    pending: null
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  async function refreshState(): Promise<void> {
    const response = (await chrome.runtime.sendMessage({
      type: "GET_AUTH_STATE"
    })) as RuntimeResponse<AuthState>;

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

  async function connectGitHub(): Promise<void> {
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
      setMessage("Authorize on GitHub, then this popup will refresh automatically.");
    } else {
      setMessage(response.error ?? "Failed to start GitHub device flow.");
    }

    setLoading(false);
  }

  async function disconnectGitHub(): Promise<void> {
    setLoading(true);
    await chrome.runtime.sendMessage({ type: "DISCONNECT_GITHUB" });
    await refreshState();
    setLoading(false);
  }

  async function openOptions(): Promise<void> {
    await chrome.runtime.openOptionsPage();
  }

  async function openSidePanel(): Promise<void> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
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
          {!authState.connected ? (
            <button onClick={() => void connectGitHub()} disabled={loading}>
              Connect GitHub
            </button>
          ) : (
            <button
              className="danger"
              onClick={() => void disconnectGitHub()}
              disabled={loading}
            >
              Disconnect
            </button>
          )}

          <button className="secondary" onClick={() => void openOptions()}>
            Settings
          </button>

          <button className="secondary" onClick={() => void openSidePanel()}>
            Dashboard
          </button>
        </div>

        {message ? (
          <p className="muted" style={{ marginTop: 10 }}>
            {message}
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2>Behavior</h2>
        <p className="muted">
          On an accepted LeetCode submission, the extension creates or updates:
        </p>
        <div className="code" style={{ marginTop: 8 }}>
          /1-two-sum/{"\n"}README.md{"\n"}two-sum.py
        </div>
      </div>
    </div>
  );
}
