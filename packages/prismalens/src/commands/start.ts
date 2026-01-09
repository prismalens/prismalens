import chalk from "chalk";
import { type ChildProcess, spawn } from "child_process";
import ora from "ora";
import { resolve } from "path";
import { WheelInstaller } from "../worker/wheel-installer.js";
import { BaseCommand, type CommandOptions } from "./base-command.js";

export interface StartOptions extends CommandOptions {
	port: string;
	host: string;
	mainOnly?: boolean;
	skipMigrations?: boolean;
}

/**
 * Start command - launches the complete PrismaLens application.
 * Runs the API server (which serves frontend) and Python worker.
 */
export class StartCommand extends BaseCommand {
	private apiProcess?: ChildProcess;
	private workerProcess?: ChildProcess;

	async run(options: StartOptions): Promise<void> {
		const config = this.requireConfig();

		console.log(
			chalk.bold("\n  PrismaLens"),
			chalk.dim(`v${process.env.npm_package_version || "0.1.0"}\n`),
		);

		// Validate bundled assets exist
		this.validateBundledAssets();

		// Run migrations unless skipped
		if (!options.skipMigrations) {
			await this.runMigrations();
		}

		// Start API server (serves frontend via static files)
		await this.startApi(options.host, parseInt(options.port, 10));

		// Start worker unless --main-only flag is set
		if (!options.mainOnly) {
			await this.startWorker();
		}

		const url = `http://${options.host}:${options.port}`;
		console.log(
			chalk.green("\n  Ready!"),
			chalk.dim("PrismaLens is running at"),
			chalk.cyan(url),
			"\n",
		);
		console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

		// Keep process alive
		await new Promise(() => {});
	}

	private async runMigrations(): Promise<void> {
		const spinner = ora("Running database migrations...").start();

		try {
			const prismaPath = resolve(
				this.apiPath,
				"node_modules",
				".bin",
				"prisma",
			);
			const schemaPath = resolve(this.apiPath, "prisma", "schema.prisma");

			await new Promise<void>((resolve, reject) => {
				const proc = spawn(
					prismaPath,
					["migrate", "deploy", "--schema", schemaPath],
					{
						cwd: this.apiPath,
						env: { ...process.env },
						stdio: "pipe",
					},
				);

				let stderr = "";
				proc.stderr?.on("data", (data) => {
					stderr += data.toString();
				});

				proc.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Migration failed: ${stderr}`));
					}
				});

				proc.on("error", reject);
			});

			spinner.succeed("Database migrations complete");
		} catch (error) {
			spinner.fail("Database migration failed");
			throw error;
		}
	}

	private async startApi(host: string, port: number): Promise<void> {
		const spinner = ora("Starting API server...").start();

		const apiMain = resolve(this.apiPath, "dist", "main.js");
		const frontendOut = resolve(this.frontendPath, "out");

		this.apiProcess = spawn("node", [apiMain], {
			cwd: this.apiPath,
			env: {
				...process.env,
				PORT: String(port),
				HOST: host,
				NODE_ENV: "production",
				FRONTEND_PATH: frontendOut,
			},
			stdio: ["inherit", "pipe", "pipe"],
		});

		// Wait for API to be ready
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("API server failed to start within 30 seconds"));
			}, 30000);

			this.apiProcess?.stdout?.on("data", (data) => {
				const output = data.toString();
				if (
					output.includes("Nest application successfully started") ||
					output.includes("Listening")
				) {
					clearTimeout(timeout);
					resolve();
				}
				// In production, suppress API logs unless debug mode
				if (process.env.DEBUG) {
					process.stdout.write(data);
				}
			});

			this.apiProcess?.stderr?.on("data", (data) => {
				process.stderr.write(data);
			});

			this.apiProcess?.on("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});

			this.apiProcess?.on("close", (code) => {
				if (code !== 0 && code !== null) {
					clearTimeout(timeout);
					reject(new Error(`API process exited with code ${code}`));
				}
			});
		});

		spinner.succeed("API server started");
	}

	private async startWorker(): Promise<void> {
		const spinner = ora("Starting Python worker...").start();

		try {
			// Ensure Python dependencies are installed
			await WheelInstaller.ensureInstalled(this.workerPath);

			this.workerProcess = spawn("python3", ["-m", "prismalens_worker"], {
				cwd: this.workerPath,
				env: { ...process.env },
				stdio: ["inherit", "pipe", "pipe"],
			});

			// Wait a moment to check if worker started successfully
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					// If no error after 5 seconds, consider it started
					resolve();
				}, 5000);

				this.workerProcess?.stdout?.on("data", (data) => {
					if (process.env.DEBUG) {
						process.stdout.write(chalk.dim("[worker] ") + data.toString());
					}
				});

				this.workerProcess?.stderr?.on("data", (data) => {
					const output = data.toString();
					// Python often logs to stderr
					if (process.env.DEBUG) {
						process.stderr.write(chalk.dim("[worker] ") + output);
					}
				});

				this.workerProcess?.on("error", (error) => {
					clearTimeout(timeout);
					reject(error);
				});

				this.workerProcess?.on("close", (code) => {
					if (code !== 0 && code !== null) {
						clearTimeout(timeout);
						reject(new Error(`Worker process exited with code ${code}`));
					}
				});
			});

			spinner.succeed("Python worker started");
		} catch (error) {
			spinner.fail("Failed to start Python worker");
			throw error;
		}
	}

	protected async shutdown(): Promise<void> {
		this.logger.info("Stopping PrismaLens...");

		// Stop worker first
		if (this.workerProcess) {
			this.logger.debug("Stopping worker process...");
			this.workerProcess.kill("SIGTERM");
			await this.waitForProcessExit(this.workerProcess, "worker");
		}

		// Stop API
		if (this.apiProcess) {
			this.logger.debug("Stopping API process...");
			this.apiProcess.kill("SIGTERM");
			await this.waitForProcessExit(this.apiProcess, "api");
		}

		await super.shutdown();
	}

	private waitForProcessExit(proc: ChildProcess, name: string): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this.logger.warn(`${name} did not exit gracefully, forcing...`);
				proc.kill("SIGKILL");
				resolve();
			}, 10000);

			proc.on("close", () => {
				clearTimeout(timeout);
				this.logger.debug(`${name} process stopped`);
				resolve();
			});
		});
	}
}
