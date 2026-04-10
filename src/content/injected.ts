(() => {
  const FLAG = "__leetcodeSyncInjected";
  const BRIDGE_SOURCE = "leetcode-sync";
  const REQUEST_TYPE = "LEETCODE_API_REQUEST";
  const RESPONSE_TYPE = "LEETCODE_API_RESPONSE";

  type BridgeRequest =
    | {
        source: typeof BRIDGE_SOURCE;
        type: typeof REQUEST_TYPE;
        requestId: string;
        action: "GET_LATEST_ACCEPTED_SUBMISSION_BUNDLE";
        payload: { slug: string };
      }
    | {
        source: typeof BRIDGE_SOURCE;
        type: typeof REQUEST_TYPE;
        requestId: string;
        action: "GET_SUBMISSION_BUNDLE_BY_ID";
        payload: { slug: string; submissionId: string };
      };

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

  const globalWindow = window as Window & {
    [FLAG]?: boolean;
  };

  if (globalWindow[FLAG]) {
    return;
  }

  globalWindow[FLAG] = true;

  function getCsrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return match?.[1] ?? "";
  }

  async function graphqlRequest<T>(
    operationName: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch("/graphql/", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-csrftoken": getCsrfToken(),
        "x-requested-with": "XMLHttpRequest"
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
          statusDisplay?: string;
          lang?: string;
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
              title
              titleSlug
              status
              statusDisplay
              lang
              langName
              runtime
              timestamp
              url
              isPending
              memory
              hasNotes
              notes
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
    if (!latest?.id) {
      return null;
    }

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
    if (!detail?.code?.trim()) {
      throw new Error("Submission detail code not found");
    }

    return {
      id: submissionId,
      code: detail.code,
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
      Number.isFinite(numeric) && numeric > 0
        ? numeric * 1000
        : Date.parse(timestamp);

    if (!Number.isFinite(millis)) {
      return true;
    }

    return Date.now() - millis <= 5 * 60 * 1000;
  }

  async function getLatestAcceptedSubmissionBundle(
    slug: string
  ): Promise<SubmissionBundle> {
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const summary = await fetchLatestAcceptedSubmissionSummary(slug);

      if (summary?.id && isFreshAcceptedSubmission(summary.timestamp)) {
        const [question, submission] = await Promise.all([
          fetchQuestion(slug),
          fetchSubmissionDetail(summary.id)
        ]);

        return {
          question,
          submission
        };
      }

      const delay = Math.min(1000 * 2 ** attempt, 4000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    throw new Error("No fresh accepted submission found");
  }

  async function getSubmissionBundleById(
    slug: string,
    submissionId: string
  ): Promise<SubmissionBundle> {
    const [question, submission] = await Promise.all([
      fetchQuestion(slug),
      fetchSubmissionDetail(submissionId)
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
