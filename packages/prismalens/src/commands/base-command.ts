import { Logger } from '../services/logger.js';
import { ShutdownService } from '../services/shutdown.js';
import { getConfig, type GlobalConfig } from '@prismalens/config';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CommandOptions {
  [key: string]: unknown;
}

/**
 * Base class for all CLI commands.
 * Provides common functionality for initialization, shutdown, and path resolution.
 */
export abstract class BaseCommand {
  protected logger: Logger;
  protected shutdownService: ShutdownService;
  protected config!: GlobalConfig;
  protected configError: Error | null = null;

  // Paths resolved from package installation location
  protected readonly pkgRoot: string;
  protected readonly bundledPath: string;
  protected readonly apiPath: string;
  protected readonly frontendPath: string;
  protected readonly workerPath: string;
  protected readonly prismaPath: string;

  constructor() {
    this.logger = new Logger(this.constructor.name);
    this.shutdownService = ShutdownService.getInstance();

    // Resolve paths relative to package root
    // __dirname is src/commands, so go up 2 levels to package root
    this.pkgRoot = resolve(__dirname, '..', '..');
    this.bundledPath = resolve(this.pkgRoot, 'bundled');
    this.apiPath = resolve(this.bundledPath, 'api');
    this.frontendPath = resolve(this.bundledPath, 'frontend');
    this.workerPath = resolve(this.bundledPath, 'worker');
    this.prismaPath = resolve(this.pkgRoot, 'prisma');
  }

  /**
   * Initialize the command.
   * Called before run() to set up configuration and signal handlers.
   */
  async init(): Promise<void> {
    // Register shutdown handler
    this.shutdownService.registerHandler(() => this.shutdown());

    // Try to load config, but don't fail if it's not available
    // Some commands (like init) may run without full config
    try {
      this.config = getConfig();
    } catch (error) {
      this.configError = error instanceof Error ? error : new Error(String(error));
      this.logger.debug(`Config not available: ${this.configError.message}`);
    }
  }

  /**
   * Ensure configuration is loaded. Throws if not available.
   */
  protected requireConfig(): GlobalConfig {
    if (!this.config) {
      if (this.configError) {
        throw this.configError;
      }
      throw new Error('Configuration not loaded');
    }
    return this.config;
  }

  /**
   * Execute the command.
   * Override this method in subclasses.
   */
  abstract run(options: CommandOptions): Promise<void>;

  /**
   * Clean up resources on shutdown.
   * Override in subclasses for custom cleanup.
   */
  protected async shutdown(): Promise<void> {
    this.logger.debug('Base shutdown complete');
  }

  /**
   * Validate that bundled assets exist.
   * Call this from commands that need the bundled files.
   */
  protected validateBundledAssets(): void {
    if (!existsSync(this.bundledPath)) {
      throw new Error(
        `Bundled assets not found at ${this.bundledPath}. ` +
          'Did you run "pnpm build:bundle" or install from npm?',
      );
    }

    const requiredPaths = [
      { path: this.apiPath, name: 'API' },
      { path: this.frontendPath, name: 'Frontend' },
      { path: this.workerPath, name: 'Worker' },
    ];

    for (const { path, name } of requiredPaths) {
      if (!existsSync(path)) {
        throw new Error(
          `${name} bundle not found at ${path}. ` +
            'The package may be corrupted. Try reinstalling.',
        );
      }
    }
  }

  /**
   * Check if we're running in development mode (from source).
   */
  protected isDevelopmentMode(): boolean {
    // In development, bundled directory won't exist
    return !existsSync(this.bundledPath);
  }
}
