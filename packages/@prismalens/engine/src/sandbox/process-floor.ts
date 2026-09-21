// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The `process` floor (ADR-0020) — the lightweight, always-on Sandbox provider:
 * own-secret isolation (allowlist, not denylist — ADR-0009) + workspace-scoped cwd.
 * It is NOT an OS boundary (no FS/egress/pid isolation), so its fidelity is
 * `cooperative` and the honest-fidelity surface must say so. The `srt` provider
 * (enforced) supersedes it as the local default when present — Phase B.1.
 */
import type { ChildProcessByStdio } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { resolveOnPath } from "@prismalens/config/harness-selection";
import type {
	AppliedLimits,
	Sandbox,
	SandboxLimits,
	SandboxProcess,
	SandboxSpawnOptions,
} from "./types.js";

/** `.cmd`/`.bat` — the npm shim extensions Node's own spawn cannot exec directly on Windows. */
const CMD_SHIM_RE = /\.(cmd|bat)$/i;

// Exact port of escapeCommand and escapeArgument from cross-spawn 7.0.6 (node_modules/cross-spawn/lib/util/escape.js).
// See http://www.robvanderwoude.com/escapechars.php
const META_CHARS_RE = /([()\][%!^"`<>&|;, *?])/g;

/**
 * Escape a command for a `cmd.exe /d /s /c "<line>"` invocation.
 * Exact port from cross-spawn 7.0.6 `lib/util/escape.js`.
 */
export function escapeCommand(arg: string): string {
	return arg.replace(META_CHARS_RE, "^$1");
}

/**
 * Escape one argument token for a `cmd.exe /d /s /c "<whole line>"` invocation.
 * Exact port from cross-spawn 7.0.6 `lib/util/escape.js`.
 *
 * Algorithm is based on https://qntm.org/cmd, slightly altered in cross-spawn
 * (PR #160) to avoid catastrophic backtracking. Quotes the whole argument,
 * doubles up backslashes before double-quotes and at the end of string, and
 * escapes metacharacters with `^` (twice if doubleEscapeMetaChars is true for .cmd/.bat shims).
 */
export function escapeArgument(
	arg: string,
	doubleEscapeMetaChars = true,
): string {
	let str = `${arg}`;

	// Sequence of backslashes followed by a double quote:
	// double up all the backslashes and escape the double quote
	str = str.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');

	// Sequence of backslashes followed by the end of the string
	// (which will become a double quote later):
	// double up all the backslashes
	str = str.replace(/(?=(\\+?)?)\1$/, "$1$1");

	// All other backslashes occur literally

	// Quote the whole thing:
	str = `"${str}"`;

	// Escape meta chars
	str = str.replace(META_CHARS_RE, "^$1");

	// Double escape meta chars if necessary
	if (doubleEscapeMetaChars) {
		str = str.replace(META_CHARS_RE, "^$1");
	}

	return str;
}

/**
 * Windows cannot `execve` a `.cmd`/`.bat` shim directly (Node's own spawn throws
 * `EINVAL` — the file has no PE header, only `cmd.exe` knows how to run it), which
 * is exactly what an npm-installed harness binary is on that platform. On `win32`,
 * when `command` itself ends `.cmd`/`.bat` or the copy `resolveOnPath` would find
 * does, this re-plans the spawn as `cmd.exe /d /s /c "<quoted command + args>"`
 * (`/d` skips AutoRun registry commands, `/s` keeps the quoting below literal) with
 * `windowsVerbatimArguments: true` so Node does not re-escape what is already a
 * hand-built cmd.exe command line. `shell: true` is never used — it is the
 * injection surface CVE-2024-27980 closed, and this plan is the escaped
 * alternative. Every other platform, and every non-shim command, is unchanged.
 */
export function windowsSpawnPlan(
	command: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
): {
	command: string;
	args: string[];
	options: { windowsVerbatimArguments?: boolean };
} {
	if (platform !== "win32") return { command, args, options: {} };
	const resolved = resolveOnPath(command);
	const isShim =
		CMD_SHIM_RE.test(command) ||
		(resolved !== null && CMD_SHIM_RE.test(resolved));
	if (!isShim) return { command, args, options: {} };
	const comSpec = process.env.ComSpec ?? "cmd.exe";
	const escapedCmd = escapeCommand(command);
	const escapedArgs = args.map((arg) => escapeArgument(arg, true));
	const line = [escapedCmd, ...escapedArgs].join(" ");
	return {
		command: comSpec,
		args: ["/d", "/s", "/c", `"${line}"`],
		options: { windowsVerbatimArguments: true },
	};
}

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
 * The floor's child env: the safe allowlist from process.env, with the caller's
 * env (BYO-key) layered on top so it always wins. A `PRISMALENS_*` key in
 * `extra` is always dropped (ADR 0004 §5) — the harness never sees the app's
 * own secrets, even if a caller passes `process.env` here by mistake.
 */
export function buildFloorEnv(
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

const TREE_KILL_WRAPPED = Symbol.for("prismalens.treeKillWrapped");

/**
 * Terminate a process, tree-killing on win32 via taskkill so cmd.exe shims do
 * not orphan their underlying harness process when killed. Falls back to
 * child.kill() if taskkill fails or on non-win32 platforms.
 */
export function killProcessTree(
	child: {
		pid?: number;
		kill(signal?: NodeJS.Signals): boolean;
		killed?: boolean;
	},
	signal?: NodeJS.Signals,
	platform: NodeJS.Platform = process.platform,
	syncSpawn: typeof spawnSync = spawnSync,
): boolean {
	if (platform === "win32" && child.pid !== undefined) {
		try {
			const res = syncSpawn("taskkill", [
				"/pid",
				String(child.pid),
				"/T",
				"/F",
			]);
			if (!res.error && res.status === 0) {
				child.killed = true;
				return true;
			}
		} catch {
			// Fall through to child.kill() fallback
		}
	}
	return child.kill(signal);
}

/**
 * Wrap child.kill with tree-kill semantics on win32 while keeping the same
 * object identity and ChildProcess contract.
 */
export function wrapWithTreeKill<
	T extends {
		pid?: number;
		kill(signal?: NodeJS.Signals): boolean;
		killed?: boolean;
	},
>(child: T): T {
	if ((child as Record<symbol, unknown>)[TREE_KILL_WRAPPED]) return child;
	const rawKill = child.kill.bind(child);
	child.kill = (signal?: NodeJS.Signals): boolean =>
		killProcessTree(
			{
				pid: child.pid,
				kill: rawKill,
				get killed() {
					return child.killed ?? false;
				},
				set killed(val: boolean) {
					child.killed = val;
				},
			},
			signal,
		);
	(child as Record<symbol, unknown>)[TREE_KILL_WRAPPED] = true;
	return child;
}

/**
 * Decorate a freshly-spawned child with the {@link SandboxProcess} limit surface
 * (ADR-0020 resource-limits contract), shared by EVERY provider so wall-clock
 * enforcement + honest reporting live in one place:
 *  - arms a SIGKILL timer for `limits.wallClockMs` (the one limit every provider can
 *    enforce), cleared when the child closes on its own; when it fires it flips
 *    {@link SandboxProcess.timedOut} so the runner can distinguish a deadline kill
 *    from an early exit;
 *  - stamps {@link SandboxProcess.appliedLimits} — the wall-clock (if armed) plus any
 *    `enforced` memory/cpu the PROVIDER already arranged out-of-band (srt's
 *    systemd-run scope). The floor arranges none: it cannot cap memory/cpu without OS
 *    help and does not pretend to, so those stay absent from the report.
 * The child is augmented in place (same object identity) so `kill`/`killed` stay
 * bound to the live process.
 */
export function withLimits(
	child: PipedChild,
	limits: SandboxLimits | undefined,
	enforced: Pick<AppliedLimits, "memoryMb" | "cpuCores"> = {},
): SandboxProcess {
	wrapWithTreeKill(child);
	const applied: AppliedLimits = { ...enforced };
	const proc = child as PipedChild & {
		timedOut: boolean;
		appliedLimits: AppliedLimits;
	};
	proc.timedOut = false;
	if (limits?.wallClockMs && limits.wallClockMs > 0) {
		applied.wallClockMs = limits.wallClockMs;
		const timer = setTimeout(() => {
			proc.timedOut = true;
			proc.kill("SIGKILL");
		}, limits.wallClockMs);
		timer.unref(); // a pending deadline must not keep the event loop alive
		child.on("close", () => clearTimeout(timer));
	}
	proc.appliedLimits = applied;
	return proc;
}

/** Create a `process`-floor boundary. One per run; `destroy()` reaps stragglers. */
export function createProcessFloorSandbox(): Sandbox {
	const children = new Set<SandboxProcess>();
	return {
		id: "process-floor",
		fidelity: "cooperative",
		spawn(command, args, options: SandboxSpawnOptions): SandboxProcess {
			const plan = windowsSpawnPlan(command, args);
			const child = spawn(plan.command, plan.args, {
				cwd: options.cwd,
				env: buildFloorEnv(options.env),
				stdio: ["pipe", "pipe", "pipe"],
				...plan.options,
			});
			wrapWithTreeKill(child);
			// The floor enforces ONLY wall-clock (userspace SIGKILL); memory/cpu need
			// OS help it does not have, so they are reported as unapplied (ADR-0020).
			const proc = withLimits(child, options.limits);
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
