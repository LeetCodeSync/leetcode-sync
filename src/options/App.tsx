import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS } from "@/lib/constants";

export default function App() {
  const [form, setForm] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");

  useEffect(() => {
    async function loadSettings() {
      const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });

      if (response.ok && response.data) {
        setForm(response.data);
      }
    }

    void loadSettings();
  }, []);

  function saveField(name: string, value: string | boolean) {
    setForm({
      ...form,
      [name]: value
    });
  }

  async function save() {
    const response = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      payload: form
    });

    if (response.ok) {
      setStatus("Saved.");
    } else {
      setStatus(response.error || "Save failed.");
    }
  }

  return (
    <div>
      <h1>Settings</h1>

      <div>
        <label>Client ID</label>
        <input
          value={form.githubClientId}
          onChange={(e) => saveField("githubClientId", e.target.value)}
        />
      </div>

      <div>
        <label>Scope</label>
        <select
          value={form.githubScope}
          onChange={(e) => saveField("githubScope", e.target.value)}
        >
          <option value="repo">repo</option>
          <option value="public_repo">public_repo</option>
        </select>
      </div>

      <div>
        <label>Repo owner</label>
        <input
          value={form.repoOwner}
          onChange={(e) => saveField("repoOwner", e.target.value)}
        />
      </div>

      <div>
        <label>Repo name</label>
        <input
          value={form.repoName}
          onChange={(e) => saveField("repoName", e.target.value)}
        />
      </div>

      <div>
        <label>Branch</label>
        <input
          value={form.repoBranch}
          onChange={(e) => saveField("repoBranch", e.target.value)}
        />
      </div>

      <div>
        <label>
          <input
            type="checkbox"
            checked={form.autoSyncAcceptedOnly}
            onChange={(e) =>
              saveField("autoSyncAcceptedOnly", e.target.checked)
            }
          />
          Accepted submissions only
        </label>
      </div>

      <button onClick={save}>Save settings</button>

      {status && <p>{status}</p>}
    </div>
  );
}
