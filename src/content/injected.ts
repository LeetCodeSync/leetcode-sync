(() => {
  const FLAG = "__leetcodeGithubSyncInjected";
  const BRIDGE_SOURCE = "leetcode-github-sync";
  const BRIDGE_TYPE = "LEETCODE_SUBMISSION_CAPTURED";

  const globalWindow = window as Window & {
    [FLAG]?: boolean;
  };

  if (globalWindow[FLAG]) {
    return;
  }

  globalWindow[FLAG] = true;

  type NetworkCapture = {
    source: "fetch" | "xhr";
    url: string;
    capturedAt: number;
    submissionId?: string;
    code?: string;
    language?: string;
    accepted?: boolean;
    statusText?: string;
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
      if (typeof value === "number") {
        if (value === 10) {
          return { accepted: true, statusText: "Accepted" };
        }
      }
    }

    return {};
  }

  function isRelevantUrl(url: string): boolean {
    return (
      /graphql/i.test(url) ||
      /submissions\/detail/i.test(url) ||
      /submissions/i.test(url) ||
      /submit/i.test(url) ||
      /check/i.test(url)
    );
  }

  function shouldEmitCapture(url: string, candidate: NetworkCapture): boolean {
    const codeLooksReal = looksLikeCode(candidate.code);
    const hasSubmissionId = Boolean(candidate.submissionId);
    const accepted = candidate.accepted === true;
    const submissionUrl = /submission/i.test(url);

    if (accepted) return true;
    if (hasSubmissionId && (codeLooksReal || Boolean(candidate.language))) return true;
    if (submissionUrl && codeLooksReal) return true;

    return false;
  }

  function extractCaptures(
    root: unknown,
    url: string,
    source: "fetch" | "xhr"
  ): NetworkCapture[] {
    const captures: NetworkCapture[] = [];

    walk(root, (node) => {
      const code = pickString(node, [
        "code",
        "submissionCode",
        "typedCode",
        "sourceCode",
        "source"
      ]);

      const language = pickString(node, [
        "lang",
        "langName",
        "language",
        "codeLang"
      ]);

      const submissionId = pickSubmissionId(node);
      const acceptedInfo = pickAccepted(node);

      const candidate: NetworkCapture = {
        source,
        url,
        capturedAt: Date.now(),
        submissionId,
        code,
        language,
        accepted: acceptedInfo.accepted,
        statusText: acceptedInfo.statusText
      };

      if (shouldEmitCapture(url, candidate)) {
        captures.push(candidate);
      }
    });

    return captures;
  }

  function emitCapture(capture: NetworkCapture): void {
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: BRIDGE_TYPE,
        payload: capture
      },
      "*"
    );
  }

  async function handleResponseText(
    url: string,
    text: string,
    source: "fetch" | "xhr"
  ): Promise<void> {
    if (!isRelevantUrl(url)) return;

    const json = parseJson(text);
    if (!json) return;

    const captures = extractCaptures(json, url, source);
    for (const capture of captures) {
      emitCapture(capture);
    }
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (...args: Parameters<typeof fetch>) => {
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
      // swallow bridge errors
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
        // swallow bridge errors
      }
    });

    return originalSend.call(this, body);
  };
})();
