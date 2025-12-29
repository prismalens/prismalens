import { BaseCommand, type CommandOptions } from './base-command.js';
import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DevOptions extends CommandOptions {
  port: string;
  frontendPort: string;
  host: string;
  apiOnly?: boolean;
  frontendOnly?: boolean;
  workerOnly?: boolean;
}

/**
 * Dev command - runs services in development mode with hot reload.
 * Uses the source packages instead of bundled assets.
 */
export class DevCommand extends BaseCommand {
  private apiProcess?: ChildProcess;
  private frontendProcess?: ChildProcess;
  private workerProcess?: ChildProcess;

  // In dev mode, resolve paths to source packages
  private readonly packagesRoot: string;

  constructor() {
    super();
    // Go up from packages/prismalens/src/commands to packages/
    this.packagesRoot = resolve(__dirname, '..', '..', '..', '..');
  }

  async run(options: DevOptions): Promise<void> {
    console.log(chalk.bold('\n  PrismaLens Development Mode\n'));

    const runAll = !options.apiOnly && !options.frontendOnly && !options.workerOnly;

    // Start services based on flags
    const promises: Promise<void>[] = [];

    if (runAll || options.apiOnly) {
      promises.push(this.startApi(options.host, parseInt(options.port, 10)));
    }

    if (runAll || options.frontendOnly) {
      const frontendPort = parseInt(options.frontendPort, 10);
      promises.push(this.startFrontend(frontendPort));
    }

    if (runAll || options.workerOnly) {
      promises.push(this.startWorker());
    }

    await Promise.all(promises);

    console.log(chalk.green('\n  Development servers running:'));
    if (runAll || options.apiOnly) {
      console.log(chalk.dim('    API:     ') + chalk.cyan(`http://${options.host}:${options.port}`));
    }
    if (runAll || options.frontendOnly) {
      console.log(
        chalk.dim('    Frontend: ') + chalk.cyan(`http://${options.host}:${options.frontendPort}`),
      );
    }
    if (runAll || options.workerOnly) {
      console.log(chalk.dim('    Worker:   ') + chalk.green('running'));
    }
    console.log(chalk.dim('\n  Press Ctrl+C to stop.\n'));

    // Keep process alive
    await new Promise(() => {});
  }

  private async startApi(host: string, port: number): Promise<void> {
    const apiPath = resolve(this.packagesRoot, 'api');

    if (!existsSync(apiPath)) {
      throw new Error(`API package not found at ${apiPath}`);
    }

    console.log(chalk.dim('  Starting API in watch mode...'));

    this.apiProcess = spawn('pnpm', ['dev'], {
      cwd: apiPath,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: host,
        NODE_ENV: 'development',
      },
      stdio: 'inherit',
      shell: true,
    });

    this.apiProcess.on('error', (error) => {
      this.logger.error(`API process error: ${error.message}`);
    });
  }

  private async startFrontend(port: number): Promise<void> {
    const frontendPath = resolve(this.packagesRoot, 'frontend');

    if (!existsSync(frontendPath)) {
      throw new Error(`Frontend package not found at ${frontendPath}`);
    }

    console.log(chalk.dim('  Starting Frontend in watch mode...'));

    this.frontendProcess = spawn('pnpm', ['dev', '-p', String(port)], {
      cwd: frontendPath,
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
      stdio: 'inherit',
      shell: true,
    });

    this.frontendProcess.on('error', (error) => {
      this.logger.error(`Frontend process error: ${error.message}`);
    });
  }

  private async startWorker(): Promise<void> {
    const workerPath = resolve(this.packagesRoot, '@prismalens', 'worker-python');

    if (!existsSync(workerPath)) {
      throw new Error(`Worker package not found at ${workerPath}`);
    }

    console.log(chalk.dim('  Starting Worker...'));

    // Use uv run for development
    this.workerProcess = spawn('uv', ['run', 'python', '-m', 'prismalens_worker'], {
      cwd: workerPath,
      env: { ...process.env },
      stdio: 'inherit',
      shell: true,
    });

    this.workerProcess.on('error', (error) => {
      this.logger.error(`Worker process error: ${error.message}`);
    });
  }

  protected async shutdown(): Promise<void> {
    this.logger.info('Stopping development servers...');

    const killProcess = (proc: ChildProcess | undefined, name: string): Promise<void> => {
      return new Promise((resolve) => {
        if (!proc) {
          resolve();
          return;
        }

        const timeout = setTimeout(() => {
          this.logger.warn(`${name} did not exit gracefully, forcing...`);
          proc.kill('SIGKILL');
          resolve();
        }, 5000);

        proc.on('close', () => {
          clearTimeout(timeout);
          this.logger.debug(`${name} stopped`);
          resolve();
        });

        proc.kill('SIGTERM');
      });
    };

    await Promise.all([
      killProcess(this.workerProcess, 'Worker'),
      killProcess(this.frontendProcess, 'Frontend'),
      killProcess(this.apiProcess, 'API'),
    ]);

    await super.shutdown();
  }
}
