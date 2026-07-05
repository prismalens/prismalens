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
import type {
	AppliedLimits,
	Sandbox,
	SandboxLimits,
	SandboxProcess,
	SandboxSpawnOptions,
} from "./types.js";

/** A child spawned with a fully-piped stdio tuple — non-null duplex streams. */
type PipedChild = ChildProcessByStdio<Writable, Readable, Readable>;

/**
 * Own-secret isolation (ADR-0009): only pass the child a bare-minimum shell
 * environment, never prismalens's own process.env verbatim (which would leak
 * ENCRYPTION_KEY, PRISMALENS_INTERNAL_SECRET, OLLAMA_API_KEY, etc. into the rented
 * harness).
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
] as const;

/**
 * The floor's child env: the safe allowlist from process.env, with the caller's
 * env (BYO-key) layered on top so it always wins.
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
		if (value !== undefined) env[key] = value;
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
			const child = spawn(command, args, {
				cwd: options.cwd,
				env: buildFloorEnv(options.env),
				stdio: ["pipe", "pipe", "pipe"],
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
