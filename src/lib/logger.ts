export const LOG_LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  OFF: 100
} as const;

type LogLevelName = keyof typeof LOG_LEVELS;

const CURRENT_LEVEL: LogLevelName = "DEBUG";

function shouldLog(level: LogLevelName): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function prefix(scope: string, level: LogLevelName): string {
  return `[${scope}] ${level}`;
}

function normalizeData(data: unknown): unknown {
  if (data === undefined || data === null) return data;
  if (typeof data !== "object") return data;

  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return data;
  }
}

export const logger = {
  debug(scope: string, message: string, data?: unknown) {
    if (!shouldLog("DEBUG")) return;
    if (data === undefined) {
      console.log(`${prefix(scope, "DEBUG")} ${message}`);
    } else {
      console.log(`${prefix(scope, "DEBUG")} ${message}`, normalizeData(data));
    }
  },

  info(scope: string, message: string, data?: unknown) {
    if (!shouldLog("INFO")) return;
    if (data === undefined) {
      console.info(`${prefix(scope, "INFO")} ${message}`);
    } else {
      console.info(`${prefix(scope, "INFO")} ${message}`, normalizeData(data));
    }
  },

  warn(scope: string, message: string, data?: unknown) {
    if (!shouldLog("WARN")) return;
    if (data === undefined) {
      console.warn(`${prefix(scope, "WARN")} ${message}`);
    } else {
      console.warn(`${prefix(scope, "WARN")} ${message}`, normalizeData(data));
    }
  },

  error(scope: string, message: string, data?: unknown) {
    if (!shouldLog("ERROR")) return;
    if (data === undefined) {
      console.error(`${prefix(scope, "ERROR")} ${message}`);
    } else {
      console.error(`${prefix(scope, "ERROR")} ${message}`, normalizeData(data));
    }
  }
};
