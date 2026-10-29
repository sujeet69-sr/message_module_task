import { getEnvConfig } from '../config/env.js';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

const LOG_LEVELS: Record<LogLevel, number> = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function redactSensitiveData(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('password') ||
      lowerKey.includes('authorization') ||
      lowerKey.includes('api_key')
    ) {
      result[key] = '[REDACTED_SECRET]';
    } else if (lowerKey === 'text' && typeof value === 'string') {
      result[key] = `[REDACTED_TEXT len=${value.length}]`;
    } else if ((lowerKey === 'to' || lowerKey === 'recipient_to') && typeof value === 'string') {
      result[key] = value.length > 5 ? `${value.slice(0, 3)}****${value.slice(-3)}` : '****';
    } else if (typeof value === 'object') {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export class Logger {
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}) {
    this.context = context;
  }

  public child(extraContext: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extraContext });
  }

  private shouldLog(level: LogLevel): boolean {
    const config = getEnvConfig();
    const configuredLevel = config.LOG_LEVEL || 'info';
    return LOG_LEVELS[level] <= LOG_LEVELS[configuredLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const payload = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      ...this.context,
      ...(meta ? redactSensitiveData(meta) : {}),
    };

    const output = JSON.stringify(payload);
    if (level === 'error' || level === 'fatal') {
      console.error(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.formatMessage('info', message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.formatMessage('warn', message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.formatMessage('error', message, meta);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.formatMessage('debug', message, meta);
  }
}

export const logger = new Logger({ service: 'multi-tenant-messaging-api' });
