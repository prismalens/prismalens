import chalk from "chalk";
import { spawn } from "child_process";
import { existsSync } from "fs";
import ora from "ora";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { BaseCommand, type CommandOptions } from "../base-command.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PushOptions extends CommandOptions {
	force?: boolean;
}

/**
 * Database push command - pushes Prisma schema changes directly.
 * Use this for rapid prototyping (not recommended for production).
 */
export class PushCommand extends BaseCommand {
	async run(options: PushOptions): Promise<void> {
		this.requireConfig();

		console.log(chalk.bold("\n  PrismaLens Database Push\n"));

		if (!options.force) {
			console.log(
				chalk.yellow(
					"  Warning: db push is intended for prototyping.\n" +
						'  For production, use "prismalens db migrate" instead.\n',
				),
			);
		}

		const spinner = ora("Pushing schema changes...").start();

		try {
			const { prismaPath, schemaPath } = this.resolvePrismaPaths();

			const args = ["db", "push", "--schema", schemaPath];
			if (options.force) {
				args.push("--accept-data-loss");
			}

			await this.execPrisma(prismaPath, args);

			spinner.succeed("Schema pushed successfully");
		} catch (error) {
			spinner.fail("Push failed");
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

	private execPrisma(prismaPath: string, args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn(prismaPath, args, {
				cwd: dirname(prismaPath),
				env: { ...process.env },
				stdio: "inherit",
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Prisma command failed with code ${code}`));
				}
			});

			proc.on("error", reject);
		});
	}
}
