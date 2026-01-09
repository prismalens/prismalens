/**
 * @prismalens/cli
 *
 * Main entry point for the PrismaLens CLI package.
 * This module exports the CommandRegistry and all commands for programmatic use.
 */

export { CommandRegistry } from "./command-registry.js";
export { BaseCommand } from "./commands/base-command.js";
export { MigrateCommand, PushCommand } from "./commands/db/index.js";
export { DevCommand } from "./commands/dev.js";
export { StartCommand } from "./commands/start.js";
export { WorkerCommand } from "./commands/worker.js";
export { Logger } from "./services/logger.js";
export { ShutdownService } from "./services/shutdown.js";
export { WheelInstaller } from "./worker/wheel-installer.js";
