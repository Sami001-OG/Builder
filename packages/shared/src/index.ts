export type ErrorCode =
  | 'MODEL_ERROR' | 'AUTH_ERROR' | 'TOOL_ERROR' | 'FILESYSTEM_ERROR'
  | 'BUILD_ERROR' | 'RUNTIME_ERROR' | 'DEPENDENCY_ERROR' | 'PREVIEW_ERROR'
  | 'GIT_ERROR' | 'GITHUB_ERROR' | 'TIMEOUT' | 'USER_ABORTED' | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export class BuilderError extends Error {
  code: ErrorCode;
  details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'BuilderError';
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogFields { [k: string]: unknown; }

const SECRET_KEYS = [/api[_-]?key/i, /secret/i, /token/i, /password/i, /private[_-]?key/i, /authorization/i, /cookie/i, /set-cookie/i];
export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    // redact bearer tokens / long secrets heuristically
    if (value.length > 24 && /sk-|ghp_|gho_|xoxb-|Bearer/i.test(value)) return '[REDACTED]';
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.some((r) => r.test(k)) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export function createLogger(scope: string, level: LogLevel = 'info'): Logger {
  const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const enabled = (l: LogLevel) => order.indexOf(l) >= order.indexOf(level);
  const emit = (l: LogLevel, msg: string, fields?: LogFields) => {
    if (!enabled(l)) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: l, scope, msg, ...(fields ? { fields: redact(fields) } : {}) });
    if (l === 'error' || l === 'warn') console.error(line);
    else console.log(line);
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => { t = setTimeout(() => rej(new BuilderError('TIMEOUT', `${label} timed out after ${ms}ms`)), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
