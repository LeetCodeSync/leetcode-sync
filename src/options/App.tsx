import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS } from "@/lib/constants";
import type { ExtensionSettings, RuntimeResponse } from "@/types";

export default function App() {
  const [form, setForm] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");

  useEffect(() => {
    void (async () => {
      const response = (await chrome.runtime.sendMessage({
        type: "GET_SETTINGS"
      })) as RuntimeResponse<ExtensionSettings>;

      if (response.ok && response.data) {
        setForm(response.data);
      }
    })();
  }, []);

  function update<K extends keyof ExtensionSettings>(
    key: K,
    value: ExtensionSettings[K]
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(): Promise<void> {
    const response = (await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: form
    })) as RuntimeResponse;

    setStatus(response.ok ? "Saved." : response.error ?? "Save failed.");
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Settings</h1>

      <div className="card">
        <h2>GitHub OAuth App</h2>

        <div className="form-group">
          <label htmlFor="clientId">Client ID</label>
          <input
            id="clientId"
            value={form.githubClientId}
            onChange={(event) => update("githubClientId", event.target.value)}
            placeholder="GitHub OAuth App Client ID"
          />
        </div>

        <div className="form-group">
          <label htmlFor="scope">Scope</label>
          <select
            id="scope"
            value={form.githubScope}
            onChange={(event) =>
              update("githubScope", event.target.value as ExtensionSettings["githubScope"])
            }
          >
            <option value="repo">repo</option>
            <option value="public_repo">public_repo</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2>Repository</h2>

        <div className="grid grid-2">
          <div className="form-group">
            <label htmlFor="repoOwner">Owner</label>
            <input
              id="repoOwner"
              value={form.repoOwner}
              onChange={(event) => update("repoOwner", event.target.value)}
              placeholder="your-github-name"
            />
          </div>

          <div className="form-group">
            <label htmlFor="repoName">Repository</label>
            <input
              id="repoName"
              value={form.repoName}
              onChange={(event) => update("repoName", event.target.value)}
              placeholder="leetcode-solutions"
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="repoBranch">Branch</label>
          <input
            id="repoBranch"
            value={form.repoBranch}
            onChange={(event) => update("repoBranch", event.target.value)}
            placeholder="main"
          />
        </div>
      </div>

      <div className="card">
        <h2>Sync</h2>

        <div className="row-between">
          <div>
            <h3>Accepted submissions only</h3>
            <p className="muted">
              Keep this on if you only want commits for successful solutions.
            </p>
          </div>

          <input
            type="checkbox"
            checked={form.autoSyncAcceptedOnly}
            onChange={(event) => update("autoSyncAcceptedOnly", event.target.checked)}
            style={{ width: 18, height: 18 }}
          />
        </div>
      </div>

      <div className="row">
        <button onClick={() => void save()}>Save settings</button>
        {status ? <span className="muted">{status}</span> : null}
      </div>
    </div>
  );
}
