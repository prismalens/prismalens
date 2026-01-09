import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import ora from "ora";
import { join } from "path";

const require = createRequire(import.meta.url);

const MARKER_FILE = ".wheel-installed";
const MIN_PYTHON_VERSION = "3.11";

/**
 * Manages Python dependency installation for the bundled worker.
 * Installs dependencies on first run and caches installation marker.
 */
export class WheelInstaller {
	/**
	 * Ensure Python dependencies are installed in the worker directory.
	 */
	static async ensureInstalled(workerPath: string): Promise<void> {
		const markerPath = join(workerPath, MARKER_FILE);
		const packageVersion = WheelInstaller.getPackageVersion();

		// Check if already installed for this version
		if (existsSync(markerPath)) {
			const installedVersion = readFileSync(markerPath, "utf-8").trim();
			if (installedVersion === packageVersion) {
				return; // Already installed
			}
		}

		// Validate Python version
		WheelInstaller.validatePython();

		const spinner = ora("Installing Python worker dependencies...").start();

		try {
			const hasUv = WheelInstaller.commandExists("uv");

			if (hasUv) {
				await WheelInstaller.installWithUv(workerPath);
			} else {
				await WheelInstaller.installWithPip(workerPath);
			}

			// Write marker file
			writeFileSync(markerPath, packageVersion);

			spinner.succeed("Python worker dependencies installed");
		} catch (error) {
			spinner.fail("Failed to install Python worker dependencies");
			throw error;
		}
	}

	private static getPackageVersion(): string {
		try {
			const pkg = require("../../package.json");
			return pkg.version;
		} catch {
			return "0.0.0";
		}
	}

	private static validatePython(): void {
		try {
			const result = spawnSync("python3", ["--version"], { encoding: "utf-8" });
			if (result.error) {
				throw new Error("Python 3 is not installed");
			}

			const output = result.stdout || result.stderr;
			const match = output.match(/Python (\d+\.\d+)/);
			if (!match) {
				throw new Error("Could not determine Python version");
			}

			const version = match[1];
			const [major, minor] = version.split(".").map(Number);
			const [reqMajor, reqMinor] = MIN_PYTHON_VERSION.split(".").map(Number);

			if (major < reqMajor || (major === reqMajor && minor < reqMinor)) {
				throw new Error(
					`Python ${MIN_PYTHON_VERSION}+ is required. Found: ${version}`,
				);
			}
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error("Failed to check Python version");
		}
	}

	private static commandExists(cmd: string): boolean {
		try {
			const result = spawnSync("which", [cmd], { encoding: "utf-8" });
			return result.status === 0;
		} catch {
			return false;
		}
	}

	private static async installWithUv(workerPath: string): Promise<void> {
		try {
			// uv sync will create venv and install dependencies
			execSync("uv sync", {
				cwd: workerPath,
				stdio: "pipe",
				env: {
					...process.env,
					// Disable any interactive prompts
					UV_NO_PROMPT: "1",
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`uv sync failed: ${message}`);
		}
	}

	private static async installWithPip(workerPath: string): Promise<void> {
		const venvPath = join(workerPath, ".venv");

		try {
			// Create virtual environment if it doesn't exist
			if (!existsSync(venvPath)) {
				execSync(`python3 -m venv ${venvPath}`, {
					cwd: workerPath,
					stdio: "pipe",
				});
			}

			// Determine pip path based on OS
			const isWindows = process.platform === "win32";
			const pipPath = isWindows
				? join(venvPath, "Scripts", "pip")
				: join(venvPath, "bin", "pip");

			// Upgrade pip first
			execSync(`${pipPath} install --upgrade pip`, {
				cwd: workerPath,
				stdio: "pipe",
			});

			// Install in editable mode
			execSync(`${pipPath} install -e .`, {
				cwd: workerPath,
				stdio: "pipe",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`pip install failed: ${message}`);
		}
	}
}
