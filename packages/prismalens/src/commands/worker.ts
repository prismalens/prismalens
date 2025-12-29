import { BaseCommand, type CommandOptions } from './base-command.js';
import { spawn, type ChildProcess } from 'child_process';
import { WheelInstaller } from '../worker/wheel-installer.js';
import ora from 'ora';
import chalk from 'chalk';

export interface WorkerOptions extends CommandOptions {
  // Add any worker-specific options here
}

/**
 * Worker command - starts only the Python worker process.
 * Use this when running in a distributed setup where API runs separately.
 */
export class WorkerCommand extends BaseCommand {
  private workerProcess?: ChildProcess;

  async run(_options: WorkerOptions): Promise<void> {
    this.requireConfig();

    console.log(chalk.bold('\n  PrismaLens Worker\n'));

    // Validate bundled assets exist
    this.validateBundledAssets();

    await this.startWorker();

    console.log(chalk.green('\n  Worker is running.'));
    console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

    // Keep process alive
    await new Promise(() => {});
  }

  private async startWorker(): Promise<void> {
    const spinner = ora('Starting Python worker...').start();

    try {
      // Ensure Python dependencies are installed
      await WheelInstaller.ensureInstalled(this.workerPath);

      this.workerProcess = spawn('python3', ['-m', 'prismalens_worker'], {
        cwd: this.workerPath,
        env: { ...process.env },
        stdio: 'inherit',
      });

      // Wait a moment to verify worker started
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 3000);

        this.workerProcess?.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        this.workerProcess?.on('close', (code) => {
          if (code !== 0 && code !== null) {
            clearTimeout(timeout);
            reject(new Error(`Worker process exited with code ${code}`));
          }
        });
      });

      spinner.succeed('Python worker started');
    } catch (error) {
      spinner.fail('Failed to start Python worker');
      throw error;
    }
  }

  protected async shutdown(): Promise<void> {
    this.logger.info('Stopping worker...');

    if (this.workerProcess) {
      this.workerProcess.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.logger.warn('Worker did not exit gracefully, forcing...');
          this.workerProcess?.kill('SIGKILL');
          resolve();
        }, 10000);

        this.workerProcess?.on('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    await super.shutdown();
  }
}
