// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What `pl up` prints, and how it knows the app is ready. The API's own log
 * records go to the file; the terminal gets the workspace, the log path, the
 * URL once /health answers, and errors (#600).
 */

import { join } from "node:path";

const DEFAULT_LOG_DIR = "logs";
const DEFAULT_LOG_FILE = "prismalens.log";

export type ConsoleMode = "quiet" | "verbose";

/** The env contract the logger package reads; see #610 (same names, same defaults). */
export function resolveConsoleMode(
	env: NodeJS.ProcessEnv,
	verboseFlag: boolean,
): ConsoleMode {
	if (verboseFlag) return "verbose";
	return env.PRISMALENS_LOG_CONSOLE === "verbose" ? "verbose" : "quiet";
}

export function resolveLogFile(
	env: NodeJS.ProcessEnv,
	workspaceDir: string,
): string {
	const dir =
		env.PRISMALENS_LOG_FILE_LOCATION || join(workspaceDir, DEFAULT_LOG_DIR);
	return join(dir, env.PRISMALENS_LOG_FILE_NAME || DEFAULT_LOG_FILE);
}

export function resolveBind(env: NodeJS.ProcessEnv): {
	host: string;
	port: number;
	protocol: "http" | "https";
} {
	const port = Number(env.PRISMALENS_PORT) || 3001;
	const host = env.PRISMALENS_HOST || "127.0.0.1";
	const protocol = env.PRISMALENS_PROTOCOL === "https" ? "https" : "http";
	return { host, port, protocol };
}

/** A wildcard bind is not a URL anyone can open; loopback reads better as localhost. */
export function displayUrl(bind: {
	host: string;
	port: number;
	protocol: string;
}): string {
	const shown =
		bind.host === "0.0.0.0" || bind.host === "::" || bind.host === "127.0.0.1"
			? "localhost"
			: bind.host;
	return `${bind.protocol}://${shown}:${bind.port}`;
}

/** Where the readiness probe connects: a wildcard bind is reached over loopback, an IPv6 literal needs brackets. */
export function healthUrl(bind: {
	host: string;
	port: number;
	protocol: string;
}): string {
	const host =
		bind.host === "0.0.0.0" || bind.host === "::"
			? "127.0.0.1"
			: bind.host.includes(":")
				? `[${bind.host}]`
				: bind.host;
	return `${bind.protocol}://${host}:${bind.port}/health`;
}

export interface WaitForReadyOptions {
	timeoutMs?: number;
	intervalMs?: number;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Poll /health until it answers 200. Resolves true on ready, false on timeout.
 * Never throws: a refused connection during boot is the normal case.
 */
export async function waitForReady(
	healthUrl: string,
	opts: WaitForReadyOptions = {},
): Promise<boolean> {
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const intervalMs = opts.intervalMs ?? 250;
	const fetchImpl = opts.fetchImpl ?? fetch;
	const sleep =
		opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetchImpl(healthUrl, {
				signal: AbortSignal.timeout(intervalMs * 4),
			});
			if (res.status === 200) return true;
		} catch {
			// not listening yet
		}
		await sleep(intervalMs);
	}
	return false;
}
