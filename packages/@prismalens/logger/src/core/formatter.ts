import type { LogEntry } from "../types/log-entry.js";
import type { LogLevel, WideEvent } from "../types/wide-event.js";

/**
 * ANSI color codes for terminal output.
 */
const COLORS = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	gray: "\x1b[90m",
} as const;

/**
 * Color mapping for log levels.
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
	debug: COLORS.blue,
	info: COLORS.green,
	warn: COLORS.yellow,
	error: COLORS.red,
};

/**
 * Format a log entry as JSON.
 */
export function formatJson(entry: LogEntry): string {
	const obj: Record<string, unknown> = {
		level: entry.level,
		time: entry.timestamp,
		msg: entry.message,
	};

	if (entry.context) {
		obj.context = entry.context;
	}

	if (entry.args && entry.args.length > 0) {
		obj.data = entry.args.length === 1 ? entry.args[0] : entry.args;
	}

	if (entry.error) {
		obj.err = {
			type: entry.error.name,
			message: entry.error.message,
			stack: entry.error.stack,
		};
	}

	return JSON.stringify(obj);
}

/**
 * Format a log entry as human-readable text with colors.
 */
export function formatText(entry: LogEntry): string {
	const timestamp = COLORS.gray + entry.timestamp + COLORS.reset;
	const level = formatLevel(entry.level);
	const context = entry.context
		? COLORS.dim + `[${entry.context}]` + COLORS.reset + " "
		: "";
	const message = entry.message;

	let output = `${timestamp} ${level} ${context}${message}`;

	// Append args if present
	if (entry.args && entry.args.length > 0) {
		const argsStr = entry.args
			.map((arg) =>
				typeof arg === "object" ? JSON.stringify(arg) : String(arg),
			)
			.join(" ");
		output += ` ${COLORS.dim}${argsStr}${COLORS.reset}`;
	}

	// Append error if present
	if (entry.error) {
		output += `\n${COLORS.red}${entry.error.stack || entry.error.message}${COLORS.reset}`;
	}

	return output;
}

/**
 * Format a wide event as JSON.
 */
export function formatWideEventJson(event: Partial<WideEvent>): string {
	return JSON.stringify({
		...event,
		_type: "wide_event",
	});
}

/**
 * Format a wide event as human-readable text (summary).
 */
export function formatWideEventText(event: Partial<WideEvent>): string {
	const parts: string[] = [];

	// Timestamp and type indicator
	parts.push(
		`${COLORS.gray}${event.timestamp}${COLORS.reset} ${COLORS.blue}[WIDE_EVENT]${COLORS.reset}`,
	);

	// Request ID
	parts.push(`${COLORS.dim}req=${event.request_id}${COLORS.reset}`);

	// Duration
	if (event.duration_ms !== undefined) {
		const color = event.duration_ms > 1000 ? COLORS.yellow : COLORS.green;
		parts.push(`${color}${event.duration_ms}ms${COLORS.reset}`);
	}

	// Request info
	if (event.request) {
		const method = event.request.method || "?";
		const path = event.request.path || "?";
		parts.push(`${method} ${path}`);
	}

	// Status code
	if (event.response?.status_code) {
		const code = event.response.status_code;
		const color =
			code >= 500 ? COLORS.red : code >= 400 ? COLORS.yellow : COLORS.green;
		parts.push(`${color}${code}${COLORS.reset}`);
	}

	// Error indicator
	if (event.error) {
		parts.push(`${COLORS.red}ERR: ${event.error.type}${COLORS.reset}`);
	}

	// Sampling decision
	if (event.sampling) {
		const indicator =
			event.sampling.decision === "retained"
				? `${COLORS.green}[retained:${event.sampling.reason}]${COLORS.reset}`
				: `${COLORS.dim}[dropped]${COLORS.reset}`;
		parts.push(indicator);
	}

	return parts.join(" ");
}

/**
 * Format the log level with color and padding.
 */
function formatLevel(level: LogLevel): string {
	const color = LEVEL_COLORS[level];
	const padded = level.toUpperCase().padEnd(5);
	return `${color}${padded}${COLORS.reset}`;
}
