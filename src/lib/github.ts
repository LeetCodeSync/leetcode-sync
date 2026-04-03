import {
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_DEVICE_CODE_URL
} from "./constants";
import { AppError } from "./errors";
import { logger } from "./logger";
import type {
  ExtensionSettings,
  GitHubAuthSession,
  PendingDeviceAuth,
  SubmissionPayload
} from "../types";

const GITHUB_API_URL = "https://api.github.com";

export function parseGitHubRepoUrl(repositoryUrl: string): {
  owner: string;
  repo: string;
} | null {
  const value = repositoryUrl.trim();

  if (!value) return null;

  const normalized = value.endsWith(".git") ? value.slice(0, -4) : value;

  const match = normalized.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i
  );

  if (!match) {
    return null;
  }

  return {
    owner: match[1],
    repo: match[2]
  };
}

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

function formatSubmittedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function buildReadme(submission: SubmissionPayload): string {
  return [
    `# ${submission.title}`,
    "",
    `Difficulty: ${submission.difficulty}  `,
    `Language: ${submission.language}  `,
    `Submitted: ${formatSubmittedAt(submission.submittedAt)}  `,
    `LeetCode: ${submission.problemUrl}`
  ].join("\n");
}

function compactMetric(value?: string): string | null {
  if (!value) return null;
  const text = value.trim();
  return text ? text : null;
}

function buildCommitMessage(submission: SubmissionPayload): string {
  const base = `${buildProblemFolder(submission.problemNumber, submission.slug)}: accepted in ${submission.language}`;

  const parts = [base];

  const runtime = compactMetric(submission.runtime);
  const memory = compactMetric(submission.memory);

  if (runtime) {
    parts.push(`Time ${runtime}`);
  }

  if (memory) {
    parts.push(`Memory ${memory}`);
  }

  return parts.join(" | ");
}

function createGitHubRequestError(
  url: string,
  status: number,
  data: unknown
): AppError {
  const message =
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : `GitHub request failed: ${status}`;

  if (message.includes("Update is not a fast forward")) {
    return new AppError(
      "FAST_FORWARD_CONFLICT",
      "Repository changed during sync. Please try again.",
      message,
      { url, status, data }
    );
  }

  if (url.includes("/git/ref/heads/") && status === 404) {
    return new AppError(
      "BRANCH_NOT_FOUND",
      "Branch not found in the target repository.",
      message,
      { url, status, data }
    );
  }

  if (status === 401) {
    return new AppError(
      "GITHUB_AUTH_INVALID",
      "GitHub authorization expired or is invalid. Reconnect GitHub and try again.",
      message,
      { url, status, data }
    );
  }

  if (status === 403) {
    return new AppError(
      "REPOSITORY_NOT_ACCESSIBLE",
      "Repository is not accessible with the current GitHub account or scope.",
      message,
      { url, status, data }
    );
  }

  if (url.includes("/repos/") && status === 404) {
    return new AppError(
      "REPOSITORY_NOT_ACCESSIBLE",
      "Repository not found or not accessible with the current GitHub account.",
      message,
      { url, status, data }
    );
  }

  return new AppError(
    "UNKNOWN",
    "GitHub sync failed. Please try again.",
    message,
    { url, status, data }
  );
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
    logger.error("github", "request failed", {
      url,
      status: response.status,
      data
    });
    throw createGitHubRequestError(url, response.status, data);
  }

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

async function createCommitAttempt(params: {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  submission: SubmissionPayload;
}): Promise<{ commitSha: string; repoPath: string }> {
  const { token, owner, repo, branch, submission } = params;

  const folder = buildProblemFolder(submission.problemNumber, submission.slug);
  const codeFile = `${submission.slug}.${languageToExtension(submission.language)}`;

  const readmePath = `${folder}/README.md`;
  const solutionPath = `${folder}/${codeFile}`;

  const { commitSha: headCommitSha, treeSha } = await getBranchHead(
    token,
    owner,
    repo,
    branch
  );

  const readmeBlobSha = await createBlob(token, owner, repo, buildReadme(submission));
  const solutionBlobSha = await createBlob(token, owner, repo, submission.code);

  const newTreeSha = await createTree(token, owner, repo, treeSha, [
    { path: readmePath, sha: readmeBlobSha },
    { path: solutionPath, sha: solutionBlobSha }
  ]);

  const commitSha = await createCommit(
    token,
    owner,
    repo,
    buildCommitMessage(submission),
    newTreeSha,
    headCommitSha
  );

  await updateBranchRef(token, owner, repo, branch, commitSha);

  return {
    commitSha,
    repoPath: folder
  };
}

function isFastForwardConflict(error: unknown): boolean {
  return error instanceof AppError && error.code === "FAST_FORWARD_CONFLICT";
}

export async function commitSubmission(params: {
  token: string;
  settings: ExtensionSettings;
  submission: SubmissionPayload;
}): Promise<{ commitSha: string; repoPath: string }> {
  const { token, settings, submission } = params;

  const parsed = parseGitHubRepoUrl(settings.repositoryUrl);
  if (!parsed) {
    throw new AppError(
      "INVALID_REPOSITORY_URL",
      "Enter a valid GitHub repository URL.",
      "Repository URL is invalid.",
      { repositoryUrl: settings.repositoryUrl }
    );
  }

  const { owner, repo } = parsed;

  try {
    return await createCommitAttempt({
      token,
      owner,
      repo,
      branch: settings.repoBranch,
      submission
    });
  } catch (error) {
    if (!isFastForwardConflict(error)) {
      throw error;
    }

    logger.warn("github", "fast-forward conflict detected, retrying once", {
      repositoryUrl: settings.repositoryUrl,
      branch: settings.repoBranch,
      slug: submission.slug,
      submissionId: submission.submissionId
    });

    return await createCommitAttempt({
      token,
      owner,
      repo,
      branch: settings.repoBranch,
      submission
    });
  }
}
