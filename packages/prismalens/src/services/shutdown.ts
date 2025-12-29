import { Logger } from './logger.js';

type ShutdownHandler = () => Promise<void> | void;

/**
 * Graceful shutdown service.
 * Singleton that manages signal handlers and cleanup on process termination.
 */
export class ShutdownService {
  private static instance: ShutdownService | null = null;
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;
  private logger: Logger;

  private constructor() {
    this.logger = new Logger('ShutdownService');
    this.setupSignalHandlers();
  }

  static getInstance(): ShutdownService {
    if (!ShutdownService.instance) {
      ShutdownService.instance = new ShutdownService();
    }
    return ShutdownService.instance;
  }

  /**
   * Register a handler to be called during shutdown.
   * Handlers are called in reverse order (LIFO).
   */
  registerHandler(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Alias for registerHandler for API compatibility with n8n pattern.
   */
  registerHandlers(handler: ShutdownHandler): void {
    this.registerHandler(handler);
  }

  private setupSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

    for (const signal of signals) {
      process.on(signal, async () => {
        this.logger.info(`Received ${signal}, initiating graceful shutdown...`);
        await this.shutdown();
      });
    }

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      this.logger.error(`Uncaught exception: ${error.message}`);
      console.error(error.stack);
      await this.shutdown(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      this.logger.error(`Unhandled rejection: ${reason}`);
      await this.shutdown(1);
    });
  }

  private async shutdown(exitCode = 0): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Call handlers in reverse order (LIFO)
    const reversedHandlers = [...this.handlers].reverse();

    for (const handler of reversedHandlers) {
      try {
        await handler();
      } catch (error) {
        this.logger.error(
          `Error in shutdown handler: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.info('Shutdown complete');
    process.exit(exitCode);
  }
}
