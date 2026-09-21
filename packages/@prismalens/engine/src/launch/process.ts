// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Launches the harness child: allowlisted env (ADR 0004 §5), cwd on the snapshot (§2), a wall-clock SIGKILL. No OS boundary (§3).
 */
import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type {
	HarnessChild,
	HarnessLauncher,
	LaunchOptions,
	RunLimits,
} from "./types.js";

/** A child spawned with a fully-piped stdio tuple — non-null duplex streams. */
type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Own-secret isolation (ADR-0009): only pass the child a bare-minimum shell
 * environment, never prismalens's own process.env verbatim (which would leak
 * ENCRYPTION_KEY, OLLAMA_API_KEY, etc. into the rented harness).
 */
export const SAFE_ENV_ALLOWLIST = [
	"PATH",
	"HOME",
	"USER",
	"LOGNAME",
	"SHELL",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TERM",
	"TMPDIR",
	"TZ",
	"PWD",
	// Behind a corporate proxy or private CA the agent cannot reach its provider
	// without these (#633, review N4). Both cases are read by curl, Node and Python.
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"NODE_EXTRA_CA_CERTS",
	"REQUESTS_CA_BUNDLE",
	// A relocated data home is where OpenCode keeps a `/connect` login (review N5).
	"XDG_DATA_HOME",
	// A laptop placement runs Claude Code on the user's own sign-in (ADR 0003 §9,
	// #650), so a config dir they relocated themselves has to survive the floor.
	// A server placement is unaffected: its registry row sets this explicitly and
	// the row's env is layered over the floor.
	"CLAUDE_CONFIG_DIR",
] as const;

/**
 * The child env: the safe allowlist from process.env, with the caller's env
 * layered on top so it always wins. A `PRISMALENS_*` key in `extra` is always
 * dropped (ADR 0004 §5).
 */
export function buildChildEnv(
	extra?: NodeJS.ProcessEnv,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of SAFE_ENV_ALLOWLIST) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	for (const [key, value] of Object.entries(extra ?? {})) {
		if (value !== undefined && !key.startsWith("PRISMALENS_")) {
			env[key] = value;
		}
	}
	return env;
}

/**
 * Arms a SIGKILL timer for `limits.wallClockMs`, cleared when the child closes on
 * its own; when it fires it flips `timedOut` so the runner reports a deadline kill,
 * not an early exit.
 */
export function withWallClock(
	child: PipedChild,
	limits: RunLimits | undefined,
): HarnessChild {
	const proc = child as PipedChild & {
		timedOut: boolean;
	};
	proc.timedOut = false;
	if (limits?.wallClockMs && limits.wallClockMs > 0) {
		const timer = setTimeout(() => {
			proc.timedOut = true;
			proc.kill("SIGKILL");
		}, limits.wallClockMs);
		timer.unref(); // a pending deadline must not keep the event loop alive
		child.on("close", () => clearTimeout(timer));
	}
	return proc;
}

/** Spawns the harness as a child of the API. One per run; `destroy()` reaps stragglers. */
export function createProcessLauncher(): HarnessLauncher {
	const children = new Set<HarnessChild>();
	return {
		spawn(command, args, options: LaunchOptions): HarnessChild {
			const child = spawn(command, args, {
				cwd: options.cwd,
				env: buildChildEnv(options.env),
				stdio: ["pipe", "pipe", "pipe"],
			});
			const proc = withWallClock(child, options.limits);
			children.add(proc);
			proc.on("close", () => children.delete(proc));
			return proc;
		},
		async destroy(): Promise<void> {
			for (const child of children) {
				if (!child.killed) child.kill();
			}
			children.clear();
		},
	};
}
