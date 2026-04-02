import {
  inferDifficulty,
  normalizeWhitespace,
  problemNumberFromTitle,
  slugFromUrl,
  splitDescriptionSections,
  titleWithoutNumber
} from "../lib/leetcode";
import type { SubmissionPayload } from "../types";

let lastSentFingerprint = "";

declare global {
  interface Window {
    __leetcodeSyncTest?: () => void;
  }
}

console.log("[sync] content script loaded", window.location.href);

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

  return document.title.replace(" - LeetCode", "").trim() || "0. Unknown Problem";
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
  const articleText = getDescriptionText() || "Problem statement not captured.";
  const code = getCodeText();

  if (!code.trim()) {
    console.log("[sync] buildPayload: code is empty");
    return null;
  }

  const sections = splitDescriptionSections(articleText);

  return {
    problemNumber: problemNumberFromTitle(rawTitle),
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
  console.log("[sync] trySyncAcceptedSubmission called");

  const accepted = isAcceptedVisible();
  console.log("[sync] accepted visible:", accepted);

  if (!accepted) {
    return;
  }

  const payload = buildPayload();
  console.log("[sync] payload:", payload);

  if (!payload) {
    console.log("[sync] description:", getDescriptionText());
    console.log("[sync] code:", getCodeText());
    return;
  }

  const fingerprint = buildFingerprint(payload);
  console.log("[sync] fingerprint:", fingerprint);

  if (fingerprint === lastSentFingerprint) {
    console.log("[sync] duplicate fingerprint, skipping");
    return;
  }

  lastSentFingerprint = fingerprint;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SYNC_SUBMISSION",
      payload
    });

    console.log("[sync] background response:", response);

    if (!response?.ok) {
      console.warn("[leetcode-github-sync] sync failed:", response?.error);
    }
  } catch (error) {
    console.warn("[leetcode-github-sync] runtime unavailable", error);
  }
}

function init(): void {
  console.log("[sync] init called", window.location.pathname);

  if (!isSupportedPage()) {
    console.log("[sync] unsupported page");
    return;
  }

  console.log("[sync] supported page");

  const observer = new MutationObserver(() => {
    console.log("[sync] mutation observed");
    void trySyncAcceptedSubmission();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.addEventListener(
    "click",
    () => {
      console.log("[sync] click observed");
      window.setTimeout(() => void trySyncAcceptedSubmission(), 1500);
      window.setTimeout(() => void trySyncAcceptedSubmission(), 3000);
    },
    true
  );

  window.__leetcodeSyncTest = () => {
    console.log("[sync] manual trigger");
    void trySyncAcceptedSubmission();
  };
}

init();
