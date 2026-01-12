import type { LogLevel } from "../types/wide-event.js";
import type { Transport, TransportOptions } from "./transport.js";

export interface ConsoleTransportOptions extends TransportOptions {
	/** Log format */
	format?: "text" | "json";
}

/**
 * Console transport - outputs to stdout/stderr.
 */
export class ConsoleTransport implements Transport {
	private readonly format: "text" | "json";

	constructor(options: ConsoleTransportOptions = {}) {
		this.format = options.format ?? "json";
	}

	write(data: string, level: LogLevel): void {
		// Use stderr for errors, stdout for everything else
		if (level === "error") {
			process.stderr.write(data + "\n");
		} else {
			process.stdout.write(data + "\n");
		}
	}

	close(): void {
		// Console transport doesn't need cleanup
	}
}
