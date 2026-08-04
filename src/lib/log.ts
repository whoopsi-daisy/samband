/**
 * Logging, with a level and a scope.
 *
 * Everything wrote straight to console with a hand-typed prefix: `[db]`,
 * `[bpk]`, `[auth]`, `[scheduler]`, `[vma]`, `[ui]`. Six conventions, no level,
 * and no way to turn any of it up or down. The consequences were small
 * individually and awkward together:
 *
 *  - A container logging at info forever, with the noisy paths (a search index
 *    rebuild, an import emitting a line every fifteen seconds) sharing a stream
 *    with the things an operator actually needs to see. `docker compose` caps
 *    the log at 10 MB × 3, so under any real error rate the history that
 *    matters is the first thing pushed out.
 *  - No way to ask for more when diagnosing, because there was no "more".
 *  - Prefixes that drifted: a typo in one is invisible until someone greps for
 *    it and finds nothing.
 *
 * Deliberately small. This is a single-container app whose logs are read with
 * `docker compose logs -f`, so the output stays human-readable lines rather
 * than JSON, and structured fields are appended as `key=value` where they help.
 * SAMBAND_LOG_FORMAT=json switches to one JSON object per line for anyone
 * shipping these somewhere that would rather parse them.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function configuredLevel(): LogLevel {
  const raw = process.env.SAMBAND_LOG_LEVEL?.trim().toLowerCase();
  const named = LOG_LEVELS.find((level) => level === raw);
  if (named) return named;
  // Tests are noisy enough without it, and a failing assertion says more than
  // the line that preceded it.
  if (process.env.NODE_ENV === 'test') return 'silent';
  return 'info';
}

function jsonOutput(): boolean {
  return process.env.SAMBAND_LOG_FORMAT?.trim().toLowerCase() === 'json';
}

/**
 * Extra context on a line. Values are rendered as `key=value`, with anything
 * containing a space quoted so a reader (or an awk one-liner) can still tell
 * where a field ends.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

function renderFields(fields: LogFields): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    parts.push(`${key}=${/[\s"]/.test(text) ? JSON.stringify(text) : text}`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * An error as one readable line.
 *
 * A bare `console.error(err)` prints a stack, which is right when the cause is
 * ours and pure noise when it is a refused connection to someone else's server.
 * The message is what identifies the failure; the stack goes out only at debug.
 */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeText = cause instanceof Error ? `: ${cause.message}` : '';
    return `${error.message}${causeText}`;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  /** `error` is anything thrown; its message is folded into the line. */
  error(message: string, error?: unknown, fields?: LogFields): void;
  /** A logger under this one, e.g. `logger('db').child('migration')`. */
  child(suffix: string): Logger;
}

const CONSOLE: Record<Exclude<LogLevel, 'silent'>, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function emit(scope: string, level: Exclude<LogLevel, 'silent'>, message: string, fields: LogFields): void {
  if (RANK[level] < RANK[configuredLevel()]) return;

  if (jsonOutput()) {
    const payload: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      scope,
      message,
    };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) payload[key] = value;
    }
    CONSOLE[level](JSON.stringify(payload));
    return;
  }

  CONSOLE[level](`[${scope}] ${message}${renderFields(fields)}`);
}

export function logger(scope: string): Logger {
  return {
    debug: (message, fields = {}) => emit(scope, 'debug', message, fields),
    info: (message, fields = {}) => emit(scope, 'info', message, fields),
    warn: (message, fields = {}) => emit(scope, 'warn', message, fields),
    error: (message, error, fields = {}) => {
      const withCause = error === undefined ? fields : { ...fields, error: describeError(error) };
      emit(scope, 'error', message, withCause);
      // The stack is the part worth having when the fault is ours, and the part
      // worth suppressing when it is a network blip. Only at debug.
      if (error instanceof Error && error.stack && RANK.debug >= RANK[configuredLevel()]) {
        CONSOLE.debug(error.stack);
      }
    },
    child: (suffix) => logger(`${scope}:${suffix}`),
  };
}

/** The level actually in effect, for the health endpoint to report. */
export function currentLogLevel(): LogLevel {
  return configuredLevel();
}
