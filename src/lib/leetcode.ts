import type { Difficulty } from "../types";

export function slugFromUrl(url: string): string {
  const match = url.match(/\/problems\/([^/]+)/);
  return match?.[1] ?? "unknown-problem";
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function inferDifficulty(text: string): Difficulty {
  if (/easy/i.test(text)) return "Easy";
  if (/medium/i.test(text)) return "Medium";
  if (/hard/i.test(text)) return "Hard";
  return "Unknown";
}

export function problemNumberFromTitle(title: string): string {
  const match = title.match(/^(\d+)\.\s*/);
  return match?.[1] ?? "";
}

export function titleWithoutNumber(title: string): string {
  return title.replace(/^\d+\.\s*/, "").trim();
}

export function splitDescriptionSections(articleText: string): {
  descriptionText: string;
  examplesText?: string;
  constraintsText?: string;
  followUpText?: string;
} {
  const normalized = normalizeWhitespace(articleText);

  const exampleIndex = normalized.search(/\bExample 1:\b/i);
  const constraintsIndex = normalized.search(/\bConstraints:\b/i);
  const followUpIndex = normalized.search(/\bFollow-up:\b/i);

  const firstBreak = [exampleIndex, constraintsIndex, followUpIndex]
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0];

  const descriptionText =
    firstBreak === undefined
      ? normalized
      : normalized.slice(0, firstBreak).trim();

  const examplesText =
    exampleIndex >= 0
      ? normalized
          .slice(
            exampleIndex,
            [constraintsIndex, followUpIndex]
              .filter((value) => value > exampleIndex)
              .sort((a, b) => a - b)[0] ?? normalized.length
          )
          .trim()
      : undefined;

  const constraintsText =
    constraintsIndex >= 0
      ? normalized
          .slice(
            constraintsIndex,
            [followUpIndex].filter((value) => value > constraintsIndex)[0] ??
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
