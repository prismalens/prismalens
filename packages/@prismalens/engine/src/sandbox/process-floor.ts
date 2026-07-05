/**
 * The `process` floor (ADR-0020) — the lightweight, always-on Sandbox provider:
 * own-secret isolation (allowlist, not denylist — ADR-0009) + workspace-scoped cwd.
 * It is NOT an OS boundary (no FS/egress/pid isolation), so its fidelity is
 * `cooperative` and the honest-fidelity surface must say so. The `srt` provider
 * (enforced) supersedes it as the local default when present — Phase B.1.
 */
import { spawn } from "node:child_process";
import type { Sandbox, SandboxProcess, SandboxSpawnOptions } from "./types.js";

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
export function buildFloorEnv(extra?: NodeJS.ProcessEnv): Record<string, string> {
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
			children.add(child);
			child.on("close", () => children.delete(child));
			return child;
		},
		async destroy(): Promise<void> {
			for (const child of children) {
				if (!child.killed) child.kill();
			}
			children.clear();
		},
	};
}
