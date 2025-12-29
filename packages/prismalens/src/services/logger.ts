import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Simple structured logger for CLI output.
 */
export class Logger {
  private context: string;
  private static logLevel: LogLevel = 'info';

  constructor(context: string) {
    this.context = context;
  }

  static setLogLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(Logger.logLevel);
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}]`;

    switch (level) {
      case 'debug':
        return `${chalk.gray(prefix)} ${chalk.blue('DEBUG')} ${chalk.dim(`[${this.context}]`)} ${message}`;
      case 'info':
        return `${chalk.gray(prefix)} ${chalk.green('INFO')}  ${chalk.dim(`[${this.context}]`)} ${message}`;
      case 'warn':
        return `${chalk.gray(prefix)} ${chalk.yellow('WARN')}  ${chalk.dim(`[${this.context}]`)} ${message}`;
      case 'error':
        return `${chalk.gray(prefix)} ${chalk.red('ERROR')} ${chalk.dim(`[${this.context}]`)} ${message}`;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }

  /**
   * Log a success message (always shown).
   */
  success(message: string): void {
    console.log(`${chalk.green('✓')} ${message}`);
  }

  /**
   * Log a simple message without formatting (for user-facing output).
   */
  log(message: string): void {
    console.log(message);
  }
}
