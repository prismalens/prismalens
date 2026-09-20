// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What `pl up` prints, and how it knows the app is ready. The API's own log
 * records go to the file; the terminal gets the workspace, the log path, the
 * URL once /health answers, and errors (#600).
 */

import { join } from "node:path";

const DEFAULT_LOG_DIR = "logs";

export type ConsoleMode = "quiet" | "verbose";

/** The env contract the logger package reads; see #610 (same names, same defaults). */
export function resolveConsoleMode(
	env: NodeJS.ProcessEnv,
	verboseFlag: boolean,
): ConsoleMode {
	if (verboseFlag) return "verbose";
	return env.PRISMALENS_LOG_CONSOLE === "verbose" ? "verbose" : "quiet";
}

/** The directory, not a file: the logger rotates `<base>.<N>.log` and keeps no symlink (#610). */
export function resolveLogDir(
	env: NodeJS.ProcessEnv,
	workspaceDir: string,
): string {
	return (
		env.PRISMALENS_LOG_FILE_LOCATION || join(workspaceDir, DEFAULT_LOG_DIR)
	);
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

const isWildcard = (host: string) => host === "0.0.0.0" || host === "::";
const urlHost = (host: string) => (host.includes(":") ? `[${host}]` : host);

/** A wildcard bind is not a URL anyone can open; loopback reads better as localhost. */
export function displayUrl(bind: {
	host: string;
	port: number;
	protocol: string;
}): string {
	const shown =
		isWildcard(bind.host) || bind.host === "127.0.0.1"
			? "localhost"
			: urlHost(bind.host);
	return `${bind.protocol}://${shown}:${bind.port}`;
}

/** Where the readiness probe connects: a wildcard bind is reached over loopback. */
export function healthUrl(bind: {
	host: string;
	port: number;
	protocol: string;
}): string {
	const host = isWildcard(bind.host) ? "127.0.0.1" : urlHost(bind.host);
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

/**
 * The usage-data consent state from `/health` (#602), or null when it cannot
 * be read. `pl up` never prompts: it prints one line pointing at Settings while
 * the question is unanswered, and nothing once it has been.
 */
export async function readTelemetryState(
	healthUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<"undecided" | "on" | "off" | null> {
	try {
		const res = await fetchImpl(healthUrl, {
			signal: AbortSignal.timeout(2_000),
		});
		if (res.status !== 200) return null;
		const { telemetry } = (await res.json()) as { telemetry?: unknown };
		return telemetry === "undecided" ||
			telemetry === "on" ||
			telemetry === "off"
			? telemetry
			: null;
	} catch {
		return null;
	}
}

/** The one line `pl up` prints while consent is undecided. */
export const TELEMETRY_CONSENT_NOTICE =
	"Usage data is off. PrismaLens can count anonymous product events to see what gets used — Settings → Usage data decides, and nothing is sent until it does.";
