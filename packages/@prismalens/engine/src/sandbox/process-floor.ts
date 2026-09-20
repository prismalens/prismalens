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
import { spawn } from "node:child_process";
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

/** Every character cmd.exe's own parser treats specially, per the cross-spawn escaping rule. */
const CMD_META_CHARS_RE = /[()%!^"<>&|]/g;

/**
 * Escape one argv token for a `cmd.exe /d /s /c "<whole line>"` invocation (the
 * cross-spawn rule: github.com/moxystudio/node-cross-spawn `lib/util/escape.js`).
 * Whitespace or an embedded `"` forces quoting; every cmd metacharacter — inside
 * or outside the quotes — is prefixed with `^` so cmd's own re-parse of the outer
 * quoted line (`/c "..."` strips one layer, then re-tokenizes) does not split the
 * token or run a shell operator the caller never asked for.
 */
export function quoteForCmd(token: string): string {
	let escaped = token.replace(/"/g, '\\"');
	if (/[\s"]/.test(token)) escaped = `"${escaped}"`;
	return escaped.replace(CMD_META_CHARS_RE, (ch) => `^${ch}`);
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
	const line = [command, ...args].map(quoteForCmd).join(" ");
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
