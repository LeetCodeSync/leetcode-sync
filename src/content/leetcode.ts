import {
  inferDifficulty,
  normalizeWhitespace,
  problemNumberFromTitle,
  slugFromUrl,
  splitDescriptionSections,
  titleWithoutNumber
} from "../lib/leetcode";
import type { SubmissionPayload } from "../types";

const DEBUG = true;
const INFO = true;
const BRIDGE_SOURCE = "leetcode-github-sync";
const BRIDGE_TYPE = "LEETCODE_SUBMISSION_CAPTURED";
const ATTEMPT_COOLDOWN_MS = 15_000;

type DetailCapture = {
  source: "submission-detail-fetch";
  url: string;
  capturedAt: number;
  submissionId: string;
  code: string;
  language?: string;
  accepted: boolean;
  statusText?: string;
  runtime?: string;
  memory?: string;
};

let latestDetailCapture: DetailCapture | null = null;
let pageScriptInjected = false;
let lastSuccessfulFingerprint = "";
let lastAttemptedFingerprint = "";
let lastAttemptedAt = 0;
let syncInFlight = false;
let syncTimer: number | null = null;

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

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found) return found;
  }
  return null;
}

function sanitizeCodeText(value: string): string {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r\n/g, "\n")
    .trimEnd();
}

function looksLikeRealSolution(code: string): boolean {
  const text = sanitizeCodeText(code).trim();
  if (!text || text.length < 20) return false;

  return (
    text.includes("class Solution") ||
    text.includes("def ") ||
    text.includes("function ") ||
    text.includes("func ") ||
    text.includes("public class ") ||
    text.includes("public static ") ||
    text.includes("private static ") ||
    text.includes("return ")
  );
}

function isSupportedPage(): boolean {
  const path = window.location.pathname;

  return (
    /^\/problems\/[^/]+\/?$/.test(path) ||
    /^\/problems\/[^/]+\/description\/?$/.test(path) ||
    /^\/problems\/[^/]+\/submissions\/?$/.test(path) ||
    /^\/problems\/[^/]+\/submissions\/\d+\/?$/.test(path)
  );
}

function mergeDetailCapture(
  current: DetailCapture | null,
  incoming: DetailCapture
): DetailCapture {
  if (!current) return incoming;

  if (incoming.submissionId !== current.submissionId) {
    return incoming;
  }

  const next = { ...current, ...incoming };

  if (incoming.code && incoming.code.length > current.code.length) {
    next.code = incoming.code;
  }

  return next;
}

function handleBridgeMessage(event: MessageEvent) {
  if (event.source !== window) return;

  const data = event.data as
    | {
        source?: string;
        type?: string;
        payload?: DetailCapture;
      }
    | undefined;

  if (!data || data.source !== BRIDGE_SOURCE || data.type !== BRIDGE_TYPE || !data.payload) {
    return;
  }

  if (!data.payload.submissionId || !data.payload.code) {
    return;
  }

  latestDetailCapture = mergeDetailCapture(latestDetailCapture, {
    ...data.payload,
    code: sanitizeCodeText(data.payload.code)
  });

  logDebug("submission detail capture updated", latestDetailCapture);
  scheduleSync(250);
}

function injectPageScript() {
  if (pageScriptInjected) return;
  pageScriptInjected = true;

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("assets/injected.js");
  script.async = false;
  script.dataset.source = "leetcode-github-sync";

  script.onload = () => {
    script.remove();
  };

  (document.head || document.documentElement).appendChild(script);
}

function getProblemTitle(): string {
  const selectors = [
    'div[data-cy="question-title"]',
    "div.text-title-large a",
    "h1"
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) return text;
  }

  return document.title.replace(" - LeetCode", "").trim() || "Unknown Problem";
}

function getProblemNumber(): string {
  const rawTitle = getProblemTitle();
  const fromTitle = problemNumberFromTitle(rawTitle);
  if (fromTitle) return fromTitle;

  const titleNode = queryFirst([
    'div[data-cy="question-title"]',
    "div.text-title-large a",
    "h1"
  ]);

  const visibleTitle = titleNode?.textContent?.trim() ?? "";
  const visibleMatch = visibleTitle.match(/^(\d+)\.\s*/);
  if (visibleMatch) return visibleMatch[1];

  const html = document.documentElement.innerHTML;
  const jsonMatch =
    html.match(/"questionFrontendId":"(\d+)"/) ||
    html.match(/"frontendQuestionId":"(\d+)"/);

  if (jsonMatch) return jsonMatch[1];

  return "";
}

function getDifficultyText(): string {
  const nodes = Array.from(document.querySelectorAll("div, span"));
  const hit = nodes.find((node) =>
    /^(Easy|Medium|Hard)$/.test(node.textContent?.trim() ?? "")
  );
  return hit?.textContent?.trim() ?? "Unknown";
}

function getDescriptionText(): string {
  const article = queryFirst([
    'div[data-track-load="description_content"]',
    "article",
    'div[class*="description"]'
  ]);

  return normalizeWhitespace(article?.textContent ?? "");
}

function isAcceptedVisible(): boolean {
  if (latestDetailCapture?.accepted === true) {
    return true;
  }

  return /\bAccepted\b/.test(document.body.innerText);
}

function buildPayload(): SubmissionPayload | null {
  const rawTitle = getProblemTitle();
  const problemNumber = getProblemNumber();
  const articleText = getDescriptionText() || "Problem statement not captured.";

  if (!problemNumber) {
    logWarn("Could not detect the LeetCode problem number on this page.", {
      href: window.location.href,
      rawTitle
    });
    return null;
  }

  if (!latestDetailCapture?.submissionId) {
    logDebug("submission detail not captured yet");
    return null;
  }

  if (!looksLikeRealSolution(latestDetailCapture.code)) {
    logWarn("Submission detail code is missing or incomplete.", {
      submissionId: latestDetailCapture.submissionId
    });
    return null;
  }

  const sections = splitDescriptionSections(articleText);

  return {
    problemNumber,
    slug: slugFromUrl(window.location.href),
    title: titleWithoutNumber(rawTitle),
    difficulty: inferDifficulty(getDifficultyText()),
    language: latestDetailCapture.language?.trim() || "Python3",
    code: latestDetailCapture.code,
    descriptionText: sections.descriptionText,
    examplesText: sections.examplesText,
    constraintsText: sections.constraintsText,
    followUpText: sections.followUpText,
    problemUrl: window.location.href,
    submittedAt: new Date().toISOString(),
    accepted: true,
    runtime: latestDetailCapture.runtime,
    memory: latestDetailCapture.memory,
    submissionId: latestDetailCapture.submissionId
  };
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

async function trySyncAcceptedSubmission(): Promise<void> {
  logDebug("trySyncAcceptedSubmission called");

  if (syncInFlight) {
    logDebug("sync already in flight, skipping");
    return;
  }

  if (!isSupportedPage()) {
    logDebug("unsupported page");
    return;
  }

  if (!isAcceptedVisible()) {
    logDebug("accepted result not visible yet");
    return;
  }

  const payload = buildPayload();
  if (!payload) {
    return;
  }

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

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SYNC_SUBMISSION",
      payload
    });

    logInfo("background responded", response);

    if (response?.ok) {
      lastSuccessfulFingerprint = fingerprint;
    } else {
      logWarn(response?.error ?? "Sync failed.");
    }
  } catch (error) {
    logWarn("Runtime unavailable", error);
  } finally {
    syncInFlight = false;
  }
}

function scheduleSync(delay = 1200): void {
  if (syncTimer) {
    window.clearTimeout(syncTimer);
  }

  syncTimer = window.setTimeout(() => {
    void trySyncAcceptedSubmission();
    syncTimer = null;
  }, delay);
}

function startObservers() {
  const observer = new MutationObserver(() => {
    scheduleSync();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.addEventListener(
    "click",
    () => {
      window.setTimeout(() => scheduleSync(), 1500);
      window.setTimeout(() => scheduleSync(), 3000);
      window.setTimeout(() => scheduleSync(), 5000);
    },
    true
  );

  window.addEventListener("focus", () => {
    scheduleSync(800);
  });

  window.addEventListener("message", handleBridgeMessage);
  scheduleSync(1200);
}

function init() {
  logInfo("content script loaded", {
    href: window.location.href,
    path: window.location.pathname
  });

  if (!window.location.pathname.includes("/problems/")) {
    logDebug("unsupported page");
    return;
  }

  injectPageScript();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObservers();
    });
  } else {
    startObservers();
  }
}

init();
