import { Command } from 'commander';
import { createRequire } from 'module';
import chalk from 'chalk';

import { StartCommand } from './commands/start.js';
import { WorkerCommand } from './commands/worker.js';
import { DevCommand } from './commands/dev.js';
import { MigrateCommand, PushCommand } from './commands/db/index.js';
import { Logger } from './services/logger.js';

const require = createRequire(import.meta.url);

/**
 * Command registry - sets up Commander.js with all available commands.
 */
export class CommandRegistry {
  private program: Command;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CommandRegistry');
    this.program = new Command();
    this.setupProgram();
    this.registerCommands();
  }

  private setupProgram(): void {
    const pkg = require('../package.json');

    this.program
      .name('prismalens')
      .description('AI-powered incident investigation platform')
      .version(pkg.version, '-v, --version', 'Output the version number')
      .option('--debug', 'Enable debug output')
      .hook('preAction', (thisCommand) => {
        const opts = thisCommand.opts();
        if (opts.debug) {
          Logger.setLogLevel('debug');
          process.env.DEBUG = '1';
        }
      });
  }

  private registerCommands(): void {
    // start command
    this.program
      .command('start')
      .description('Start the PrismaLens server')
      .option('-p, --port <port>', 'Port to listen on', '5367')
      .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
      .option('--main-only', 'Only start API and frontend (no worker)')
      .option('--skip-migrations', 'Skip database migrations')
      .action(async (options) => {
        const command = new StartCommand();
        await command.init();
        await command.run(options);
      });

    // worker command
    this.program
      .command('worker')
      .description('Start only the Python worker process')
      .action(async (options) => {
        const command = new WorkerCommand();
        await command.init();
        await command.run(options);
      });

    // dev command
    this.program
      .command('dev')
      .description('Start services in development mode with hot reload')
      .option('-p, --port <port>', 'API port', '5367')
      .option('--frontend-port <port>', 'Frontend port', '5368')
      .option('-H, --host <host>', 'Host to bind to', 'localhost')
      .option('--api-only', 'Only start the API')
      .option('--frontend-only', 'Only start the frontend')
      .option('--worker-only', 'Only start the worker')
      .action(async (options) => {
        const command = new DevCommand();
        await command.init();
        await command.run(options);
      });

    // db command group
    const dbCommand = this.program
      .command('db')
      .description('Database management commands');

    dbCommand
      .command('migrate')
      .description('Run database migrations')
      .option('--dev', 'Run in development mode (creates migrations)')
      .option('--reset', 'Reset the database (WARNING: deletes all data)')
      .action(async (options) => {
        const command = new MigrateCommand();
        await command.init();
        await command.run(options);
      });

    dbCommand
      .command('push')
      .description('Push schema changes directly (for prototyping)')
      .option('--force', 'Accept data loss')
      .action(async (options) => {
        const command = new PushCommand();
        await command.init();
        await command.run(options);
      });

    // info command
    this.program
      .command('info')
      .description('Show system information')
      .action(async () => {
        await this.showInfo();
      });
  }

  private async showInfo(): Promise<void> {
    const pkg = require('../package.json');

    console.log(chalk.bold('\n  PrismaLens System Information\n'));
    console.log(chalk.dim('  Version:    ') + pkg.version);
    console.log(chalk.dim('  Node.js:    ') + process.versions.node);
    console.log(chalk.dim('  Platform:   ') + process.platform);
    console.log(chalk.dim('  Arch:       ') + process.arch);

    // Check Python version
    try {
      const { spawnSync } = await import('child_process');
      const result = spawnSync('python3', ['--version'], { encoding: 'utf-8' });
      if (!result.error) {
        const version = (result.stdout || result.stderr).trim();
        console.log(chalk.dim('  Python:     ') + version.replace('Python ', ''));
      }
    } catch {
      console.log(chalk.dim('  Python:     ') + chalk.yellow('not found'));
    }

    // Check uv
    try {
      const { spawnSync } = await import('child_process');
      const result = spawnSync('uv', ['--version'], { encoding: 'utf-8' });
      if (!result.error && result.status === 0) {
        console.log(chalk.dim('  uv:         ') + result.stdout.trim().replace('uv ', ''));
      }
    } catch {
      console.log(chalk.dim('  uv:         ') + chalk.dim('not installed'));
    }

    console.log('');
  }

  async execute(): Promise<void> {
    try {
      await this.program.parseAsync(process.argv);
    } catch (error) {
      if (error instanceof Error) {
        console.error(chalk.red(`\n  Error: ${error.message}\n`));
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  }
}
