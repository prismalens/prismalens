/**
 * The `Sandbox` port (ADR-0020) — placement-scaled harness isolation. The engine is
 * trusted orchestration; the Tier-2 harness is the risky unit, so runners launch the
 * harness THROUGH a Sandbox provider, never via child_process directly. One
 * interface, N providers, placement-set defaults: the always-on `process` floor
 * today; `srt` (local/desktop, enforced) and E2B (server/cloud, enforced) are the
 * Phase B.1 build. Shape adopted from TanStack's SandboxHandle — the design, not the
 * package (hub note: tanstack-ai-sandbox-layer).
 */
import type { Readable, Writable } from "node:stream";

/**
 * Best-effort resource limits (ADR-0020: "resource limits are part of the contract —
 * CPU/mem/disk quota + wall-clock timeout"). Each field is a REQUEST honoured
 * per-provider on a best-effort basis — a provider that cannot enforce a limit does
 * NOT fake it; it omits that limit from {@link SandboxProcess.appliedLimits} so the
 * caller can be honest about what actually took effect:
 *  - `wallClockMs` — enforced by EVERY provider (the process floor included): a
 *    userspace SIGKILL timer, so it is the one limit that always applies.
 *  - `memoryMb` / `cpuCores` — need OS help (cgroups). The `process` floor cannot
 *    enforce them at all; `srt` enforces them only when `systemd-run` is available to
 *    wrap the child in a scope (srt's own settings expose no such knob).
 */
export interface SandboxLimits {
	/** Wall-clock deadline (ms). Past it the child is SIGKILLed. Always enforced. */
	wallClockMs?: number;
	/** Memory ceiling (MB). Best-effort — only where the provider has an OS lever. */
	memoryMb?: number;
	/** CPU quota (whole/fractional cores). Best-effort — provider/OS permitting. */
	cpuCores?: number;
}

/**
 * The subset of the requested {@link SandboxLimits} a provider ACTUALLY applied
 * (ADR-0020 honest-fidelity — the sibling of ADR-0017). A field is present ONLY when
 * the boundary really enforces it: a `memoryMb` the floor cannot cap is absent here
 * even though it was asked for, so a caller reading this reports the truth, not the
 * wish.
 */
export type AppliedLimits = SandboxLimits;

/** How to launch a harness inside the sandbox boundary. */
export interface SandboxSpawnOptions {
	/** Working directory — the harness workspace, read-write inside the boundary. */
	cwd: string;
	/**
	 * Env the harness needs (BYO-key: OPENAI_API_KEY, OPENAI_BASE_URL, …). The
	 * provider merges it OVER its own safe base env; a provider must never hand the
	 * child prismalens's process.env verbatim (ADR-0009 own-secret isolation).
	 */
	env?: NodeJS.ProcessEnv;
	/**
	 * Best-effort resource caps for this run (ADR-0020). Applied per-provider; what
	 * actually took effect is reported back on {@link SandboxProcess.appliedLimits}.
	 */
	limits?: SandboxLimits;
}

/**
 * The minimal duplex-stdio surface a runner drives — ACP is line-delimited JSON-RPC
 * over these pipes (the srt spike verified this shape survives OS isolation).
 * Structurally satisfied by node's ChildProcess spawned with fully-piped stdio;
 * providers with non-process transports adapt to it.
 */
export interface SandboxProcess {
	stdin: Writable;
	stdout: Readable;
	stderr: Readable;
	killed: boolean;
	/**
	 * True once this child was SIGKILLed for exceeding its wall-clock deadline
	 * (`SandboxLimits.wallClockMs`). The runner reads it on `close` to report a
	 * timeout DISTINGUISHABLY from an ordinary early exit (ADR-0020 resource-limits
	 * contract). Providers that enforce limits populate it (`false` until it fires);
	 * optional so a provider that does not yet honour limits need not set it (a
	 * missing/`false` value simply reads as "no timeout").
	 */
	timedOut?: boolean;
	/**
	 * Which of the requested {@link SandboxLimits} this provider ACTUALLY enforced
	 * (ADR-0020 honest-fidelity). A field is present ONLY when really enforced, so a
	 * caller reports the truth, not the request. Optional at the port level: a
	 * provider that does not implement the limits surface leaves it undefined (⇒
	 * "unknown / none applied"), rather than being forced to claim `{}`.
	 */
	readonly appliedLimits?: AppliedLimits;
	kill(signal?: NodeJS.Signals): boolean;
	on(event: "error", listener: (err: Error) => void): this;
	on(
		event: "close",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): this;
}

/**
 * Isolation strength, reported honestly (ADR-0017): `enforced` = a real OS boundary
 * (FS/egress/pid); `cooperative` = own-secret scrub only — unsafe for untrusted
 * input on its own (the honest label names the hole; the B.1 providers close it).
 */
export type SandboxFidelity = "enforced" | "cooperative";

/** One boundary instance. Create per run; destroy when the run ends. */
export interface Sandbox {
	/** Provider id — `"process-floor"` today; `"srt"` / `"e2b"` in B.1. */
	readonly id: string;
	/** Honest isolation fidelity of this provider (ADR-0017). */
	readonly fidelity: SandboxFidelity;
	/** Launch the harness inside the boundary with a duplex stdio channel. */
	spawn(
		command: string,
		args: string[],
		options: SandboxSpawnOptions,
	): SandboxProcess;
	/** Tear down the boundary; kills anything still running inside it. */
	destroy(): Promise<void>;
}
