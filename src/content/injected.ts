(() => {
  const FLAG = "__leetcodeGithubSyncInjected";
  const BRIDGE_SOURCE = "leetcode-github-sync";
  const BRIDGE_TYPE = "LEETCODE_SUBMISSION_CAPTURED";

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

  type SubmissionHint = {
    submissionId?: string;
    accepted?: boolean;
    statusText?: string;
  };

  const globalWindow = window as Window & {
    [FLAG]?: boolean;
  };

  if (globalWindow[FLAG]) {
    return;
  }

  globalWindow[FLAG] = true;

  const fetchedSubmissionIds = new Set<string>();

  function sanitizeText(value: string): string {
    return value
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .trim();
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

  function pickAcceptedInfo(
    node: Record<string, unknown>
  ): { accepted?: boolean; statusText?: string } {
    const stringCandidates = [
      node.statusDisplay,
      node.status_display,
      node.statusMessage,
      node.status_msg,
      node.statusMsg,
      node.state
    ];

    for (const value of stringCandidates) {
      if (typeof value === "string" && value.trim()) {
        const text = value.trim();
        if (/accepted/i.test(text) || /success/i.test(text)) {
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

  function extractSubmissionHints(root: unknown): SubmissionHint[] {
    const hints: SubmissionHint[] = [];

    walk(root, (node) => {
      const submissionId = pickSubmissionId(node);
      const acceptedInfo = pickAcceptedInfo(node);

      if (submissionId) {
        hints.push({
          submissionId,
          accepted: acceptedInfo.accepted,
          statusText: acceptedInfo.statusText
        });
      }
    });

    return hints;
  }

  function emitCapture(payload: DetailCapture) {
    window.postMessage(
      {
        source: BRIDGE_SOURCE,
        type: BRIDGE_TYPE,
        payload
      },
      "*"
    );
  }

  function detailHasCode(data: unknown): data is {
    code?: string;
    submissionCode?: string;
    submissionDetails?: Record<string, unknown>;
  } {
    return isObject(data);
  }

  function normalizeDetailPayload(
    submissionId: string,
    url: string,
    root: unknown
  ): DetailCapture | null {
    if (!detailHasCode(root)) return null;

    let code: string | undefined;
    let language: string | undefined;
    let runtime: string | undefined;
    let memory: string | undefined;
    let accepted = false;
    let statusText: string | undefined;

    walk(root, (node) => {
      if (!code) {
        code = pickString(node, [
          "code",
          "submissionCode",
          "typedCode",
          "sourceCode",
          "source"
        ]);
      }

      if (!language) {
        language = pickString(node, [
          "lang",
          "langName",
          "language",
          "codeLang"
        ]);
      }

      if (!runtime) {
        runtime = pickString(node, [
          "runtimeDisplay",
          "statusRuntime",
          "status_runtime",
          "runtime"
        ]);
      }

      if (!memory) {
        memory = pickString(node, [
          "memoryDisplay",
          "statusMemory",
          "status_memory",
          "memory"
        ]);
      }

      const acceptedInfo = pickAcceptedInfo(node);
      if (acceptedInfo.accepted) {
        accepted = true;
      }
      if (!statusText && acceptedInfo.statusText) {
        statusText = acceptedInfo.statusText;
      }
    });

    if (!code || !code.trim()) {
      return null;
    }

    return {
      source: "submission-detail-fetch",
      url,
      capturedAt: Date.now(),
      submissionId,
      code: sanitizeText(code),
      language,
      accepted,
      statusText,
      runtime,
      memory
    };
  }

  async function fetchSubmissionDetail(
    submissionId: string,
    attempt = 0
  ): Promise<void> {
    const maxAttempts = 8;
    const url = `/submissions/detail/${submissionId}/check/`;

    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error(`Submission detail fetch failed: ${response.status}`);
      }

      const text = await response.text();
      const json = parseJson(text);
      const detail = normalizeDetailPayload(submissionId, url, json);

      if (detail?.code?.trim()) {
        emitCapture(detail);
        return;
      }
    } catch {
      // retry below
    }

    if (attempt >= maxAttempts - 1) {
      return;
    }

    const delay = Math.min(500 * 2 ** attempt, 4000);
    window.setTimeout(() => {
      void fetchSubmissionDetail(submissionId, attempt + 1);
    }, delay);
  }

  function queueSubmissionDetailFetch(submissionId: string) {
    if (!submissionId || fetchedSubmissionIds.has(submissionId)) {
      return;
    }

    fetchedSubmissionIds.add(submissionId);
    void fetchSubmissionDetail(submissionId);
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

  async function handleResponseText(url: string, text: string): Promise<void> {
    if (!isRelevantUrl(url)) return;

    const json = parseJson(text);
    if (!json) return;

    const hints = extractSubmissionHints(json);
    for (const hint of hints) {
      if (hint.submissionId) {
        queueSubmissionDetailFetch(hint.submissionId);
      }
    }

    const detailMatch = url.match(/\/submissions\/detail\/(\d+)\/check\/?$/);
    if (detailMatch) {
      const detail = normalizeDetailPayload(detailMatch[1], url, json);
      if (detail?.code?.trim()) {
        emitCapture(detail);
      }
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
        await handleResponseText(url, text);
      }
    } catch {
      // ignore bridge failures
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
          void handleResponseText(url, this.responseText);
        }
      } catch {
        // ignore bridge failures
      }
    });

    return originalSend.call(this, body);
  };
})();
