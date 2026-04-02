export const LOG_LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  OFF: 100
} as const;

export type LogLevelName = keyof typeof LOG_LEVELS;

const CURRENT_LEVEL: LogLevelName = "DEBUG"; // change to INFO for quieter logs

function shouldLog(level: LogLevelName): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

function prefix(scope: string, level: LogLevelName): string {
  return `[${scope}] ${level}`;
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(
    value,
    (_key, currentValue) => {
      if (currentValue instanceof Error) {
        return {
          name: currentValue.name,
          message: currentValue.message,
          stack: currentValue.stack
        };
      }

      if (typeof currentValue === "object" && currentValue !== null) {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }
        seen.add(currentValue);
      }

      return currentValue;
    },
    2
  );
}

function formatData(data: unknown): unknown {
  if (data === undefined) return undefined;
  if (data === null) return null;

  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean" ||
    typeof data === "bigint"
  ) {
    return data;
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack
    };
  }

  try {
    return safeStringify(data);
  } catch {
    try {
      return String(data);
    } catch {
      return "[Unserializable]";
    }
  }
}

function write(
  method: "log" | "info" | "warn" | "error",
  level: LogLevelName,
  scope: string,
  message: string,
  data?: unknown
): void {
  if (!shouldLog(level)) return;

  const line = `${prefix(scope, level)} ${message}`;

  if (data === undefined) {
    console[method](line);
    return;
  }

  console[method](line, formatData(data));
}

export const logger = {
  debug(scope: string, message: string, data?: unknown): void {
    write("log", "DEBUG", scope, message, data);
  },

  info(scope: string, message: string, data?: unknown): void {
    write("info", "INFO", scope, message, data);
  },

  warn(scope: string, message: string, data?: unknown): void {
    write("warn", "WARN", scope, message, data);
  },

  error(scope: string, message: string, data?: unknown): void {
    write("error", "ERROR", scope, message, data);
  }
};
