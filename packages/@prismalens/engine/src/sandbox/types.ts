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
