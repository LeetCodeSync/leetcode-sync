import type { SubmissionPayload, SyncState } from "../types";

const DEBUG = false;
const INFO = true;
const BRIDGE_SOURCE = "leetcode-sync";
const REQUEST_TYPE = "LEETCODE_API_REQUEST";
const RESPONSE_TYPE = "LEETCODE_API_RESPONSE";
const ATTEMPT_COOLDOWN_MS = 15_000;
const BRIDGE_REQUEST_TIMEOUT_MS = 30_000;
const INITIAL_SYNC_DELAY_MS = 1200;
const ROUTE_SYNC_DELAY_MS = 900;

type SubmissionBundle = {
  question: {
    questionFrontendId: string;
    title: string;
    titleSlug: string;
    content: string;
    difficulty: string;
  };
  submission: {
    id: string;
    code: string;
    language?: string;
    runtime?: string;
    memory?: string;
    runtimePercentile?: number;
    memoryPercentile?: number;
    timestamp?: string;
    statusDisplay?: string;
    accepted: boolean;
  };
};

type PendingBridgeRequest = {
  resolve: (value: SubmissionBundle) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

let pageScriptInjected = false;
let lastSuccessfulFingerprint = "";
let lastAttemptedFingerprint = "";
let lastAttemptedAt = 0;
let syncInFlight = false;
let requestCounter = 0;
let autoSyncTimerId: number | null = null;
let lastObservedUrl = window.location.href;
let lastObservedSubmissionId: string | null = null;
const pendingRequests = new Map<string, PendingBridgeRequest>();

function logDebug(message: string, data?: unknown) {
  if (!DEBUG) return;
  if (data === undefined) {
    console.log(`[content][DEBUG] ${message}`);
  } else {
    console.log(`[content][DEBUG] ${message}`, data);
  }
}

function logInfo(message: string, data?: unknown) {
  if (!INFO) return;
  if (data === undefined) {
    console.info(`[content][INFO] ${message}`);
  } else {
    console.info(`[content][INFO] ${message}`, data);
  }
}

function logWarn(message: string, data?: unknown) {
  if (data === undefined) {
    console.warn(`[content][WARN] ${message}`);
  } else {
    console.warn(`[content][WARN] ${message}`, data);
  }
}

function sanitizeCodeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function splitDescriptionSections(text: string): {
  descriptionText: string;
  examplesText?: string;
  constraintsText?: string;
  followUpText?: string;
} {
  const normalized = normalizeWhitespace(text);

  const exampleIndex = normalized.search(/\bExample 1:\b/i);
  const constraintsIndex = normalized.search(/\bConstraints:\b/i);
  const followUpIndex = normalized.search(/\bFollow-up:\b/i);

  const firstSectionStart = [exampleIndex, constraintsIndex, followUpIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  const descriptionText =
    firstSectionStart === undefined
      ? normalized
      : normalized.slice(0, firstSectionStart).trim();

  const examplesText =
    exampleIndex >= 0
      ? normalized
          .slice(
            exampleIndex,
            [constraintsIndex, followUpIndex]
              .filter((index) => index > exampleIndex)
              .sort((a, b) => a - b)[0] ?? normalized.length
          )
          .trim()
      : undefined;

  const constraintsText =
    constraintsIndex >= 0
      ? normalized
          .slice(
            constraintsIndex,
            [followUpIndex].filter((index) => index > constraintsIndex)[0] ??
              normalized.length
          )
          .trim()
      : undefined;

  const followUpText =
    followUpIndex >= 0 ? normalized.slice(followUpIndex).trim() : undefined;

  return {
    descriptionText,
    examplesText,
    constraintsText,
    followUpText
  };
}

function inferDifficulty(value: string): "Easy" | "Medium" | "Hard" | "Unknown" {
  if (/easy/i.test(value)) return "Easy";
  if (/medium/i.test(value)) return "Medium";
  if (/hard/i.test(value)) return "Hard";
  return "Unknown";
}

function htmlToText(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return normalizeWhitespace(doc.body.textContent ?? "");
}

function getSlugFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/problems\/([^/]+)/);
  return match?.[1] ?? null;
}

function getSubmissionIdFromUrl(): string | null {
  const match = window.location.pathname.match(
    /^\/problems\/[^/]+\/submissions\/(\d+)\/?$/
  );
  return match?.[1] ?? null;
}

function isSupportedPage(): boolean {
  return window.location.pathname.includes("/problems/");
}

function isSubmissionPage(): boolean {
  return /^\/problems\/[^/]+\/submissions\/\d+\/?$/.test(window.location.pathname);
}

function injectPageScript() {
  if (pageScriptInjected) return;
  pageScriptInjected = true;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("assets/injected.js");
  script.async = false;
  script.dataset.source = "leetcode-sync";

  script.onload = () => {
    script.remove();
  };

  (document.head || document.documentElement).appendChild(script);
}

function buildFingerprint(payload: SubmissionPayload): string {
  return [
    payload.submissionId ?? "",
    payload.problemNumber,
    payload.slug,
    payload.language,
    payload.code.length,
    payload.code.slice(0, 80)
  ].join(":");
}

async function updateSyncState(state: SyncState) {
  try {
    await chrome.runtime.sendMessage({ type: "SET_SYNC_STATE", payload: state });
  } catch (error) {
    logDebug("Failed to update sync state", error);
  }
}

function bridgeRequest(
  action: "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE",
  payload: { slug: string }
): Promise<SubmissionBundle>;
function bridgeRequest(
  action: "GET_SUBMISSION_BUNDLE_BY_ID",
  payload: { slug: string; submissionId: string }
): Promise<SubmissionBundle>;
function bridgeRequest(
  action:
    | "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE"
    | "GET_SUBMISSION_BUNDLE_BY_ID",
  payload: Record<string, unknown>
): Promise<SubmissionBundle> {
  const requestId = `req-${Date.now()}-${++requestCounter}`;

  return new Promise<SubmissionBundle>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Timed out waiting for LeetCode API response"));
    }, BRIDGE_REQUEST_TIMEOUT_MS);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId
    });

    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: REQUEST_TYPE,
        requestId,
        action,
        payload
      },
      "*"
    );
  });
}

function handleBridgeResponse(event: MessageEvent) {
  if (event.source !== window) return;

  const data = event.data as
    | {
        source?: string;
        type?: string;
        requestId?: string;
        ok?: boolean;
        payload?: SubmissionBundle;
        error?: string;
      }
    | undefined;

  if (
    !data ||
    data.source !== BRIDGE_SOURCE ||
    data.type !== RESPONSE_TYPE ||
    !data.requestId
  ) {
    return;
  }

  const pending = pendingRequests.get(data.requestId);
  if (!pending) return;

  pendingRequests.delete(data.requestId);
  window.clearTimeout(pending.timeoutId);

  if (data.ok && data.payload) {
    pending.resolve(data.payload);
  } else {
    pending.reject(new Error(data.error ?? "LeetCode bridge request failed"));
  }
}

function toSubmittedAt(value?: string): string {
  if (!value) {
    return new Date().toISOString();
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric * 1000).toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}

function toPayload(bundle: SubmissionBundle): SubmissionPayload {
  const description = splitDescriptionSections(htmlToText(bundle.question.content));

  return {
    problemNumber: bundle.question.questionFrontendId,
    slug: bundle.question.titleSlug,
    title: bundle.question.title,
    difficulty: inferDifficulty(bundle.question.difficulty),
    language: bundle.submission.language?.trim() || "Python3",
    code: sanitizeCodeText(bundle.submission.code),
    descriptionText: description.descriptionText,
    examplesText: description.examplesText,
    constraintsText: description.constraintsText,
    followUpText: description.followUpText,
    problemUrl: `https://leetcode.com/problems/${bundle.question.titleSlug}/`,
    submittedAt: toSubmittedAt(bundle.submission.timestamp),
    accepted: true,
    submissionId: bundle.submission.id,
    runtime: bundle.submission.runtime,
    memory: bundle.submission.memory,
    runtimePercentile: bundle.submission.runtimePercentile,
    memoryPercentile: bundle.submission.memoryPercentile
  };
}

function isExpectedNoAcceptedSubmissionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message ?? "";

  return (
    /No fresh accepted submission found/i.test(message) ||
    /Submission detail never became stable/i.test(message)
  );
}

function isExpectedRuntimeInvalidationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Extension context invalidated/i.test(error.message ?? "")
  );
}

function logSubmissionFetchIssue(message: string, error: unknown) {
  if (isExpectedNoAcceptedSubmissionError(error)) {
    logDebug(message, error);
    return;
  }

  logWarn(message, error);
}

async function syncBundle(bundle: SubmissionBundle) {
  const payload = toPayload(bundle);
  const fingerprint = buildFingerprint(payload);
  const now = Date.now();

  if (fingerprint === lastSuccessfulFingerprint) {
    logDebug("already synced successfully, skipping");
    return;
  }

  if (
    fingerprint === lastAttemptedFingerprint &&
    now - lastAttemptedAt < ATTEMPT_COOLDOWN_MS
  ) {
    logDebug("same submission is in cooldown, skipping", {
      fingerprint,
      ageMs: now - lastAttemptedAt
    });
    return;
  }

  syncInFlight = true;
  lastAttemptedFingerprint = fingerprint;
  lastAttemptedAt = now;

  await updateSyncState({
    status: "syncing",
    startedAt: new Date().toISOString(),
    title: payload.title,
    difficulty: payload.difficulty,
    submissionId: payload.submissionId
  });

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SYNC_SUBMISSION",
      payload
    });

    logInfo("background responded", response);

    if (response?.ok) {
      if (!response?.data?.skipped) {
        lastSuccessfulFingerprint = fingerprint;
        lastObservedSubmissionId = payload.submissionId ?? null;
      }
      return;
    }

    logWarn(response?.error ?? "Sync failed.");
  } catch (error) {
    if (isExpectedRuntimeInvalidationError(error)) {
      logDebug("Runtime unavailable after extension reload", error);
    } else {
      logWarn("Runtime unavailable", error);
    }
  } finally {
    syncInFlight = false;
  }
}

async function fetchLatestAcceptedSubmission() {
  if (syncInFlight) {
    logDebug("sync already in flight, skipping");
    return;
  }

  const slug = getSlugFromUrl();
  if (!slug) {
    logWarn("Could not determine problem slug from URL.");
    return;
  }

  try {
    const bundle = await bridgeRequest("GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE", {
      slug
    });
    await syncBundle(bundle);
  } catch (error) {
    logSubmissionFetchIssue(
      "Failed to fetch latest accepted submission bundle.",
      error
    );
  }
}

async function fetchCurrentSubmissionById() {
  if (syncInFlight) {
    logDebug("sync already in flight, skipping");
    return;
  }

  const slug = getSlugFromUrl();
  const submissionId = getSubmissionIdFromUrl();

  if (!slug || !submissionId) {
    return;
  }

  try {
    const bundle = await bridgeRequest("GET_SUBMISSION_BUNDLE_BY_ID", {
      slug,
      submissionId
    });
    await syncBundle(bundle);
  } catch (error) {
    logSubmissionFetchIssue(
      "Failed to fetch submission bundle by id, falling back to latest accepted.",
      error
    );

    try {
      const fallbackBundle = await bridgeRequest(
        "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE",
        { slug }
      );
      await syncBundle(fallbackBundle);
    } catch (fallbackError) {
      logSubmissionFetchIssue(
        "Failed fallback latest accepted submission fetch.",
        fallbackError
      );
    }
  }
}

async function runAutoSyncForCurrentRoute(reason: string) {
  if (!isSupportedPage()) {
    return;
  }

  const submissionId = getSubmissionIdFromUrl();

  logDebug("auto sync check", {
    reason,
    href: window.location.href,
    submissionId
  });

  if (submissionId) {
    if (
      submissionId === lastObservedSubmissionId &&
      lastSuccessfulFingerprint
    ) {
      logDebug("submission page already handled, skipping", {
        submissionId
      });
      return;
    }

    await fetchCurrentSubmissionById();
  }
}

function scheduleAutoSync(reason: string, delayMs: number) {
  if (autoSyncTimerId !== null) {
    window.clearTimeout(autoSyncTimerId);
  }

  autoSyncTimerId = window.setTimeout(() => {
    autoSyncTimerId = null;
    void runAutoSyncForCurrentRoute(reason);
  }, delayMs);
}

function notifyRouteMaybeChanged(reason: string) {
  const href = window.location.href;
  if (href === lastObservedUrl) {
    return;
  }

  lastObservedUrl = href;
  logInfo("route changed", { reason, href });
  scheduleAutoSync(reason, ROUTE_SYNC_DELAY_MS);
}

function installRouteObservers() {
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args: Parameters<History["pushState"]>) {
    originalPushState(...args);
    notifyRouteMaybeChanged("pushState");
  };

  history.replaceState = function (...args: Parameters<History["replaceState"]>) {
    originalReplaceState(...args);
    notifyRouteMaybeChanged("replaceState");
  };

  window.addEventListener("popstate", () => {
    notifyRouteMaybeChanged("popstate");
  });

  window.addEventListener("hashchange", () => {
    notifyRouteMaybeChanged("hashchange");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      notifyRouteMaybeChanged("visibilitychange");
      if (isSubmissionPage()) {
        scheduleAutoSync("visibility_submission_page", 400);
      }
    }
  });

  const observer = new MutationObserver(() => {
    notifyRouteMaybeChanged("mutation");
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "FETCH_LATEST_ACCEPTED_SUBMISSION") {
    void fetchLatestAcceptedSubmission().then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  sendResponse({ ok: false, error: "Unsupported content message" });
  return false;
});

function init() {
  logInfo("content script loaded", {
    href: window.location.href,
    path: window.location.pathname
  });

  if (!isSupportedPage()) return;

  injectPageScript();
  window.addEventListener("message", handleBridgeResponse);
  installRouteObservers();
  scheduleAutoSync("initial", INITIAL_SYNC_DELAY_MS);
}

init();
