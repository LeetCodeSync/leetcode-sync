export type UserFacingErrorCode =
  | "INVALID_REPOSITORY_URL"
  | "BRANCH_NOT_FOUND"
  | "GITHUB_NOT_CONNECTED"
  | "FAST_FORWARD_CONFLICT"
  | "PROBLEM_NUMBER_PARSE_FAILED"
  | "GITHUB_AUTH_INVALID"
  | "REPOSITORY_NOT_ACCESSIBLE"
  | "INVALID_CLIENT_ID"
  | "INVALID_BRANCH"
  | "SYNC_ALREADY_IN_PROGRESS"
  | "SYNC_COOLDOWN"
  | "UNKNOWN";

export class AppError extends Error {
  code: UserFacingErrorCode;
  userMessage: string;
  details?: unknown;

  constructor(
    code: UserFacingErrorCode,
    userMessage: string,
    message?: string,
    details?: unknown
  ) {
    super(message ?? userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

export function toUserMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (error instanceof AppError) {
    return error.userMessage;
  }

  return fallback;
}
