// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * What `pl up` prints, and how it knows the app is ready. The API's own log
 * records go to the file; the terminal gets the workspace, the log path, the
 * URL once /health answers, and errors (#600).
 */

import { isIP } from "node:net";
import { join } from "node:path";
import {
	isOnPath,
	resolveOnPath,
	windowsInstallOnPath,
} from "@prismalens/config";

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

/** `port` is the workspace's (see `resolvePort` in @prismalens/config), passed in so this stays pure. */
export function resolveBind(
	env: NodeJS.ProcessEnv,
	port: number,
): {
	host: string;
	port: number;
	protocol: "http" | "https";
} {
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

/** The one terminal line for a bind that other machines can reach, or null for loopback. */
export function networkBindWarning(bind: {
	host: string;
	protocol: string;
}): string | null {
	const host = bind.host.replace(/^\[|\]$/g, "").toLowerCase();
	const loopback =
		host === "localhost" ||
		host === "::1" ||
		(isIP(host) === 4 && host.startsWith("127."));
	if (loopback) return null;
	const transport =
		bind.protocol === "https" ? "over HTTPS" : "over plain HTTP, unencrypted";
	return `Bound to ${bind.host}: PrismaLens is reachable from the network ${transport}. Keep it behind a trusted network and list the names you reach it by in PRISMALENS_ALLOWED_HOSTS.`;
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
 * The usage-data state from `/health` (#673 w45), or null when it cannot be
 * read. `notice` means this boot showed the first-run notice: `pl up` prints it.
 */
export async function readTelemetryState(
	healthUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<"notice" | "on" | "off" | null> {
	try {
		const res = await fetchImpl(healthUrl, {
			signal: AbortSignal.timeout(2_000),
		});
		if (res.status !== 200) return null;
		const { telemetry } = (await res.json()) as { telemetry?: unknown };
		return telemetry === "notice" || telemetry === "on" || telemetry === "off"
			? telemetry
			: null;
	} catch {
		return null;
	}
}

/** The first-run notice `pl up` prints on a terminal; nothing is sent before the next start. */
export const TELEMETRY_NOTICE =
	"Usage data: PrismaLens counts feature use under a random install id. Never an alert, code, a repo or a report. Turn it off in Settings, Usage data, or with PRISMALENS_TELEMETRY=off or DO_NOT_TRACK=1. Nothing is sent before the next start. https://docs.prismalens.io/trust#usage-telemetry";

export interface BrowserCommandOptions {
	isOnPath?: (bin: string, pathEnv?: string) => boolean;
	/** Where `bin` resolves on PATH, Windows mounts included; null when absent. */
	which?: (bin: string, env: NodeJS.ProcessEnv) => string | null;
}

/** WSL's default automount, for when `appendWindowsPath=false` keeps it off PATH (#673 w3). */
export const WSL_POWERSHELL =
	"/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

/** Printed when the opener could not start or failed; the printed link still works. */
export const NO_BROWSER_LINE =
	"Couldn't open a browser on this machine. Open the link above.";

function whichAnywhere(bin: string, env: NodeJS.ProcessEnv): string | null {
	const path = env.PATH ?? "";
	return (
		resolveOnPath(bin, path, { env }) ??
		windowsInstallOnPath(bin, path, { env })
	);
}

/**
 * The command that opens a URL in the host's browser, or null when there is
 * no browser to open: CI, or Linux with no display (a server, an SSH shell).
 * The link is printed either way.
 */
export function browserCommand(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	url: string,
	opts: BrowserCommandOptions = {},
): { file: string; args: string[] } | null {
	if (env.CI) return null;
	if (platform === "darwin") return { file: "open", args: [url] };
	if (platform === "win32") {
		return { file: "cmd", args: ["/c", "start", '""', url] };
	}
	const isWsl = Boolean(env.WSL_DISTRO_NAME || env.WSL_INTEROP);
	if (isWsl) {
		const check = opts.isOnPath ?? isOnPath;
		if (check("wslview", env.PATH)) {
			return { file: "wslview", args: [url] };
		}
		// Interop re-quotes argv, so cmd.exe saw literal quotes and `&` split the
		// URL; a single-quoted PowerShell literal survives both, and Start-Process
		// keeps the #token (checked with a page that reports location.hash, #673 w3).
		const literal = `'${url.replaceAll("'", "''")}'`;
		const which = opts.which ?? whichAnywhere;
		return {
			file: which("powershell.exe", env) ?? WSL_POWERSHELL,
			args: [
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				`Start-Process ${literal}`,
			],
		};
	}
	if (env.DISPLAY || env.WAYLAND_DISPLAY) {
		return { file: "xdg-open", args: [url] };
	}
	return null;
}

/** The `pl service install` pointer, for a foreground `pl up` on a platform that has a service. */
export function serviceHint(input: {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	serviceOwnsWorkspace: boolean;
}): string | null {
	if (input.platform !== "linux" && input.platform !== "darwin") return null;
	if (input.env.PRISMALENS_SERVICE === "1") return null;
	if (input.env.PRISMALENS_RUN_MODE === "electron") return null;
	if (input.serviceOwnsWorkspace) return null;
	return "For a machine that should always be on: pl service install";
}
