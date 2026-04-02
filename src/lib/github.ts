import {
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL
} from "./constants";
import type {
  ExtensionSettings,
  GitHubAuthSession,
  PendingDeviceAuth,
  SubmissionPayload
} from "../types";

const GITHUB_API_URL = "https://api.github.com";

export async function startDeviceFlow(clientId: string, scope: string) {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description || data.error || "Failed to start device flow"
    );
  }

  return data;
}

export async function pollForAccessToken(
  clientId: string,
  pending: PendingDeviceAuth
): Promise<GitHubAuthSession | null> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      device_code: pending.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code"
    })
  });

  const data = await response.json();

  if (data.error) {
    if (data.error === "authorization_pending" || data.error === "slow_down") {
      return null;
    }

    throw new Error(
      data.error_description || data.error || "Failed to get access token"
    );
  }

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
    createdAt: Date.now()
  };
}

function languageToExtension(language: string): string {
  const value = language.toLowerCase();

  if (value.includes("python")) return "py";
  if (value.includes("javascript")) return "js";
  if (value.includes("typescript")) return "ts";
  if (value === "java") return "java";
  if (value.includes("c++")) return "cpp";
  if (value === "c") return "c";
  if (value.includes("c#")) return "cs";
  if (value === "go" || value.includes("golang")) return "go";
  if (value.includes("rust")) return "rs";

  return "txt";
}

function buildProblemFolder(problemNumber: string, slug: string): string {
  return `${problemNumber}-${slug}`;
}

function buildReadme(submission: SubmissionPayload): string {
  const parts = [
    submission.title,
    `Difficulty: ${submission.difficulty}`,
    "",
    submission.descriptionText.trim()
  ];

  if (submission.examplesText?.trim()) {
    parts.push("", submission.examplesText.trim());
  }

  if (submission.constraintsText?.trim()) {
    parts.push("", submission.constraintsText.trim());
  }

  if (submission.followUpText?.trim()) {
    parts.push("", submission.followUpText.trim());
  }

  return parts.join("\n");
}

async function githubRequest<T>(
  url: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("[github] request failed", {
      url,
      status: response.status,
      data
    });
    throw new Error(data.message || `GitHub request failed: ${response.status}`);
  }

  console.log("[github] request ok", { url, status: response.status });

  return data as T;
}

async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ commitSha: string; treeSha: string }> {
  const ref = await githubRequest<{ object: { sha: string } }>(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token
  );

  const commit = await githubRequest<{ tree: { sha: string } }>(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
    token
  );

  return {
    commitSha: ref.object.sha,
    treeSha: commit.tree.sha
  };
}

async function createBlob(
  token: string,
  owner: string,
  repo: string,
  content: string
): Promise<string> {
  const blob = await githubRequest<{ sha: string }>(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/blobs`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        content,
        encoding: "utf-8"
      })
    }
  );

  return blob.sha;
}

async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTreeSha: string,
  entries: Array<{ path: string; sha: string }>
): Promise<string> {
  const tree = await githubRequest<{ sha: string }>(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: entries.map((entry) => ({
          path: entry.path,
          mode: "100644",
          type: "blob",
          sha: entry.sha
        }))
      })
    }
  );

  return tree.sha;
}

async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string> {
  const commit = await githubRequest<{ sha: string }>(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha]
      })
    }
  );

  return commit.sha;
}

async function updateBranchRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  commitSha: string
): Promise<void> {
  await githubRequest(
    `${GITHUB_API_URL}/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({
        sha: commitSha,
        force: false
      })
    }
  );
}

export async function commitSubmission(params: {
  token: string;
  settings: ExtensionSettings;
  submission: SubmissionPayload;
}): Promise<{ commitSha: string; repoPath: string }> {
  const { token, settings, submission } = params;

  const folder = buildProblemFolder(submission.problemNumber, submission.slug);
  const codeFile = `${submission.slug}.${languageToExtension(submission.language)}`;

  const readmePath = `${folder}/README.md`;
  const solutionPath = `${folder}/${codeFile}`;

  const { commitSha: headCommitSha, treeSha } = await getBranchHead(
    token,
    settings.repoOwner,
    settings.repoName,
    settings.repoBranch
  );

  const readmeBlobSha = await createBlob(
    token,
    settings.repoOwner,
    settings.repoName,
    buildReadme(submission)
  );

  const solutionBlobSha = await createBlob(
    token,
    settings.repoOwner,
    settings.repoName,
    submission.code
  );

  const newTreeSha = await createTree(
    token,
    settings.repoOwner,
    settings.repoName,
    treeSha,
    [
      { path: readmePath, sha: readmeBlobSha },
      { path: solutionPath, sha: solutionBlobSha }
    ]
  );

  const commitSha = await createCommit(
    token,
    settings.repoOwner,
    settings.repoName,
    `${folder}: accepted submission in ${submission.language}`,
    newTreeSha,
    headCommitSha
  );

  await updateBranchRef(
    token,
    settings.repoOwner,
    settings.repoName,
    settings.repoBranch,
    commitSha
  );

  return {
    commitSha,
    repoPath: folder
  };
}
