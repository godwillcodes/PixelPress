/**
 * Centralized logging system for the Exact80 compression service
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  requestId?: string;
  context?: string;
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  private formatMessage(level: LogLevel, message: string, data?: any, requestId?: string, context?: string): string {
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const requestPrefix = requestId ? `[${requestId}]` : '';
    const contextPrefix = context ? `[${context}]` : '';
    
    return `${timestamp} ${requestPrefix}${contextPrefix} [${levelName}] ${message}`;
  }

  private log(level: LogLevel, message: string, data?: any, requestId?: string, context?: string): void {
    if (!this.shouldLog(level)) return;

    const formattedMessage = this.formatMessage(level, message, data, requestId, context);
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, data || '');
        break;
      case LogLevel.INFO:
        console.log(formattedMessage, data || '');
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, data || '');
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage, data || '');
        break;
    }
  }

  debug(message: string, data?: any, requestId?: string, context?: string): void {
    this.log(LogLevel.DEBUG, message, data, requestId, context);
  }

  info(message: string, data?: any, requestId?: string, context?: string): void {
    this.log(LogLevel.INFO, message, data, requestId, context);
  }

  warn(message: string, data?: any, requestId?: string, context?: string): void {
    this.log(LogLevel.WARN, message, data, requestId, context);
  }

  error(message: string, data?: any, requestId?: string, context?: string): void {
    this.log(LogLevel.ERROR, message, data, requestId, context);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}

export const logger = new Logger(
  process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO
);

