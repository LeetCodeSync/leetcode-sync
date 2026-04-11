(() => {
  const BRIDGE_SOURCE = "leetcode-sync";
  const REQUEST_TYPE = "LEETCODE_API_REQUEST";
  const RESPONSE_TYPE = "LEETCODE_API_RESPONSE";

  type BridgeRequest =
    | {
        source: string;
        type: string;
        requestId: string;
        action: "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE";
        payload: { slug: string };
      }
    | {
        source: string;
        type: string;
        requestId: string;
        action: "GET_SUBMISSION_BUNDLE_BY_ID";
        payload: { slug: string; submissionId: string };
      };

  type SubmissionBundle = {
    question: {
      questionFrontendId: string;
      titleSlug: string;
      title: string;
      difficulty: string;
      content: string;
    };
    submission: {
      id: string;
      code: string;
      language?: string | null;
      runtime?: string | null;
      memory?: string | null;
      runtimePercentile?: number | null;
      memoryPercentile?: number | null;
      timestamp?: string;
      statusDisplay?: string;
      accepted: boolean;
    };
  };

  const questionCache = new Map<string, SubmissionBundle["question"]>();

  function normalizeCode(value: string): string {
    return value
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\r\n/g, "\n")
      .trimEnd();
  }

  async function graphqlRequest<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-csrftoken":
          document.cookie
            .split("; ")
            .find((part) => part.startsWith("csrftoken="))
            ?.split("=")[1] ?? ""
      },
      body: JSON.stringify({
        operationName,
        query,
        variables
      })
    });

    const json = (await response.json()) as {
      data?: T;
      errors?: Array<{ message?: string }>;
    };

    if (!response.ok) {
      const errorText =
        json.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        `GraphQL request failed: ${response.status}`;
      throw new Error(errorText);
    }

    if (!json.data) {
      const errorText =
        json.errors?.map((error) => error.message).filter(Boolean).join("; ") ||
        "GraphQL response missing data";
      throw new Error(errorText);
    }

    return json.data;
  }

  async function fetchQuestion(slug: string): Promise<SubmissionBundle["question"]> {
    const cached = questionCache.get(slug);
    if (cached) return cached;

    const data = await graphqlRequest<{
      question: {
        questionFrontendId: string;
        title: string;
        titleSlug: string;
        content: string;
        difficulty: string;
      } | null;
    }>(
      "questionData",
      `
        query questionData($titleSlug: String!) {
          question(titleSlug: $titleSlug) {
            questionFrontendId
            title
            titleSlug
            content
            difficulty
          }
        }
      `,
      { titleSlug: slug }
    );

    if (!data.question) {
      throw new Error("Question metadata not found");
    }

    questionCache.set(slug, data.question);
    return data.question;
  }

  async function fetchLatestAcceptedSubmissionSummary(slug: string): Promise<{
    id: string;
    timestamp?: string;
  } | null> {
    const data = await graphqlRequest<{
      questionSubmissionList: {
        submissions: Array<{
          id: string;
          timestamp?: string;
        }>;
      };
    }>(
      "submissionList",
      `
        query submissionList(
          $offset: Int!,
          $limit: Int!,
          $lastKey: String,
          $questionSlug: String!,
          $lang: Int,
          $status: Int
        ) {
          questionSubmissionList(
            offset: $offset
            limit: $limit
            lastKey: $lastKey
            questionSlug: $questionSlug
            lang: $lang
            status: $status
          ) {
            lastKey
            hasNext
            submissions {
              id
              timestamp
            }
          }
        }
      `,
      {
        questionSlug: slug,
        limit: 20,
        offset: 0,
        lastKey: null,
        status: 10
      }
    );

    const latest = data.questionSubmissionList?.submissions?.[0];
    if (!latest?.id) return null;

    return {
      id: String(latest.id),
      timestamp: latest.timestamp
    };
  }

  async function fetchSubmissionDetail(
    submissionId: string
  ): Promise<SubmissionBundle["submission"]> {
    const data = await graphqlRequest<{
      submissionDetails: {
        runtime?: string;
        runtimeDisplay?: string;
        runtimePercentile?: number;
        memory?: string;
        memoryDisplay?: string;
        memoryPercentile?: number;
        code: string;
        timestamp?: string;
        statusCode?: number;
        lang?: {
          name?: string;
          verboseName?: string;
        };
      } | null;
    }>(
      "submissionDetails",
      `
        query submissionDetails($submissionId: Int!) {
          submissionDetails(submissionId: $submissionId) {
            runtime
            runtimeDisplay
            runtimePercentile
            memory
            memoryDisplay
            memoryPercentile
            code
            timestamp
            statusCode
            lang {
              name
              verboseName
            }
          }
        }
      `,
      {
        submissionId: Number(submissionId)
      }
    );

    const detail = data.submissionDetails;
    if (!detail) {
      throw new Error("Submission detail not found");
    }

    return {
      id: submissionId,
      code: detail.code ?? "",
      language: detail.lang?.verboseName || detail.lang?.name,
      runtime: detail.runtimeDisplay || detail.runtime,
      memory: detail.memoryDisplay || detail.memory,
      runtimePercentile: detail.runtimePercentile,
      memoryPercentile: detail.memoryPercentile,
      timestamp: detail.timestamp,
      statusDisplay: detail.statusCode === 10 ? "Accepted" : undefined,
      accepted: detail.statusCode === 10
    };
  }

  function isFreshAcceptedSubmission(timestamp?: string): boolean {
    if (!timestamp) return true;

    const numeric = Number(timestamp);
    const millis =
      Number.isFinite(numeric) && numeric > 0 ? numeric * 1000 : Date.parse(timestamp);

    if (!Number.isFinite(millis)) return true;
    return Date.now() - millis <= 10 * 60 * 1000;
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForAcceptedSubmissionDetail(
    submissionId: string
  ): Promise<SubmissionBundle["submission"]> {
    const delays = [700, 1200, 1800, 2500, 3000, 3500, 4000, 4000];
    let lastAcceptedWithCode: SubmissionBundle["submission"] | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      const submission = await fetchSubmissionDetail(submissionId);
      const normalizedCode = normalizeCode(submission.code);

      if (submission.accepted && normalizedCode) {
        lastAcceptedWithCode = {
          ...submission,
          code: normalizedCode
        };

        return lastAcceptedWithCode;
      }

      if (attempt < delays.length) {
        await sleep(delays[attempt]);
      }
    }

    if (lastAcceptedWithCode) {
      return lastAcceptedWithCode;
    }

    throw new Error("Submission detail not ready before timeout");
  }

  async function getLatestAcceptedSubmissionBundle(
    slug: string
  ): Promise<SubmissionBundle> {
    const summaryDelays = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];

    for (let attempt = 0; attempt <= summaryDelays.length; attempt += 1) {
      const summary = await fetchLatestAcceptedSubmissionSummary(slug);

      if (summary?.id && isFreshAcceptedSubmission(summary.timestamp)) {
        const [question, submission] = await Promise.all([
          fetchQuestion(slug),
          waitForAcceptedSubmissionDetail(summary.id)
        ]);

        return {
          question,
          submission
        };
      }

      if (attempt < summaryDelays.length) {
        await sleep(summaryDelays[attempt]);
      }
    }

    throw new Error("No fresh accepted submission found");
  }

  async function getSubmissionBundleById(
    slug: string,
    submissionId: string
  ): Promise<SubmissionBundle> {
    const [question, submission] = await Promise.all([
      fetchQuestion(slug),
      waitForAcceptedSubmissionDetail(submissionId)
    ]);

    return {
      question,
      submission
    };
  }

  async function handleRequest(request: BridgeRequest): Promise<SubmissionBundle> {
    switch (request.action) {
      case "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE":
        return getLatestAcceptedSubmissionBundle(request.payload.slug);
      case "GET_SUBMISSION_BUNDLE_BY_ID":
        return getSubmissionBundleById(
          request.payload.slug,
          request.payload.submissionId
        );
      default:
        throw new Error("Unsupported request action");
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data as BridgeRequest | undefined;
    if (!data) return;
    if (data.source !== BRIDGE_SOURCE) return;
    if (data.type !== REQUEST_TYPE) return;

    void handleRequest(data)
      .then((result) => {
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            type: RESPONSE_TYPE,
            requestId: data.requestId,
            ok: true,
            payload: result
          },
          "*"
        );
      })
      .catch((error) => {
        window.postMessage(
          {
            source: BRIDGE_SOURCE,
            type: RESPONSE_TYPE,
            requestId: data.requestId,
            ok: false,
            error: error instanceof Error ? error.message : "Unknown LeetCode API error"
          },
          "*"
        );
      });
  });
})();
