import chalk from "chalk";
import { spawn } from "child_process";
import { existsSync } from "fs";
import ora from "ora";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { BaseCommand, type CommandOptions } from "../base-command.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MigrateOptions extends CommandOptions {
	dev?: boolean;
	reset?: boolean;
}

/**
 * Database migrate command - runs Prisma migrations.
 */
export class MigrateCommand extends BaseCommand {
	async run(options: MigrateOptions): Promise<void> {
		this.requireConfig();

		console.log(chalk.bold("\n  PrismaLens Database Migration\n"));

		if (options.reset) {
			await this.resetDatabase();
		} else if (options.dev) {
			await this.runDevMigration();
		} else {
			await this.runDeployMigration();
		}
	}

	private async runDeployMigration(): Promise<void> {
		const spinner = ora("Running database migrations...").start();

		try {
			const { prismaPath, schemaPath } = this.resolvePrismaPaths();

			await this.execPrisma(prismaPath, [
				"migrate",
				"deploy",
				"--schema",
				schemaPath,
			]);

			spinner.succeed("Database migrations complete");
		} catch (error) {
			spinner.fail("Migration failed");
			throw error;
		}
	}

	private async runDevMigration(): Promise<void> {
		const spinner = ora("Creating development migration...").start();

		try {
			const { prismaPath, schemaPath } = this.resolvePrismaPaths();

			// In dev mode, use migrate dev which creates migrations
			await this.execPrisma(
				prismaPath,
				["migrate", "dev", "--schema", schemaPath],
				true,
			);

			spinner.succeed("Development migration complete");
		} catch (error) {
			spinner.fail("Development migration failed");
			throw error;
		}
	}

	private async resetDatabase(): Promise<void> {
		console.log(
			chalk.yellow("  Warning: This will delete all data in the database.\n"),
		);

		const spinner = ora("Resetting database...").start();

		try {
			const { prismaPath, schemaPath } = this.resolvePrismaPaths();

			await this.execPrisma(
				prismaPath,
				["migrate", "reset", "--schema", schemaPath, "--force"],
				true,
			);

			spinner.succeed("Database reset complete");
		} catch (error) {
			spinner.fail("Database reset failed");
			throw error;
		}
	}

	private resolvePrismaPaths(): { prismaPath: string; schemaPath: string } {
		// Check if running from bundled package
		if (existsSync(this.bundledPath)) {
			return {
				prismaPath: resolve(this.apiPath, "node_modules", ".bin", "prisma"),
				schemaPath: resolve(this.apiPath, "prisma", "schema.prisma"),
			};
		}

		// Development mode - use source packages
		const packagesRoot = resolve(__dirname, "..", "..", "..", "..", "..");
		const apiPath = resolve(packagesRoot, "api");

		return {
			prismaPath: resolve(apiPath, "node_modules", ".bin", "prisma"),
			schemaPath: resolve(apiPath, "prisma", "schema.prisma"),
		};
	}

	private execPrisma(
		prismaPath: string,
		args: string[],
		interactive = false,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn(prismaPath, args, {
				cwd: dirname(prismaPath),
				env: { ...process.env },
				stdio: interactive ? "inherit" : "pipe",
			});

			if (!interactive) {
				let stderr = "";
				proc.stderr?.on("data", (data) => {
					stderr += data.toString();
				});

				proc.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Prisma command failed: ${stderr}`));
					}
				});
			} else {
				proc.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Prisma command failed with code ${code}`));
					}
				});
			}

			proc.on("error", reject);
		});
	}
}
