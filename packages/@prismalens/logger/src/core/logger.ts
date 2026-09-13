// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAppDataDir, getConfig } from "@prismalens/config";
import pino, { type Logger as PinoLogger } from "pino";
import { prettyFactory } from "pino-pretty";
import type { LoggerOptions, LogLevel, ServiceInfo } from "../index.js";
import { enrichContext, getRequestScope } from "./context.js";

const KEYS = [
	"authorization",
	"cookie",
	"password",
	"token",
	"secret",
	"apiKey",
	"api_key",
];
const P = ["", "*.", "*.*.", "*.*.*.", "[*].", "*.[*].", "[*].*."];
export const REDACT_PATHS = [
	...P.flatMap((p) => [
		...KEYS.map((k) => `${p}${k}`),
		`${p}["set-cookie"]`,
		`${p}set-cookie`,
	]),
];

let rootPino: PinoLogger | null = null;
let currentServiceInfo: ServiceInfo | null = null;
let defaultInstance: Logger | null = null;

export function getRootPino(): PinoLogger {
	if (rootPino) return rootPino;

	const cfg = getConfig();
	const loc = cfg.PRISMALENS_LOG_FILE_LOCATION ?? join(getAppDataDir(), "logs");
	const name = cfg.PRISMALENS_LOG_FILE_NAME;
	const isQuiet = cfg.PRISMALENS_LOG_CONSOLE === "quiet";

	mkdirSync(loc, { recursive: true });
	const logPath = join(loc, name);
	try {
		if (!existsSync(logPath)) {
			symlinkSync(`${name.replace(/\.log$/, "")}.1.log`, logPath);
		}
	} catch {}

	const fileTransport = pino.transport({
		target: fileURLToPath(import.meta.resolve("pino-roll")),
		options: {
			file: logPath,
			size: `${cfg.PRISMALENS_LOG_FILE_SIZE_MAX}m`,
			mkdir: true,
			limit: { count: cfg.PRISMALENS_LOG_FILE_COUNT_MAX },
		},
	});

	const pretty = prettyFactory({
		ignore: "pid,hostname,time",
		colorize: false,
		singleLine: true,
	});
	const consoleStream = {
		write(c: string | Buffer) {
			const s = pretty(c.toString());
			if (s) {
				if (isQuiet) process.stderr.write(s);
				else process.stdout.write(s);
			}
		},
	};

	rootPino = pino(
		{
			level: cfg.PRISMALENS_LOG_LEVEL,
			redact: { paths: REDACT_PATHS, censor: "[redacted]" },
		},
		pino.multistream([
			{ level: cfg.PRISMALENS_LOG_LEVEL, stream: fileTransport },
			{
				level: isQuiet ? "warn" : cfg.PRISMALENS_LOG_LEVEL,
				stream: consoleStream,
			},
		]),
	);
	return rootPino;
}

export class Logger {
	constructor(private readonly context?: string | LoggerOptions) {
		if (typeof context === "object" && context) this.context = context.context;
	}

	static setServiceInfo(i: ServiceInfo) {
		currentServiceInfo = i;
	}
	static getServiceInfo() {
		return currentServiceInfo;
	}
	static getInstance() {
		if (!defaultInstance) defaultInstance = new Logger();
		return defaultInstance;
	}
	static resetInstance() {
		defaultInstance = null;
		rootPino = null;
		currentServiceInfo = null;
	}

	child(ctx: string) {
		return new Logger(ctx);
	}
	getContext() {
		return typeof this.context === "string" ? this.context : undefined;
	}
	enrich(d: Record<string, unknown>) {
		enrichContext(d);
	}
	emitWideEvent() {}

	debug(m: string, x?: unknown, ...a: unknown[]) {
		this.write("debug", m, x, a);
	}
	info(m: string, x?: unknown, ...a: unknown[]) {
		this.write("info", m, x, a);
	}
	warn(m: string, x?: unknown, ...a: unknown[]) {
		this.write("warn", m, x, a);
	}
	error(m: string, x?: unknown, ...a: unknown[]) {
		this.write("error", m, x, a);
	}

	private write(
		lvl: LogLevel,
		msg: string,
		meta?: unknown,
		args: unknown[] = [],
	) {
		const p = getRootPino();
		const scope = getRequestScope();
		const log: Record<string, unknown> = {};

		if (currentServiceInfo) log.service = currentServiceInfo;
		if (scope?.bindings) Object.assign(log, scope.bindings);
		if (this.context) log.context = this.context;

		if (meta instanceof Error) {
			log.err = meta;
		} else if (meta && typeof meta === "object" && !Array.isArray(meta)) {
			Object.assign(log, meta);
		} else if (meta !== undefined) {
			log.data = [meta, ...args];
		}

		p[lvl](log, msg);
	}
}

export const getLogger = () => Logger.getInstance();
export const createChildLogger = (c: string) => Logger.getInstance().child(c);
