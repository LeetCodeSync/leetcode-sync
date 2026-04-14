import { AppError } from "./errors";
import {
  __resetGitHubQueueStateForTests,
  commitSubmission,
  parseGitHubRepoUrl,
  pollForAccessToken,
  startDeviceFlow
} from "./github";
import type {
  ExtensionSettings,
  PendingDeviceAuth,
  SubmissionPayload
} from "../types";

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "client-123",
  githubScope: "repo",
  repositoryUrl: "https://github.com/pshynin/leetcode-private",
  repoBranch: "main",
};

const SAMPLE_SUBMISSION: SubmissionPayload = {
  problemNumber: "1",
  slug: "two-sum",
  title: "Two Sum",
  difficulty: "Easy",
  language: "TypeScript",
  code: "function twoSum() { return []; }",
  descriptionText: "Given an array of integers...",
  examplesText: "Example 1...",
  constraintsText: "Constraints...",
  followUpText: "Follow-up...",
  problemUrl: "https://leetcode.com/problems/two-sum/",
  submittedAt: "2026-04-10T18:00:00.000Z",
  accepted: true,
  submissionId: "1974823472",
  runtime: "1 ms",
  memory: "40 MB",
  runtimePercentile: 99,
  memoryPercentile: 88
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    json: async () => body
  } as Response;
}

function errorJson(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => body
  } as Response;
}

jest.mock("./logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe("src/lib/github.ts", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    __resetGitHubQueueStateForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("parseGitHubRepoUrl parses owner/repo correctly", () => {
    expect(parseGitHubRepoUrl("https://github.com/openai/chatgpt")).toEqual({
      owner: "openai",
      repo: "chatgpt"
    });

    expect(parseGitHubRepoUrl("https://github.com/openai/chatgpt.git")).toEqual({
      owner: "openai",
      repo: "chatgpt"
    });

    expect(parseGitHubRepoUrl("not-a-url")).toBeNull();
  });

  it("startDeviceFlow sends the correct request and returns parsed data", async () => {
    const mockResponse = {
      device_code: "device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5
    };

    global.fetch = jest.fn().mockResolvedValue(okJson(mockResponse));

    const result = await startDeviceFlow("client-123", "repo");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded"
        }),
        body: expect.any(URLSearchParams)
      })
    );

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = options.body as URLSearchParams;

    expect(body.get("client_id")).toBe("client-123");
    expect(body.get("scope")).toBe("repo");
    expect(result).toEqual(mockResponse);
  });

  it("startDeviceFlow throws a friendly error from GitHub response", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      errorJson(401, {
        error: "invalid_client",
        error_description: "GitHub client is invalid"
      })
    );

    await expect(startDeviceFlow("bad-client", "repo")).rejects.toThrow(
      "GitHub client is invalid"
    );
  });

  it("pollForAccessToken returns null when authorization is still pending", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue(
      okJson({
        error: "authorization_pending"
      })
    );

    const result = await pollForAccessToken("client-123", pending);

    expect(result).toBeNull();
  });

  it("pollForAccessToken returns null when GitHub asks to slow down", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue(
      okJson({
        error: "slow_down"
      })
    );

    const result = await pollForAccessToken("client-123", pending);

    expect(result).toBeNull();
  });

  it("pollForAccessToken returns a normalized session when token is available", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue(
      okJson({
        access_token: "token-123",
        token_type: "bearer",
        scope: "repo"
      })
    );

    const before = Date.now();
    const result = await pollForAccessToken("client-123", pending);
    const after = Date.now();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      accessToken: "token-123",
      tokenType: "bearer",
      scope: "repo",
      createdAt: expect.any(Number)
    });
    expect(result!.createdAt).toBeGreaterThanOrEqual(before);
    expect(result!.createdAt).toBeLessThanOrEqual(after);
  });

  it("pollForAccessToken throws on non-retryable GitHub errors", async () => {
    const pending: PendingDeviceAuth = {
      deviceCode: "device-1",
      userCode: "AAAA-BBBB",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60_000,
      intervalSeconds: 5
    };

    global.fetch = jest.fn().mockResolvedValue(
      okJson({
        error: "expired_token",
        error_description: "The device code expired"
      })
    );

    await expect(
      pollForAccessToken("client-123", pending)
    ).rejects.toThrow("The device code expired");
  });

  it("commitSubmission creates a commit successfully", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ object: { sha: "head-sha" } }))
      .mockResolvedValueOnce(okJson({ tree: { sha: "base-tree-sha" } }))
      .mockResolvedValueOnce(okJson({ sha: "readme-blob-sha" }))
      .mockResolvedValueOnce(okJson({ sha: "solution-blob-sha" }))
      .mockResolvedValueOnce(okJson({ sha: "new-tree-sha" }))
      .mockResolvedValueOnce(okJson({ sha: "commit-sha" }))
      .mockResolvedValueOnce(okJson({}));

    const result = await commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: SAMPLE_SUBMISSION
    });

    expect(result).toEqual({
      commitSha: "commit-sha",
      repoPath: "1-two-sum"
    });
    expect(global.fetch).toHaveBeenCalledTimes(7);
  });

  it("commitSubmission retries fast-forward conflicts with backoff", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ object: { sha: "head-sha-1" } }))
      .mockResolvedValueOnce(okJson({ tree: { sha: "base-tree-sha-1" } }))
      .mockResolvedValueOnce(okJson({ sha: "readme-blob-sha-1" }))
      .mockResolvedValueOnce(okJson({ sha: "solution-blob-sha-1" }))
      .mockResolvedValueOnce(okJson({ sha: "new-tree-sha-1" }))
      .mockResolvedValueOnce(okJson({ sha: "commit-sha-1" }))
      .mockResolvedValueOnce(
        errorJson(422, {
          message: "Update is not a fast forward"
        })
      )
      .mockResolvedValueOnce(okJson({ object: { sha: "head-sha-2" } }))
      .mockResolvedValueOnce(okJson({ tree: { sha: "base-tree-sha-2" } }))
      .mockResolvedValueOnce(okJson({ sha: "readme-blob-sha-2" }))
      .mockResolvedValueOnce(okJson({ sha: "solution-blob-sha-2" }))
      .mockResolvedValueOnce(okJson({ sha: "new-tree-sha-2" }))
      .mockResolvedValueOnce(okJson({ sha: "commit-sha-2" }))
      .mockResolvedValueOnce(okJson({}));

    const promise = commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: SAMPLE_SUBMISSION
    });

    await Promise.resolve();
    await jest.runOnlyPendingTimersAsync();

    const result = await promise;

    expect(result).toEqual({
      commitSha: "commit-sha-2",
      repoPath: "1-two-sum"
    });
    expect(global.fetch).toHaveBeenCalledTimes(14);
  });

  it("commitSubmission throws after bounded fast-forward retries are exhausted", async () => {
    const responses: Response[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(okJson({ object: { sha: `head-sha-${attempt}` } }));
      responses.push(okJson({ tree: { sha: `base-tree-sha-${attempt}` } }));
      responses.push(okJson({ sha: `readme-blob-sha-${attempt}` }));
      responses.push(okJson({ sha: `solution-blob-sha-${attempt}` }));
      responses.push(okJson({ sha: `new-tree-sha-${attempt}` }));
      responses.push(okJson({ sha: `commit-sha-${attempt}` }));
      responses.push(
        errorJson(422, {
          message: "Update is not a fast forward"
        })
      );
    }

    global.fetch = jest.fn();
    for (const response of responses) {
      (global.fetch as jest.Mock).mockResolvedValueOnce(response);
    }

    const promise = commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: SAMPLE_SUBMISSION
    });

    const assertion = expect(promise).rejects.toMatchObject({
      code: "FAST_FORWARD_CONFLICT"
    });

    await Promise.resolve();
    await jest.runAllTimersAsync();
    await assertion;

    expect(global.fetch).toHaveBeenCalledTimes(28);
  });

  it("serializes commits per branch so a second submission waits for the first", async () => {
    let releaseFirstPatch: (() => void) | undefined;
    let firstPatchStarted = false;
    let secondRefReadStarted = false;
    let notifyFirstPatchStarted!: () => void;

    const firstPatchStartedPromise = new Promise<void>((resolve) => {
      notifyFirstPatchStarted = resolve;
    });

    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/git/refs/heads/main") && !init?.method) {
        if (!firstPatchStarted) {
          return Promise.resolve(okJson({ object: { sha: "head-sha-1" } }));
        }

        secondRefReadStarted = true;
        return Promise.resolve(okJson({ object: { sha: "head-sha-2" } }));
      }

      if (url.includes("/git/commits/")) {
        return Promise.resolve(okJson({ tree: { sha: "base-tree-sha" } }));
      }

      if (url.endsWith("/git/blobs")) {
        return Promise.resolve(okJson({ sha: "blob-sha" }));
      }

      if (url.endsWith("/git/trees")) {
        return Promise.resolve(okJson({ sha: "tree-sha" }));
      }

      if (url.endsWith("/git/commits") && init?.method === "POST") {
        return Promise.resolve(okJson({ sha: "commit-sha" }));
      }

      if (url.endsWith("/git/refs/heads/main") && init?.method === "PATCH") {
        if (!firstPatchStarted) {
          firstPatchStarted = true;
          notifyFirstPatchStarted();

          return new Promise((resolve) => {
            releaseFirstPatch = () => resolve(okJson({}));
          });
        }

        return Promise.resolve(okJson({}));
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as jest.Mock;

    const first = commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: SAMPLE_SUBMISSION
    });

    await firstPatchStartedPromise;

    const second = commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: {
        ...SAMPLE_SUBMISSION,
        submissionId: "1974823999",
        slug: "valid-anagram",
        problemNumber: "242",
        title: "Valid Anagram"
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(secondRefReadStarted).toBe(false);
    expect(typeof releaseFirstPatch).toBe("function");

    releaseFirstPatch?.();
    await first;
    await second;

    expect(secondRefReadStarted).toBe(true);
  });

  it("uses separate queues for different branches", async () => {
    let mainPatchStarted = false;
    let devRefReadStarted = false;
    let releaseMainPatch: (() => void) | undefined;
    let notifyMainPatchStarted!: () => void;

    const mainPatchStartedPromise = new Promise<void>((resolve) => {
      notifyMainPatchStarted = resolve;
    });

    global.fetch = jest.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/git/refs/heads/main") && !init?.method) {
        return Promise.resolve(okJson({ object: { sha: "main-head" } }));
      }

      if (url.endsWith("/git/refs/heads/dev") && !init?.method) {
        devRefReadStarted = true;
        return Promise.resolve(okJson({ object: { sha: "dev-head" } }));
      }

      if (url.includes("/git/commits/")) {
        return Promise.resolve(okJson({ tree: { sha: "base-tree-sha" } }));
      }

      if (url.endsWith("/git/blobs")) {
        return Promise.resolve(okJson({ sha: "blob-sha" }));
      }

      if (url.endsWith("/git/trees")) {
        return Promise.resolve(okJson({ sha: "tree-sha" }));
      }

      if (url.endsWith("/git/commits") && init?.method === "POST") {
        return Promise.resolve(okJson({ sha: "commit-sha" }));
      }

      if (url.endsWith("/git/refs/heads/main") && init?.method === "PATCH") {
        if (!mainPatchStarted) {
          mainPatchStarted = true;
          notifyMainPatchStarted();

          return new Promise((resolve) => {
            releaseMainPatch = () => resolve(okJson({}));
          });
        }

        return Promise.resolve(okJson({}));
      }

      if (url.endsWith("/git/refs/heads/dev") && init?.method === "PATCH") {
        return Promise.resolve(okJson({}));
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    }) as jest.Mock;

    const first = commitSubmission({
      token: "token-123",
      settings: DEFAULT_SETTINGS,
      submission: SAMPLE_SUBMISSION
    });

    await mainPatchStartedPromise;

    const second = commitSubmission({
      token: "token-123",
      settings: {
        ...DEFAULT_SETTINGS,
        repoBranch: "dev"
      },
      submission: {
        ...SAMPLE_SUBMISSION,
        submissionId: "1974825000"
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(devRefReadStarted).toBe(true);
    expect(typeof releaseMainPatch).toBe("function");

    releaseMainPatch?.();
    await first;
    await second;
  });
});
