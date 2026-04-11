import { AppError } from "../lib/errors";
import type {
  ExtensionSettings,
  GitHubAuthSession,
  SubmissionPayload
} from "../types";

jest.mock("../lib/storage", () => ({
  appendSyncRecord: jest.fn(),
  clearAuthSession: jest.fn(),
  clearPendingDeviceAuth: jest.fn(),
  clearSyncState: jest.fn(),
  getAuthSession: jest.fn(),
  getDashboardStats: jest.fn(),
  getPendingDeviceAuth: jest.fn(),
  getSettings: jest.fn(),
  getSyncHistory: jest.fn(),
  getSyncState: jest.fn(),
  saveAuthSession: jest.fn(),
  savePendingDeviceAuth: jest.fn(),
  saveSettings: jest.fn(),
  saveSyncState: jest.fn()
}));

jest.mock("../lib/github", () => ({
  commitSubmission: jest.fn(),
  parseGitHubRepoUrl: jest.fn(),
  pollForAccessToken: jest.fn(),
  startDeviceFlow: jest.fn()
}));

jest.mock("../lib/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import * as storage from "../lib/storage";
import * as github from "../lib/github";
import {
  __resetHandlerStateForTests,
  ATTEMPT_COOLDOWN_MS,
  buildSubmissionKey,
  checkPendingAuth,
  cleanupRecentAttempts,
  disconnectGitHub,
  handleCompletedRequest,
  handleRuntimeMessage,
  isLeetCodeSubmitRequest,
  MAX_TAB_MESSAGE_ATTEMPTS,
  SUBMIT_TRIGGER_DELAY_MS,
  TAB_MESSAGE_RETRY_DELAY_MS,
  syncSubmission,
  triggerAcceptedSubmissionFetch
} from "./handlers";

const mockedStorage = storage as jest.Mocked<typeof storage>;
const mockedGithub = github as jest.Mocked<typeof github>;

const DEFAULT_SETTINGS: ExtensionSettings = {
  githubClientId: "client-id",
  githubScope: "repo",
  repositoryUrl: "https://github.com/pshynin/leetcode-private",
  repoBranch: "main",
  autoSyncAcceptedOnly: true
};

const DEFAULT_SESSION: GitHubAuthSession = {
  accessToken: "token",
  tokenType: "bearer",
  scope: "repo",
  createdAt: Date.now()
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

function createChromeMock() {
  const sendMessage = jest.fn(
    (_tabId: number, _message: unknown, callback?: () => void) => {
      (global as any).chrome.runtime.lastError = undefined;
      callback?.();
    }
  );

  Object.defineProperty(global, "chrome", {
    value: {
      runtime: {
        lastError: undefined as { message: string } | undefined
      },
      tabs: {
        sendMessage
      }
    },
    writable: true,
    configurable: true
  });

  return { sendMessage };
}

function createResponder() {
  return jest.fn();
}

describe("background/handlers", () => {
  beforeEach(() => {
    __resetHandlerStateForTests();
    jest.clearAllMocks();
    jest.useFakeTimers();

    createChromeMock();

    mockedStorage.getSettings.mockResolvedValue(DEFAULT_SETTINGS);
    mockedStorage.getAuthSession.mockResolvedValue(DEFAULT_SESSION);
    mockedStorage.getPendingDeviceAuth.mockResolvedValue(null);
    mockedStorage.getSyncHistory.mockResolvedValue([]);
    mockedStorage.getDashboardStats.mockResolvedValue({
      totalSolved: 0,
      easyCount: 0,
      mediumCount: 0,
      hardCount: 0
    });
    mockedStorage.getSyncState.mockResolvedValue({ status: "idle" });
    mockedStorage.saveSyncState.mockResolvedValue(undefined);
    mockedStorage.clearSyncState.mockResolvedValue(undefined);
    mockedStorage.appendSyncRecord.mockResolvedValue(undefined);
    mockedStorage.saveSettings.mockResolvedValue(undefined);
    mockedStorage.saveAuthSession.mockResolvedValue(undefined);
    mockedStorage.savePendingDeviceAuth.mockResolvedValue(undefined);
    mockedStorage.clearAuthSession.mockResolvedValue(undefined);
    mockedStorage.clearPendingDeviceAuth.mockResolvedValue(undefined);

    mockedGithub.parseGitHubRepoUrl.mockReturnValue({
      owner: "pshynin",
      repo: "leetcode-private"
    });
    mockedGithub.commitSubmission.mockResolvedValue({
      commitSha: "abc123",
      repoPath: "1-two-sum"
    });
    mockedGithub.pollForAccessToken.mockResolvedValue(null);
    mockedGithub.startDeviceFlow.mockResolvedValue({
      device_code: "device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("pure helpers", () => {
    it("buildSubmissionKey uses submissionId when present", () => {
      expect(buildSubmissionKey(SAMPLE_SUBMISSION)).toBe("submission:1974823472");
    });

    it("buildSubmissionKey falls back to payload fingerprint when submissionId is missing", () => {
      const key = buildSubmissionKey({
        ...SAMPLE_SUBMISSION,
        submissionId: undefined
      });

      expect(key).toContain("1");
      expect(key).toContain("two-sum");
      expect(key).toContain("TypeScript");
    });

    it("recognizes a valid LeetCode submit request", () => {
      expect(
        isLeetCodeSubmitRequest({
          tabId: 123,
          method: "POST",
          statusCode: 200,
          url: "https://leetcode.com/problems/two-sum/submit/"
        })
      ).toBe(true);
    });

    it("rejects a non-submit request", () => {
      expect(
        isLeetCodeSubmitRequest({
          tabId: 123,
          method: "GET",
          statusCode: 200,
          url: "https://leetcode.com/problems/two-sum/"
        })
      ).toBe(false);
    });

    it("cleanupRecentAttempts removes expired entries without throwing", () => {
      expect(() => cleanupRecentAttempts(Date.now() + ATTEMPT_COOLDOWN_MS + 1)).not.toThrow();
    });
  });

  describe("submit-trigger flow", () => {
    it("triggerAcceptedSubmissionFetch sends tab message after delay", () => {
      const { sendMessage } = createChromeMock();

      triggerAcceptedSubmissionFetch(7);

      expect(sendMessage).not.toHaveBeenCalled();

      jest.advanceTimersByTime(SUBMIT_TRIGGER_DELAY_MS);

      expect(sendMessage).toHaveBeenCalledWith(
        7,
        { type: "FETCH_LATEST_ACCEPTED_SUBMISSION" },
        expect.any(Function)
      );

      expect(mockedStorage.saveSyncState).not.toHaveBeenCalled();
    });

    it("retries delivery when receiving end does not exist", () => {
      const { sendMessage } = createChromeMock();

      sendMessage.mockImplementation(
        (_tabId: number, _message: unknown, callback?: () => void) => {
          const attempt = sendMessage.mock.calls.length;

          if (attempt < 3) {
            (global as any).chrome.runtime.lastError = {
              message: "Could not establish connection. Receiving end does not exist."
            };
          } else {
            (global as any).chrome.runtime.lastError = undefined;
          }

          callback?.();
        }
      );

      triggerAcceptedSubmissionFetch(9);

      jest.advanceTimersByTime(SUBMIT_TRIGGER_DELAY_MS);
      expect(sendMessage).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(TAB_MESSAGE_RETRY_DELAY_MS);
      expect(sendMessage).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(TAB_MESSAGE_RETRY_DELAY_MS);
      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    it("stops retrying after the max attempts", () => {
      const { sendMessage } = createChromeMock();

      sendMessage.mockImplementation(
        (_tabId: number, _message: unknown, callback?: () => void) => {
          (global as any).chrome.runtime.lastError = {
            message: "Could not establish connection. Receiving end does not exist."
          };
          callback?.();
        }
      );

      triggerAcceptedSubmissionFetch(9);

      jest.advanceTimersByTime(
        SUBMIT_TRIGGER_DELAY_MS +
          TAB_MESSAGE_RETRY_DELAY_MS * (MAX_TAB_MESSAGE_ATTEMPTS + 2)
      );

      expect(sendMessage).toHaveBeenCalledTimes(MAX_TAB_MESSAGE_ATTEMPTS);
    });

    it("handleCompletedRequest triggers fetch only for valid submit requests", () => {
      const spy = jest.spyOn(global, "setTimeout");

      handleCompletedRequest({
        tabId: 10,
        method: "POST",
        statusCode: 200,
        url: "https://leetcode.com/problems/two-sum/submit/"
      });

      expect(spy).toHaveBeenCalled();

      spy.mockClear();

      handleCompletedRequest({
        tabId: 10,
        method: "GET",
        statusCode: 200,
        url: "https://leetcode.com/problems/two-sum/"
      });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("syncSubmission", () => {
    it("sets syncing state when sync starts", async () => {
      const response = await syncSubmission(SAMPLE_SUBMISSION);

      expect(response).toEqual({
        ok: true,
        data: {
          commitSha: "abc123",
          repoPath: "1-two-sum"
        }
      });

      expect(mockedStorage.saveSyncState).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          status: "syncing",
          submissionId: SAMPLE_SUBMISSION.submissionId,
          title: SAMPLE_SUBMISSION.title
        })
      );
    });

    it("sets idle state and appends success record on success", async () => {
      await syncSubmission(SAMPLE_SUBMISSION);

      expect(mockedStorage.saveSyncState).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          status: "idle",
          submissionId: SAMPLE_SUBMISSION.submissionId
        })
      );

      expect(mockedStorage.appendSyncRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "success",
          slug: SAMPLE_SUBMISSION.slug,
          submissionId: SAMPLE_SUBMISSION.submissionId,
          commitSha: "abc123"
        })
      );
    });

    it("sets error state and appends failure record on failure", async () => {
      mockedGithub.commitSubmission.mockRejectedValueOnce(new Error("boom"));

      const response = await syncSubmission(SAMPLE_SUBMISSION);

      expect(response).toEqual({
        ok: false,
        error: "Something went wrong. Please try again."
      });

      expect(mockedStorage.saveSyncState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "error",
          submissionId: SAMPLE_SUBMISSION.submissionId,
          error: "Something went wrong. Please try again."
        })
      );

      expect(mockedStorage.appendSyncRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          slug: SAMPLE_SUBMISSION.slug,
          submissionId: SAMPLE_SUBMISSION.submissionId
        })
      );
    });

    it("returns error when GitHub session is missing", async () => {
      mockedStorage.getAuthSession.mockResolvedValueOnce(null);

      const response = await syncSubmission(SAMPLE_SUBMISSION);

      expect(response).toEqual({
        ok: false,
        error: "Connect GitHub before syncing submissions."
      });

      expect(mockedGithub.commitSubmission).not.toHaveBeenCalled();
    });

    it("returns error when repository URL is invalid", async () => {
      mockedGithub.parseGitHubRepoUrl.mockReturnValueOnce(null);

      const response = await syncSubmission(SAMPLE_SUBMISSION);

      expect(response).toEqual({
        ok: false,
        error: "Enter a valid GitHub repository URL."
      });

      expect(mockedGithub.commitSubmission).not.toHaveBeenCalled();
    });

    it("skips non-accepted submissions when accepted-only mode is enabled", async () => {
      const response = await syncSubmission({
        ...SAMPLE_SUBMISSION,
        accepted: false
      });

      expect(response).toEqual({ ok: true });
      expect(mockedGithub.commitSubmission).not.toHaveBeenCalled();
    });

    it("blocks duplicate in-flight syncs for the same submission", async () => {
      let release!: () => void;

      mockedGithub.commitSubmission.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                commitSha: "abc123",
                repoPath: "1-two-sum"
              });
          })
      );

      const first = syncSubmission(SAMPLE_SUBMISSION);

      await Promise.resolve();
      await Promise.resolve();

      const second = await syncSubmission(SAMPLE_SUBMISSION);

      expect(second).toEqual({
        ok: true,
        data: {
          skipped: true,
          reason: "in_progress"
        }
      });

      expect(typeof release).toBe("function");

      release();
      await first;
    });

    it("maps fast-forward conflict into user-facing error", async () => {
      mockedGithub.commitSubmission.mockRejectedValueOnce(
        new AppError(
          "FAST_FORWARD_CONFLICT",
          "Repository changed during sync. Please try again."
        )
      );

      const response = await syncSubmission(SAMPLE_SUBMISSION);

      expect(response).toEqual({
        ok: false,
        error: "Repository changed during sync. Please try again."
      });
    });
  });

  describe("auth and settings handlers", () => {
    it("checkPendingAuth returns disconnected when no pending device auth exists", async () => {
      mockedStorage.getPendingDeviceAuth.mockResolvedValueOnce(null);

      const response = await checkPendingAuth();

      expect(response).toEqual({
        ok: true,
        data: {
          connected: false,
          pending: null
        }
      });
    });

    it("checkPendingAuth saves auth session when poll succeeds", async () => {
      const pending = {
        deviceCode: "device-code",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        expiresAt: Date.now() + 60_000,
        intervalSeconds: 5
      };

      mockedStorage.getPendingDeviceAuth.mockResolvedValueOnce(pending);
      mockedGithub.pollForAccessToken.mockResolvedValueOnce(DEFAULT_SESSION);

      const response = await checkPendingAuth();

      expect(mockedStorage.saveAuthSession).toHaveBeenCalledWith(DEFAULT_SESSION);
      expect(mockedStorage.clearPendingDeviceAuth).toHaveBeenCalled();

      expect(response).toEqual({
        ok: true,
        data: {
          connected: true,
          pending: null
        }
      });
    });

    it("disconnectGitHub clears auth and sync state", async () => {
      const response = await disconnectGitHub();

      expect(mockedStorage.clearAuthSession).toHaveBeenCalled();
      expect(mockedStorage.clearPendingDeviceAuth).toHaveBeenCalled();
      expect(mockedStorage.clearSyncState).toHaveBeenCalled();

      expect(response).toEqual({ ok: true });
    });
  });

  describe("handleRuntimeMessage", () => {
    it("returns settings for GET_SETTINGS", async () => {
      const sendResponse = createResponder();

      await handleRuntimeMessage({ type: "GET_SETTINGS" }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: DEFAULT_SETTINGS
      });
    });

    it("routes SYNC_SUBMISSION", async () => {
      const sendResponse = createResponder();

      await handleRuntimeMessage(
        {
          type: "SYNC_SUBMISSION",
          payload: SAMPLE_SUBMISSION
        },
        sendResponse
      );

      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: {
          commitSha: "abc123",
          repoPath: "1-two-sum"
        }
      });
    });

    it("returns unsupported message error for unknown message types", async () => {
      const sendResponse = createResponder();

      await handleRuntimeMessage({ type: "DOES_NOT_EXIST" }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Unsupported message"
      });
    });

    it("catches unexpected handler failures", async () => {
      const sendResponse = createResponder();

      mockedStorage.getSettings.mockRejectedValueOnce(new Error("boom"));

      await handleRuntimeMessage({ type: "GET_SETTINGS" }, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        ok: false,
        error: "Something went wrong. Please try again."
      });
    });
  });
});
