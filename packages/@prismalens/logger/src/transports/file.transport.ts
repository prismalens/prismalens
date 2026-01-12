import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { WriteStream } from "node:fs";
import { getConfig, getAppDataDir } from "@prismalens/config";
import type { LogLevel } from "../types/wide-event.js";
import type { Transport, TransportOptions } from "./transport.js";

export interface FileTransportOptions extends TransportOptions {
	/** Directory path for log files */
	location?: string;
	/** Maximum number of log files to retain */
	maxFileCount?: number;
	/** Maximum file size in MB */
	maxFileSizeMb?: number;
	/** Base filename for logs */
	fileName?: string;
}

/**
 * File transport with rotation support.
 * Rotates based on file size and maintains max file count.
 */
export class FileTransport implements Transport {
	private readonly logDir: string;
	private readonly maxFileCount: number;
	private readonly maxFileSizeBytes: number;
	private readonly fileName: string;
	private stream: WriteStream | null = null;
	private currentFileSize = 0;

	constructor(options: FileTransportOptions = {}) {
		const config = getConfig();

		this.maxFileCount = options.maxFileCount ?? config.PRISMALENS_LOG_FILE_COUNT_MAX;
		this.maxFileSizeBytes =
			(options.maxFileSizeMb ?? config.PRISMALENS_LOG_FILE_SIZE_MAX) * 1024 * 1024;
		this.fileName = options.fileName ?? config.PRISMALENS_LOG_FILE_NAME;

		// Determine log directory
		this.logDir =
			options.location ??
			config.PRISMALENS_LOG_FILE_LOCATION ??
			join(getAppDataDir(), "logs");

		// Ensure directory exists
		this.ensureLogDirectory();

		// Open initial stream
		this.openStream();
	}

	write(data: string, _level: LogLevel): void {
		if (!this.stream) {
			this.openStream();
		}

		const line = data.endsWith("\n") ? data : `${data}\n`;
		const bytes = Buffer.byteLength(line, "utf8");

		// Check if rotation needed
		if (this.currentFileSize + bytes > this.maxFileSizeBytes) {
			this.rotate();
		}

		this.stream!.write(line);
		this.currentFileSize += bytes;
	}

	close(): void {
		if (this.stream) {
			this.stream.end();
			this.stream = null;
		}
	}

	/**
	 * Ensure the log directory exists.
	 */
	private ensureLogDirectory(): void {
		if (!existsSync(this.logDir)) {
			mkdirSync(this.logDir, { recursive: true, mode: 0o755 });
		}
	}

	/**
	 * Open a write stream to the current log file.
	 */
	private openStream(): void {
		const filePath = this.getCurrentLogPath();
		this.stream = createWriteStream(filePath, { flags: "a" });

		// Get current file size
		if (existsSync(filePath)) {
			this.currentFileSize = statSync(filePath).size;
		} else {
			this.currentFileSize = 0;
		}

		// Handle stream errors
		this.stream.on("error", (err) => {
			console.error(`[FileTransport] Error writing to log file: ${err.message}`);
		});
	}

	/**
	 * Rotate the current log file.
	 */
	private rotate(): void {
		this.close();

		// Generate timestamp for rotated file name
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const baseName = this.fileName.replace(/\.log$/, "");
		const rotatedName = `${baseName}-${timestamp}.log`;
		const currentPath = this.getCurrentLogPath();
		const rotatedPath = join(this.logDir, rotatedName);

		// Rename current file
		if (existsSync(currentPath)) {
			try {
				renameSync(currentPath, rotatedPath);
			} catch (err) {
				console.error(`[FileTransport] Error rotating log file: ${err}`);
			}
		}

		// Cleanup old files
		this.cleanupOldFiles();

		// Open new stream
		this.openStream();
	}

	/**
	 * Remove old log files beyond the max count.
	 */
	private cleanupOldFiles(): void {
		try {
			const files = readdirSync(this.logDir)
				.filter((f) => f.endsWith(".log"))
				.map((f) => ({
					name: f,
					path: join(this.logDir, f),
					mtime: statSync(join(this.logDir, f)).mtime.getTime(),
				}))
				.sort((a, b) => b.mtime - a.mtime); // Newest first

			// Remove files beyond max count
			const filesToRemove = files.slice(this.maxFileCount);
			for (const file of filesToRemove) {
				try {
					unlinkSync(file.path);
				} catch {
					// Ignore cleanup errors
				}
			}
		} catch {
			// Ignore errors during cleanup
		}
	}

	/**
	 * Get the path to the current log file.
	 */
	private getCurrentLogPath(): string {
		return join(this.logDir, this.fileName);
	}

	/**
	 * Get the log directory path.
	 */
	getLogDirectory(): string {
		return this.logDir;
	}
}
