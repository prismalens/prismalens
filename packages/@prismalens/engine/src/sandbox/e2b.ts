/**
 * The `e2b` provider (ADR-0020) — the server/cloud `enforced` Sandbox: the harness
 * is spawned THROUGH an E2B microVM (firecracker) with an SDK-exposed egress
 * allowlist. This is the "mandatory, strong, non-negotiable" cloud row of ADR-0020's
 * placement table — a real OS boundary on our infra: no host secrets, allowlisted
 * egress, an ephemeral remote workspace destroyed after the run.
 *
 * Dependency-light (ADR-0011): E2B is NOT a hard engine dependency (the same stance
 * srt.ts takes). We resolve the `e2b` package LAZILY at runtime via `createRequire`
 * and never `import` it, so the engine builds and runs without it. {@link
 * isE2bAvailable} reports presence (package resolvable + `E2B_API_KEY` set); {@link
 * createE2bSandbox} fails with a clear, actionable error when either is missing — the
 * provider never silently degrades (that honest choice belongs to `select.ts`, and
 * E2B is never auto-selected there — it needs an API key, so it is explicit-only).
 *
 * Duplex stdio across the boundary: E2B has no inherited-stdio child (the harness runs
 * on a REMOTE VM), so we adapt its command transport to {@link SandboxProcess} — the
 * harness is started as a background command with an open stdin (`commands.run({
 * background:true, stdin:true })`, which E2B runs as `/bin/bash -l -c <cmd>`), and:
 *   - stdin  ← a Writable whose bytes are forwarded, in order, via `handle.sendStdin`;
 *             its `finish` closes the remote stdin (`handle.closeStdin`, EOF).
 *   - stdout → the `onStdout` stream, pushed into a Readable the ACP readline drains.
 *   - stderr → the `onStderr` stream, likewise.
 *   - close  ← `handle.wait()` resolving (or a `CommandExitError` carrying an exit code).
 *   - error  ← a failure to create the VM / start the command, surfaced ASYNCHRONOUSLY
 *             — exactly node's `child_process.spawn` contract (spawn errors arrive as
 *             an `error` event, not a throw from `spawn`), so the ACP client's existing
 *             `on("error")` / `on("close")` handling drives it unchanged.
 * `spawn` stays SYNCHRONOUS like the port requires; the VM-create + command-start round
 * trips run behind the returned process object, their failures reported via `error`.
 *
 * Workspace is FETCH-MODE only (ADR-0020): the VM is remote, so `cwd` names a
 * sandbox-SIDE working directory, never a host path. `mount`-mode (bind a local path in)
 * is impossible remotely — there is no user machine to mount from in cloud (ADR-0020
 * "`mount` — local only"). Provisioning the workspace (git clone / artifact download into
 * that remote cwd) is a separate fetch step the port does not yet model (types.ts exposes
 * only `spawn`/`destroy`); until that hook lands, the caller must ensure the harness
 * binary + workspace exist in the chosen E2B template. See the returned-gap note in the
 * B.1.3 report.
 *
 * Egress is ALLOWLISTED at the SDK level (ADR-0020 "allowlist, not closed, not open"):
 * `network.allowOut` restricts outbound traffic to the given hosts; an empty allowlist
 * denies all egress (`allowInternetAccess:false`, == `denyOut:['0.0.0.0/0']`). This is
 * a real E2B firewall control — not an infra-side TODO — mirroring srt's allow-only
 * default.
 */

import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import { PassThrough, Writable } from "node:stream";
import type {
	AppliedLimits,
	Sandbox,
	SandboxLimits,
	SandboxProcess,
	SandboxSpawnOptions,
} from "./types.js";

// --- Minimal structural view of the `e2b` SDK ------------------------------------
// We depend on the SHAPE, never the package (ADR-0011 dependency-light) — these
// capture only the surface this provider drives, so the engine needs no `e2b` types.

interface E2bCommandResult {
	exitCode?: number;
	error?: string;
}

interface E2bCommandHandle {
	sendStdin(data: string | Uint8Array): Promise<void>;
	closeStdin(): Promise<void>;
	kill(): Promise<boolean>;
	wait(): Promise<E2bCommandResult>;
}

interface E2bRunOpts {
	background: true;
	stdin: boolean;
	cwd?: string;
	envs?: Record<string, string>;
	onStdout?: (data: string) => void;
	onStderr?: (data: string) => void;
}

interface E2bRemoteSandbox {
	sandboxId: string;
	commands: { run(cmd: string, opts: E2bRunOpts): Promise<E2bCommandHandle> };
	kill(): Promise<boolean>;
}

interface E2bCreateOpts {
	apiKey?: string;
	timeoutMs?: number;
	allowInternetAccess?: boolean;
	network?: { allowOut?: string[] };
}

interface E2bModule {
	Sandbox: {
		create(template: string, opts: E2bCreateOpts): Promise<E2bRemoteSandbox>;
	};
}

/** Resolve the `e2b` package at runtime (CJS entry). Throws if it is not installed. */
function loadE2b(): E2bModule {
	const require = createRequire(import.meta.url);
	return require("e2b") as E2bModule;
}

/**
 * True when the E2B provider can actually run: the `e2b` package is resolvable AND an
 * `E2B_API_KEY` is present. Unlike srt's availability probe, the API key is part of the
 * check — E2B is a remote service, so a missing key is an unavailability, not a runtime
 * spawn error. The selection layer never auto-selects E2B regardless (explicit-only).
 */
export function isE2bAvailable(): boolean {
	if (!process.env.E2B_API_KEY) return false;
	try {
		createRequire(import.meta.url).resolve("e2b/package.json");
		return true;
	} catch {
		return false;
	}
}

/** Egress + placement options for the E2B boundary. */
export interface E2bSandboxOptions {
	/**
	 * Hosts the sandboxed harness may reach (LLM endpoint, git hosts, telemetry).
	 * Empty/omitted ⇒ NO egress (E2B `allowInternetAccess:false`) — allow-only, like srt.
	 */
	allowedDomains?: string[];
	/**
	 * E2B template name/ID the VM boots from. The template MUST contain the harness
	 * binary + tools (the stock `base` template does not). Falls back to `E2B_TEMPLATE`
	 * then `"base"`. Building that template is infra/packaging (Phase D), not this port.
	 */
	template?: string;
	/** BYO E2B API key; falls back to `E2B_API_KEY`. */
	apiKey?: string;
	/**
	 * VM wall-clock lifetime (ms). Omitted ⇒ the SDK default (5 min). Real resource caps
	 * (CPU/mem/disk) are B.1.2's job; this only bounds the boundary's lifetime. When the
	 * first spawn carries `limits.wallClockMs`, the VM lifetime is raised to cover it
	 * (plus headroom) so the SDK default can never silently undercut the reported limit.
	 */
	timeoutMs?: number;
	/**
	 * Test seam: inject a fake `e2b` module so the adapter's transport logic (stdin
	 * buffering/replay/EOF ordering, deadline, kill) is hermetically testable without
	 * the package or an API key. Never set in production code.
	 */
	loader?: () => E2bModule;
}

/** Default E2B template when none is configured (see {@link E2bSandboxOptions.template}). */
const DEFAULT_TEMPLATE = "base";

/**
 * POSIX single-quote a token so the assembled command line survives E2B's
 * `/bin/bash -l -c <cmd>` execution verbatim — harness flags (e.g. `-m <model>`) and
 * paths pass through without shell reinterpretation.
 */
function shellQuote(token: string): string {
	return `'${token.replaceAll("'", `'\\''`)}'`;
}

/** Drop undefined values so we hand E2B a clean `Record<string,string>` env. */
function definedEnv(env?: NodeJS.ProcessEnv): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env ?? {})) {
		if (value !== undefined) out[key] = value;
	}
	return out;
}

/**
 * The stdin half of {@link E2bSandboxProcess}: a Writable that forwards the ACP client's
 * newline-delimited JSON-RPC to the remote command's stdin. The remote handle is not
 * available synchronously (the VM-create + command-start round trip is async), so writes
 * that arrive BEFORE it resolves are BUFFERED and replayed in order on {@link attach} —
 * ahead of the EOF. Doing the ordering here, rather than leaning on PassThrough `data` /
 * `finish` event interleaving, is deliberate: with a pre-attach buffer that interleaving
 * lets EOF (`finish`) overtake the buffered payload (`data`) and close the remote stdin
 * before a byte is sent. Every forward is chained on a single promise so `sendStdin`'s
 * async network hops preserve byte order without overlap, and `closeStdin` (EOF) is
 * always the LAST link.
 */
class E2bStdin extends Writable {
	private handle: E2bCommandHandle | null = null;
	private readonly buffered: Buffer[] = [];
	private endBuffered = false;
	private chain: Promise<unknown> = Promise.resolve();

	override _write(
		chunk: Buffer,
		_enc: BufferEncoding,
		cb: (err?: Error | null) => void,
	): void {
		if (this.handle) this.forward(Buffer.from(chunk));
		else this.buffered.push(Buffer.from(chunk));
		cb();
	}

	override _final(cb: (err?: Error | null) => void): void {
		if (this.handle) this.closeRemote();
		else this.endBuffered = true;
		cb();
	}

	/** Bind the resolved handle: replay buffered writes in order, then any pending EOF. */
	attach(handle: E2bCommandHandle): void {
		this.handle = handle;
		for (const chunk of this.buffered) this.forward(chunk);
		this.buffered.length = 0;
		if (this.endBuffered) this.closeRemote();
	}

	private forward(chunk: Buffer): void {
		const handle = this.handle;
		if (!handle) return;
		this.chain = this.chain.then(() => handle.sendStdin(chunk).catch(() => {}));
	}

	private closeRemote(): void {
		const handle = this.handle;
		if (!handle) return;
		this.chain = this.chain.then(() => handle.closeStdin().catch(() => {}));
	}
}

/**
 * A {@link SandboxProcess} backed by an E2B background command. Presents node-stream
 * stdio + `error`/`close` events to the ACP client while the actual transport is E2B's
 * remote command handle, wired in via {@link attach} once the async start resolves.
 */
class E2bSandboxProcess extends EventEmitter implements SandboxProcess {
	readonly stdin: E2bStdin;
	readonly stdout: Readable;
	readonly stderr: Readable;
	killed = false;
	timedOut = false;
	readonly appliedLimits: AppliedLimits;

	private readonly stdoutPass: PassThrough;
	private readonly stderrPass: PassThrough;
	private handle: E2bCommandHandle | null = null;
	private settled = false;
	private outputEnded = false;
	private deadline: ReturnType<typeof setTimeout> | null = null;

	constructor(limits?: SandboxLimits) {
		super();
		// stdin: the ACP client WRITES newline-delimited JSON-RPC here; we forward it.
		this.stdin = new E2bStdin();
		// stdout/stderr: we WRITE the remote command's output here; readline READS stdout.
		this.stdoutPass = new PassThrough();
		this.stderrPass = new PassThrough();
		this.stdout = this.stdoutPass;
		this.stderr = this.stderrPass;

		// Wall-clock is the one limit EVERY provider enforces (ADR-0020 resource-limits
		// contract): a userspace deadline that kills the remote command and flips
		// `timedOut` so the runner distinguishes a deadline kill from an early exit.
		// Memory/cpu need per-VM template levers E2B does not expose per-run, so they are
		// NOT claimed here — `appliedLimits` reports only what actually took effect.
		const applied: AppliedLimits = {};
		if (limits?.wallClockMs && limits.wallClockMs > 0) {
			applied.wallClockMs = limits.wallClockMs;
			this.deadline = setTimeout(() => {
				this.timedOut = true;
				this.kill("SIGKILL");
			}, limits.wallClockMs);
			this.deadline.unref(); // a pending deadline must not keep the loop alive
		}
		this.appliedLimits = applied;
	}

	/** Push a remote-stdout chunk to the readable the ACP readline drains. */
	pushStdout(data: string): void {
		if (!this.outputEnded) this.stdoutPass.write(data);
	}

	/** Push a remote-stderr chunk to the readable the ACP client tails for diagnostics. */
	pushStderr(data: string): void {
		if (!this.outputEnded) this.stderrPass.write(data);
	}

	/** Bind the resolved remote command handle to the stdio forwarders. */
	attach(handle: E2bCommandHandle): void {
		this.handle = handle;
		if (this.killed) {
			// Killed during the start round trip — reap the just-started command.
			void handle.kill().catch(() => {});
			return;
		}
		this.stdin.attach(handle);
	}

	/** Terminal: the remote command exited — end the streams and emit `close`. */
	closeWith(code: number | null): void {
		this.settle(() => this.emit("close", code, null));
	}

	/**
	 * Terminal: the VM/command failed to start — emit `error` (child_process contract).
	 * A failure that arrives AFTER an explicit kill is the kill's own consequence, so it
	 * degrades to a clean `close` rather than a spurious error.
	 */
	failWith(err: Error): void {
		if (this.killed) {
			this.closeWith(null);
			return;
		}
		this.settle(() => this.emit("error", err));
	}

	kill(_signal?: NodeJS.Signals): boolean {
		this.killed = true;
		if (this.stdin.writable) this.stdin.end();
		if (this.handle) void this.handle.kill().catch(() => {});
		return true;
	}

	private settle(emit: () => void): void {
		if (this.settled) return;
		this.settled = true;
		if (this.deadline) {
			clearTimeout(this.deadline);
			this.deadline = null;
		}
		this.endOutput();
		emit();
	}

	private endOutput(): void {
		if (this.outputEnded) return;
		this.outputEnded = true;
		this.stdoutPass.end();
		this.stderrPass.end();
	}
}

/**
 * Create an `enforced` E2B boundary. Throws (never degrades) when the `e2b` package is
 * missing or `E2B_API_KEY` is unset — the caller/selection layer decides what to do. One
 * remote VM per boundary, created LAZILY on the first spawn (construction stays cheap +
 * network-free, like srt); `destroy()` kills the VM and any running commands.
 */
export function createE2bSandbox(options: E2bSandboxOptions = {}): Sandbox {
	let e2b: E2bModule;
	try {
		e2b = options.loader ? options.loader() : loadE2b();
	} catch {
		throw new Error(
			"e2b sandbox unavailable: could not resolve the 'e2b' package. Install it " +
				"(`npm i e2b`) or select a different sandbox mode (--sandbox process|srt).",
		);
	}
	const apiKey = options.apiKey ?? process.env.E2B_API_KEY;
	if (!apiKey) {
		throw new Error(
			"e2b sandbox unavailable: E2B_API_KEY is not set. Export E2B_API_KEY " +
				"(https://e2b.dev/dashboard) or select a different sandbox mode " +
				"(--sandbox process|srt).",
		);
	}

	const template =
		options.template ?? process.env.E2B_TEMPLATE ?? DEFAULT_TEMPLATE;
	// Allow-only egress (ADR-0020): a non-empty allowlist restricts outbound to those
	// hosts; an empty allowlist denies ALL egress. Fixed for this boundary's life.
	const allowed = options.allowedDomains ?? [];
	const network: Pick<E2bCreateOpts, "allowInternetAccess" | "network"> =
		allowed.length > 0
			? { network: { allowOut: allowed } }
			: { allowInternetAccess: false };

	const children = new Set<E2bSandboxProcess>();
	let vmPromise: Promise<E2bRemoteSandbox> | null = null;
	let vm: E2bRemoteSandbox | null = null;
	// Headroom over the userspace deadline so the deadline is always the BINDING
	// limit: the SDK's ~5-min default VM lifetime must never undercut a longer
	// wallClockMs — that would kill the run early while appliedLimits reported the
	// longer bound (honest-limits, review finding B.1.3).
	const VM_LIFETIME_HEADROOM_MS = 60_000;
	const ensureVm = (minLifetimeMs?: number): Promise<E2bRemoteSandbox> => {
		if (!vmPromise) {
			const needed =
				minLifetimeMs !== undefined
					? minLifetimeMs + VM_LIFETIME_HEADROOM_MS
					: undefined;
			const timeoutMs =
				options.timeoutMs !== undefined || needed !== undefined
					? Math.max(options.timeoutMs ?? 0, needed ?? 0)
					: undefined;
			vmPromise = e2b.Sandbox.create(template, {
				apiKey,
				...(timeoutMs !== undefined ? { timeoutMs } : {}),
				...network,
			}).then((created) => {
				vm = created;
				return created;
			});
		}
		// The VM lifetime is fixed by the FIRST spawn; a later spawn with a longer
		// deadline reuses the boundary as-is (one run per boundary today, B.2 revisits).
		return vmPromise;
	};

	return {
		id: "e2b",
		fidelity: "enforced",
		spawn(command, args, spawnOptions: SandboxSpawnOptions): SandboxProcess {
			const proc = new E2bSandboxProcess(spawnOptions.limits);
			children.add(proc);
			proc.on("close", () => children.delete(proc));
			// The remote VM runs the child with FRESH env (a different machine — our
			// process.env never crosses the boundary, a stronger own-secret isolation
			// than the floor's allowlist); only the caller's BYO-key env is injected.
			const commandLine = [command, ...args].map(shellQuote).join(" ");
			const envs = definedEnv(spawnOptions.env);
			// Async VM-create + command-start behind the sync process object; failures
			// surface as an `error` event (node's spawn contract), never a throw here.
			void (async () => {
				try {
					const sandbox = await ensureVm(spawnOptions.limits?.wallClockMs);
					const handle = await sandbox.commands.run(commandLine, {
						background: true,
						stdin: true,
						cwd: spawnOptions.cwd,
						envs,
						onStdout: (d) => proc.pushStdout(d),
						onStderr: (d) => proc.pushStderr(d),
					});
					proc.attach(handle);
					handle.wait().then(
						(res) => proc.closeWith(res.exitCode ?? null),
						(err: unknown) => {
							// A non-zero exit throws CommandExitError, which still carries the
							// code — that is a `close`, not a transport `error`.
							const code = (err as { exitCode?: number }).exitCode;
							if (typeof code === "number") proc.closeWith(code);
							else
								proc.failWith(
									err instanceof Error ? err : new Error(String(err)),
								);
						},
					);
				} catch (err) {
					proc.failWith(err instanceof Error ? err : new Error(String(err)));
				}
			})();
			return proc;
		},
		async destroy(): Promise<void> {
			for (const child of children) {
				if (!child.killed) child.kill();
			}
			children.clear();
			if (vmPromise) {
				try {
					const sandbox = vm ?? (await vmPromise);
					await sandbox.kill();
				} catch {
					// best-effort remote teardown — the VM also self-expires on its timeout
				}
				vmPromise = null;
				vm = null;
			}
		},
	};
}
