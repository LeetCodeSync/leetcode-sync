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

let lastSentFingerprint = "";
let syncInFlight = false;
let syncTimer: number | null = null;

function queryFirst(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const found = document.querySelector(selector);
    if (found) return found;
  }
  return null;
}

function isSupportedPage(): boolean {
  return window.location.pathname.includes("/problems/");
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

function getLanguageText(): string {
  const button = queryFirst([
    'button[data-e2e-locator="lang-select"]',
    'button[class*="lang-select"]'
  ]);

  return button?.textContent?.trim() || "Python3";
}

function getCodeText(): string {
  const textarea = document.querySelector("textarea") as HTMLTextAreaElement | null;
  if (textarea?.value?.trim()) {
    return textarea.value;
  }

  const monacoLines = Array.from(document.querySelectorAll(".view-line"));
  if (monacoLines.length > 0) {
    const text = monacoLines.map((node) => node.textContent ?? "").join("\n").trim();
    if (text) return text;
  }

  return "";
}

function isAcceptedVisible(): boolean {
  return /\bAccepted\b/.test(document.body.innerText);
}

function buildPayload(): SubmissionPayload | null {
  const rawTitle = getProblemTitle();
  const problemNumber = getProblemNumber();
  const articleText = getDescriptionText() || "Problem statement not captured.";
  const code = getCodeText();

  if (!problemNumber) {
    logWarn("Could not parse LeetCode problem number", {
      rawTitle,
      href: window.location.href
    });
    return null;
  }

  if (!code.trim()) {
    logDebug("buildPayload skipped because code is empty");
    return null;
  }

  const sections = splitDescriptionSections(articleText);

  return {
    problemNumber,
    slug: slugFromUrl(window.location.href),
    title: titleWithoutNumber(rawTitle),
    difficulty: inferDifficulty(getDifficultyText()),
    language: getLanguageText(),
    code,
    descriptionText: sections.descriptionText,
    examplesText: sections.examplesText,
    constraintsText: sections.constraintsText,
    followUpText: sections.followUpText,
    problemUrl: window.location.href,
    submittedAt: new Date().toISOString(),
    accepted: true
  };
}

function buildFingerprint(payload: SubmissionPayload): string {
  return [
    payload.problemNumber,
    payload.slug,
    payload.language,
    payload.code.length,
    payload.code.slice(0, 30)
  ].join(":");
}

async function trySyncAcceptedSubmission(): Promise<void> {
  logDebug("trySyncAcceptedSubmission called");

  if (syncInFlight) {
    logDebug("sync already in flight, skipping");
    return;
  }

  if (!isAcceptedVisible()) {
    logDebug("accepted result not visible yet");
    return;
  }

  const payload = buildPayload();
  if (!payload) {
    logDebug("payload is null", {
      descriptionLength: getDescriptionText().length,
      codeLength: getCodeText().length
    });
    return;
  }

  const fingerprint = buildFingerprint(payload);
  if (fingerprint === lastSentFingerprint) {
    logDebug("duplicate fingerprint, skipping");
    return;
  }

  syncInFlight = true;
  lastSentFingerprint = fingerprint;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SYNC_SUBMISSION",
      payload
    });

    logInfo("background responded", response);

    if (!response?.ok) {
      logWarn("sync failed", response?.error);
    }
  } catch (error) {
    logWarn("runtime unavailable", error);
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

function init(): void {
  logInfo("content script loaded", {
    href: window.location.href,
    path: window.location.pathname
  });

  if (!isSupportedPage()) {
    logDebug("unsupported page");
    return;
  }

  const observer = new MutationObserver(() => {
    scheduleSync();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.addEventListener(
    "click",
    () => {
      window.setTimeout(() => scheduleSync(), 1500);
      window.setTimeout(() => scheduleSync(), 3000);
    },
    true
  );
}

init();
