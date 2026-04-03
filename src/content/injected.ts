(() => {
  const FLAG = "__leetcodeGithubSyncInjected";
  const BRIDGE_SOURCE = "leetcode-github-sync";
  const BRIDGE_TYPE_DRAFT = "LEETCODE_SUBMISSION_DRAFT";
  const BRIDGE_TYPE_RESULT = "LEETCODE_SUBMISSION_RESULT";

  const globalWindow = window as Window & {
    [FLAG]?: boolean;
  };

  if (globalWindow[FLAG]) {
    return;
  }

  globalWindow[FLAG] = true;

  type SubmissionDraft = {
    source: "fetch" | "xhr";
    url: string;
    capturedAt: number;
    code?: string;
    language?: string;
    titleSlug?: string;
  };

  type SubmissionResult = {
    source: "fetch" | "xhr";
    url: string;
    capturedAt: number;
    submissionId?: string;
    accepted?: boolean;
    statusText?: string;
    runtime?: string;
    memory?: string;
    code?: string;
    language?: string;
  };

  function sanitizeText(value: string): string {
    return value
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function looksLikeCode(value: string | undefined): boolean {
    if (!value) return false;

    const text = sanitizeText(value);
    if (text.length < 20) return false;

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

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function parseJson(text: string): unknown | null {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function walk(
    value: unknown,
    visitor: (node: Record<string, unknown>) => void,
    seen = new WeakSet<object>()
  ): void {
    if (!isObject(value)) return;
    if (seen.has(value)) return;
    seen.add(value);

    visitor(value);

    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item, visitor, seen);
        }
      } else {
        walk(child, visitor, seen);
      }
    }
  }

  function pickString(
    node: Record<string, unknown>,
    keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = node[key];
      if (typeof value === "string" && value.trim()) {
        return sanitizeText(value);
      }
    }
    return undefined;
  }

  function pickSubmissionId(node: Record<string, unknown>): string | undefined {
    const candidates = [
      node.submissionId,
      node.submission_id,
      node.submissionID,
      node.id
    ];

    for (const value of candidates) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
      if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        return value.trim();
      }
    }

    return undefined;
  }

  function pickAccepted(
    node: Record<string, unknown>
  ): { accepted?: boolean; statusText?: string } {
    const stringCandidates = [
      node.statusDisplay,
      node.status_display,
      node.statusMessage,
      node.status_msg,
      node.statusMsg
    ];

    for (const value of stringCandidates) {
      if (typeof value === "string" && value.trim()) {
        const text = value.trim();
        if (/accepted/i.test(text)) {
          return { accepted: true, statusText: text };
        }
        return { statusText: text };
      }
    }

    const numericCandidates = [node.statusCode, node.status_code];
    for (const value of numericCandidates) {
      if (typeof value === "number" && value === 10) {
        return { accepted: true, statusText: "Accepted" };
      }
    }

    return {};
  }

  function pickRuntime(node: Record<string, unknown>): string | undefined {
    return pickString(node, [
      "statusRuntime",
      "status_runtime",
      "runtime",
      "displayRuntime"
    ]);
  }

  function pickMemory(node: Record<string, unknown>): string | undefined {
    return pickString(node, [
      "statusMemory",
      "status_memory",
      "memory",
      "displayMemory"
    ]);
  }

  function emitDraft(draft: SubmissionDraft): void {
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: BRIDGE_TYPE_DRAFT,
        payload: draft
      },
      "*"
    );
  }

  function emitResult(result: SubmissionResult): void {
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: BRIDGE_TYPE_RESULT,
        payload: result
      },
      "*"
    );
  }

  function extractDraftFromValue(
    value: unknown,
    url: string,
    source: "fetch" | "xhr"
  ): SubmissionDraft | null {
    let best: SubmissionDraft | null = null;

    walk(value, (node) => {
      const code = pickString(node, [
        "typedCode",
        "typed_code",
        "code",
        "sourceCode",
        "source_code",
        "source"
      ]);

      if (!looksLikeCode(code)) {
        return;
      }

      const language = pickString(node, [
        "lang",
        "langSlug",
        "lang_slug",
        "langName",
        "language",
        "codeLang"
      ]);

      const titleSlug = pickString(node, [
        "titleSlug",
        "title_slug",
        "questionSlug"
      ]);

      const candidate: SubmissionDraft = {
        source,
        url,
        capturedAt: Date.now(),
        code,
        language,
        titleSlug
      };

      if (!best || (candidate.code?.length ?? 0) > (best.code?.length ?? 0)) {
        best = candidate;
      }
    });

    return best;
  }

  function extractResultsFromValue(
    value: unknown,
    url: string,
    source: "fetch" | "xhr"
  ): SubmissionResult[] {
    const results: SubmissionResult[] = [];

    walk(value, (node) => {
      const submissionId = pickSubmissionId(node);
      const acceptedInfo = pickAccepted(node);
      const runtime = pickRuntime(node);
      const memory = pickMemory(node);
      const code = pickString(node, [
        "code",
        "submissionCode",
        "typedCode",
        "sourceCode",
        "source"
      ]);
      const language = pickString(node, [
        "lang",
        "langSlug",
        "lang_slug",
        "langName",
        "language",
        "codeLang"
      ]);

      const candidate: SubmissionResult = {
        source,
        url,
        capturedAt: Date.now(),
        submissionId,
        accepted: acceptedInfo.accepted,
        statusText: acceptedInfo.statusText,
        runtime,
        memory,
        code: looksLikeCode(code) ? code : undefined,
        language
      };

      const meaningful =
        candidate.submissionId ||
        candidate.accepted === true ||
        candidate.runtime ||
        candidate.memory ||
        candidate.code;

      if (meaningful) {
        results.push(candidate);
      }
    });

    return results;
  }

  function parseBodyText(body: unknown): string | null {
    if (typeof body === "string") {
      return body;
    }

    if (body instanceof URLSearchParams) {
      return body.toString();
    }

    return null;
  }

  function handleOutgoingBody(
    url: string,
    bodyText: string,
    source: "fetch" | "xhr"
  ): void {
    const parsedJson = parseJson(bodyText);
    if (parsedJson) {
      const draft = extractDraftFromValue(parsedJson, url, source);
      if (draft) {
        emitDraft(draft);
        return;
      }
    }

    try {
      const params = new URLSearchParams(bodyText);
      const code =
        params.get("typed_code") ??
        params.get("typedCode") ??
        params.get("code") ??
        params.get("source_code");

      if (looksLikeCode(code ?? undefined)) {
        emitDraft({
          source,
          url,
          capturedAt: Date.now(),
          code: sanitizeText(code ?? ""),
          language:
            params.get("lang") ??
            params.get("lang_slug") ??
            params.get("language") ??
            undefined,
          titleSlug:
            params.get("title_slug") ??
            params.get("titleSlug") ??
            undefined
        });
      }
    } catch {
      // ignore
    }
  }

  async function inspectFetchRequest(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<void> {
    try {
      let url = "";
      let bodyText: string | null = null;

      if (typeof input === "string") {
        url = input;
        bodyText = parseBodyText(init?.body);
      } else if (input instanceof URL) {
        url = String(input);
        bodyText = parseBodyText(init?.body);
      } else if (input instanceof Request) {
        url = input.url;
        if (init?.body) {
          bodyText = parseBodyText(init.body);
        } else {
          bodyText = await input.clone().text();
        }
      }

      if (!url || !bodyText) return;
      handleOutgoingBody(url, bodyText, "fetch");
    } catch {
      // ignore
    }
  }

  async function handleResponseText(
    url: string,
    text: string,
    source: "fetch" | "xhr"
  ): Promise<void> {
    const json = parseJson(text);
    if (!json) return;

    const results = extractResultsFromValue(json, url, source);
    for (const result of results) {
      emitResult(result);
    }
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (...args: Parameters<typeof fetch>) => {
    void inspectFetchRequest(args[0], args[1]);

    const response = await originalFetch(...args);

    try {
      const request = args[0];
      const url =
        typeof request === "string"
          ? request
          : request instanceof Request
            ? request.url
            : String(request);

      const clone = response.clone();
      const contentType = clone.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const text = await clone.text();
        await handleResponseText(url, text, "fetch");
      }
    } catch {
      // ignore
    }

    return response;
  }) as typeof fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest & { __leetcodeGithubSyncUrl?: string },
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    this.__leetcodeGithubSyncUrl = String(url);
    return originalOpen.call(
      this,
      method,
      String(url),
      async ?? true,
      username ?? undefined,
      password ?? undefined
    );
  };

  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest & { __leetcodeGithubSyncUrl?: string },
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    try {
      const bodyText = parseBodyText(body);
      const url = this.__leetcodeGithubSyncUrl ?? "";
      if (url && bodyText) {
        handleOutgoingBody(url, bodyText, "xhr");
      }
    } catch {
      // ignore
    }

    this.addEventListener("loadend", () => {
      try {
        const url = this.__leetcodeGithubSyncUrl ?? this.responseURL ?? "";
        const contentType = this.getResponseHeader("content-type") ?? "";

        if (
          this.readyState === 4 &&
          typeof this.responseText === "string" &&
          contentType.includes("application/json")
        ) {
          void handleResponseText(url, this.responseText, "xhr");
        }
      } catch {
        // ignore
      }
    });

    return originalSend.call(this, body);
  };
})();
