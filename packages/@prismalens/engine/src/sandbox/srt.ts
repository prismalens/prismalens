/**
 * The `srt` provider (ADR-0020) — the local/desktop `enforced` Sandbox: the harness
 * is spawned THROUGH Anthropic's `@anthropic-ai/sandbox-runtime` (bwrap+seccomp on
 * Linux, `sandbox-exec` on macOS) with a domain-allowlist egress proxy. This closes
 * the `process` floor's hole (ADR-0020 §"cooperative means unsafe for untrusted
 * input"): a real OS boundary — no host secrets, no arbitrary egress, workspace-only
 * writes.
 *
 * Dependency-light (ADR-0011): srt is NOT a hard engine dependency. We resolve the
 * srt entrypoint (the installed package's `bin`, else an `srt` binary on PATH) LAZILY
 * at runtime and spawn it as a child; the engine never `import`s the package. When it
 * cannot be resolved, {@link createSrtSandbox} fails with a clear error — the provider
 * never silently degrades (that honest choice belongs to the selection layer,
 * `select.ts`).
 *
 * Duplex stdio survives the boundary: srt runs the wrapped child with INHERITED
 * stdio, so the fully-piped stdio we give the srt process reaches the harness as a
 * line-delimited JSON-RPC channel — verified end-to-end in the 2026-07-03 spike
 * ([[sandbox-backends-survey]]).
 */
import { spawn } from "node:child_process";
import {
	accessSync,
	constants,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { buildFloorEnv, withLimits } from "./process-floor.js";
import type {
	AppliedLimits,
	Sandbox,
	SandboxProcess,
	SandboxSpawnOptions,
} from "./types.js";

/** How to invoke srt: the binary/interpreter + any leading args (e.g. the cli.js path). */
interface SrtEntry {
	command: string;
	prefixArgs: string[];
}

/**
 * Resolve srt from the installed `@anthropic-ai/sandbox-runtime` package. We read the
 * package's `bin.srt` and run it through the current node (`process.execPath`) so we
 * do not depend on a shebang or an executable bit surviving the install. Returns null
 * (never throws) when the package is not installed — that is the expected path in the
 * dependency-light engine.
 */
function resolveSrtPackageEntry(): SrtEntry | null {
	try {
		const require = createRequire(import.meta.url);
		const pkgJsonPath = require.resolve(
			"@anthropic-ai/sandbox-runtime/package.json",
		);
		const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
			bin?: string | Record<string, string>;
		};
		const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.srt;
		if (!bin) return null;
		const cliPath = join(dirname(pkgJsonPath), bin);
		accessSync(cliPath, constants.R_OK);
		return { command: process.execPath, prefixArgs: [cliPath] };
	} catch {
		return null;
	}
}

/** Resolve a globally-installed `srt` binary from PATH (README's `npm i -g` path). */
function resolveSrtBinaryOnPath(): SrtEntry | null {
	const pathVar = process.env.PATH;
	if (!pathVar) return null;
	for (const dir of pathVar.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, "srt");
		try {
			accessSync(candidate, constants.X_OK);
			return { command: candidate, prefixArgs: [] };
		} catch {
			// not here — keep scanning PATH
		}
	}
	return null;
}

/** The installed package wins over a PATH binary (it pins the version we spiked). */
function resolveSrtEntry(): SrtEntry | null {
	return resolveSrtPackageEntry() ?? resolveSrtBinaryOnPath();
}

/**
 * True when the srt entrypoint can be resolved at runtime (package or PATH binary).
 * The selection layer (`select.ts`) uses this to decide `auto` without constructing a
 * provider. This does NOT probe the OS primitive (bwrap/sandbox-exec) — a present-srt
 * / missing-bwrap host surfaces as an honest transport error on the first spawn, not a
 * false "available".
 */
export function isSrtAvailable(): boolean {
	return resolveSrtEntry() !== null;
}

/**
 * Lazily-memoized probe for `systemd-run` on PATH — the only portable, root-free
 * lever for a cgroup memory/cpu cap around the srt child (`--user --scope` runs it in
 * the caller's user manager). srt's own settings expose NO memory/cpu knob (verified
 * against the package's `SandboxConfig`, B.1.2), so this wrapper is that path.
 *
 * Presence on PATH is the probe (cheap + hermetic); it does NOT verify a user manager
 * is actually running. If scope creation later fails at spawn time, `systemd-run`
 * exits non-zero and the harness never starts — an honest transport error the runner
 * reports, never a silent unlimited run. `undefined` = not yet probed.
 */
let systemdRunPath: string | null | undefined;
function resolveSystemdRun(): string | null {
	if (systemdRunPath !== undefined) return systemdRunPath;
	systemdRunPath = null;
	const pathVar = process.env.PATH;
	if (pathVar) {
		for (const dir of pathVar.split(delimiter)) {
			if (!dir) continue;
			const candidate = join(dir, "systemd-run");
			try {
				accessSync(candidate, constants.X_OK);
				systemdRunPath = candidate;
				break;
			} catch {
				// keep scanning PATH
			}
		}
	}
	return systemdRunPath;
}

/** Whole-integer megabytes for `MemoryMax`; positive requests only. */
function memoryMaxArg(memoryMb: number | undefined): string | null {
	if (!memoryMb || memoryMb <= 0) return null;
	return `MemoryMax=${Math.round(memoryMb)}M`;
}

/** `CPUQuota` as a percentage of ONE core: 2 cores → `CPUQuota=200%`. */
function cpuQuotaArg(cpuCores: number | undefined): string | null {
	if (!cpuCores || cpuCores <= 0) return null;
	return `CPUQuota=${Math.round(cpuCores * 100)}%`;
}

/** Egress allowlist for the srt boundary (ADR-0020: allowlist, not closed, not open). */
export interface SrtSandboxOptions {
	/**
	 * Domains the sandboxed harness may reach (git hosts, telemetry endpoints, package
	 * registries). Empty/omitted ⇒ NO egress — srt's network default is allow-only.
	 */
	allowedDomains?: string[];
}

/**
 * Write srt's settings JSON — allow-only egress (`strictAllowlist`, so non-allowlisted
 * hosts are HARD-denied regardless of any ask-callback) + workspace-scoped writes — to a
 * fresh temp dir. Returns the dir + file path; the caller removes the dir. Shared by the
 * live boundary ({@link createSrtSandbox}) and the egress self-check ({@link probeSrtEgress})
 * so both spawn srt with byte-identical network semantics.
 */
function writeSrtSettings(allowedDomains: string[]): {
	settingsDir: string;
	settingsPath: string;
} {
	const settingsDir = mkdtempSync(join(tmpdir(), "pl-srt-"));
	const settingsPath = join(settingsDir, "srt-settings.json");
	writeFileSync(
		settingsPath,
		JSON.stringify({
			network: {
				allowedDomains,
				deniedDomains: [],
				// Hard-deny non-allowlisted hosts regardless of any ask-callback: srt
				// only guarantees denial when strictAllowlist is set (its CLI happens
				// to run without an ask callback today, but "enforced" must not hinge
				// on that implementation detail — an interactive prompt would also
				// wedge our piped JSON-RPC stdin).
				strictAllowlist: true,
			},
			filesystem: { denyRead: [], allowWrite: ["."], denyWrite: [] },
		}),
	);
	return { settingsDir, settingsPath };
}

/**
 * The internal seam {@link probeSrtEgress} drives to actually exercise the srt boundary:
 * spawn srt with an allowlist of exactly `[hostname-of-targetUrl]` running `curl` against
 * the REAL `targetUrl` and RESOLVE with curl's captured `%{http_code}` (an empty string
 * when srt/curl could not even run). Never rejects — an unreachable bridge is data, not an
 * exception. Production uses {@link defaultSrtEgressRunner}; hermetic tests inject a fake so
 * no srt is spawned.
 */
export type SrtEgressRunner = (targetUrl: string) => Promise<string>;

/** Overall watchdog for a single egress probe: SIGKILL a wedged srt/curl after this long. */
export const SRT_EGRESS_WATCHDOG_MS = 15_000;

/**
 * The promise wrapper shared by {@link defaultSrtEgressRunner} and its hermetic tests: run a
 * child (produced by `spawnChild`, which reports the captured code through the `finish`
 * callback it is handed) under an OVERALL WATCHDOG — a `timeoutMs` timer that SIGKILLs the
 * child and resolves `""` (unhealthy) if it never closes. NEVER rejects and NEVER hangs; a
 * synchronous throw from `spawnChild` also resolves `""`. The timer is cleared the moment
 * the child settles, and `unref`ed so a live probe cannot keep the process alive.
 */
export function runEgressProbeWithWatchdog(
	spawnChild: (finish: (code: string) => void) => {
		kill(signal?: NodeJS.Signals | number): void;
	},
	timeoutMs: number = SRT_EGRESS_WATCHDOG_MS,
): Promise<string> {
	return new Promise<string>((resolveCode) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (code: string): void => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			resolveCode(code);
		};
		let child: { kill(signal?: NodeJS.Signals | number): void };
		try {
			child = spawnChild(finish);
		} catch {
			// srt/curl failed to even spawn ⇒ unhealthy, never a thrown probe.
			finish("");
			return;
		}
		// A srt boundary whose mux never closes (the exact WSL blackout failure) would
		// otherwise hang the probe forever; kill it and read the silence as unhealthy.
		timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// already gone — the close handler (if any) is a no-op past `settled`
			}
			finish("");
		}, timeoutMs);
		timer.unref?.();
	});
}

/**
 * The production {@link SrtEgressRunner}: spawn a minimal srt boundary (allowlist exactly
 * `[hostname-of-targetUrl]`, strictAllowlist) running `curl -sS -o /dev/null -w
 * '%{http_code}' --max-time 8 <targetUrl>` against the REAL url, and resolve with the
 * captured http-code string. srt or curl failing to run (unresolvable srt, missing curl,
 * spawn error), an unparseable target, or an overall-watchdog SIGKILL all resolve to `""` —
 * read as unhealthy upstream — rather than throwing. Uses the same scrubbed floor env as the
 * live boundary.
 */
function defaultSrtEgressRunner(targetUrl: string): Promise<string> {
	const entry = resolveSrtEntry();
	// srt itself unresolvable ⇒ nothing to probe; empty string reads as unhealthy.
	if (!entry) return Promise.resolve("");
	let hostname: string;
	try {
		hostname = new URL(targetUrl).hostname;
	} catch {
		// A caller handing us a non-URL is a bug upstream; treat as unhealthy, never throw.
		return Promise.resolve("");
	}
	const { settingsDir, settingsPath } = writeSrtSettings([hostname]);
	const srtArgv = [
		...entry.prefixArgs,
		"--settings",
		settingsPath,
		"--",
		"curl",
		"-sS",
		"-o",
		"/dev/null",
		"-w",
		"%{http_code}",
		"--max-time",
		"8",
		targetUrl,
	];
	return runEgressProbeWithWatchdog((finish) => {
		const child = spawn(entry.command, srtArgv, {
			env: buildFloorEnv(),
			stdio: ["ignore", "pipe", "ignore"],
		});
		const chunks: Buffer[] = [];
		child.stdout.on("data", (d: Buffer) => chunks.push(d));
		// srt/curl failed to even spawn ⇒ unhealthy, never a thrown probe.
		child.on("error", () => finish(""));
		child.on("close", () => finish(Buffer.concat(chunks).toString().trim()));
		return child;
	}).finally(() => {
		try {
			rmSync(settingsDir, { recursive: true, force: true });
		} catch {
			// best-effort temp cleanup — a leftover settings file is harmless
		}
	});
}

/** TTL for an UNHEALTHY egress verdict — a transient blip must not disable srt for days. */
export const SRT_EGRESS_UNHEALTHY_TTL_MS = 5 * 60_000;

/**
 * A memoized egress verdict. A HEALTHY verdict is permanent (no `expiresAt`) — the WSL
 * networking mode does not turn ON mid-run. An UNHEALTHY verdict carries an `expiresAt` so a
 * transient blip on a long-lived worker re-probes after {@link SRT_EGRESS_UNHEALTHY_TTL_MS}
 * instead of disabling srt for the process's whole (possibly days-long) lifetime.
 */
interface EgressVerdict {
	healthy: boolean;
	/** Wall-clock ms after which this verdict is stale and must be re-probed. */
	expiresAt?: number;
}

/** Per-target-URL memo of the egress self-check (healthy = permanent, unhealthy = TTL'd). */
const egressProbeCache = new Map<string, EgressVerdict>();

/** TEST-ONLY: clear the egress memo so hermetic cases don't leak a verdict across tests. */
export function __clearSrtEgressCache(): void {
	egressProbeCache.clear();
}

export interface ProbeSrtEgressOptions {
	/**
	 * TEST SEAM: the {@link SrtEgressRunner} to use. Omitted in production (the real
	 * srt+curl runner); hermetic tests inject a fake so no srt is ever spawned.
	 */
	runner?: SrtEgressRunner;
	/**
	 * TEST SEAM: the clock read for TTL comparisons + expiry stamping. Omitted in
	 * production (`Date.now`); tests inject a fake clock to drive UNHEALTHY-verdict expiry.
	 */
	now?: () => number;
}

/**
 * EGRESS SELF-CHECK (ADR-0020 B.1.1): does srt's in-netns relay ACTUALLY carry traffic on
 * THIS host? {@link isSrtAvailable} only sees the binary — it cannot see the WSL-mirrored-
 * networking failure where srt's mux logs "bridges ready" but every sandboxed request
 * returns curl 000 while the host itself has egress (verified on real WSL2). So the `auto`
 * selector, before trusting srt for a run that NEEDS egress, spawns a throwaway srt boundary
 * allowlisting exactly the target URL's hostname and curls the REAL `targetUrl`: a real HTTP
 * code (any 3-digit status, not `000`/empty) ⇒ the bridge carries traffic (healthy);
 * `000`/empty ⇒ a dead bridge (unhealthy). curl-missing or srt-spawn-failure ⇒ unhealthy —
 * this NEVER throws. Memoized per target URL: a HEALTHY verdict for the process lifetime, an
 * UNHEALTHY one only until {@link SRT_EGRESS_UNHEALTHY_TTL_MS} elapses (then re-probed).
 */
export async function probeSrtEgress(
	targetUrl: string,
	opts: ProbeSrtEgressOptions = {},
): Promise<boolean> {
	const now = opts.now ?? Date.now;
	const cached = egressProbeCache.get(targetUrl);
	// A HEALTHY verdict (no expiry) is always fresh; an UNHEALTHY one is fresh until its TTL.
	if (
		cached !== undefined &&
		(cached.expiresAt === undefined || now() < cached.expiresAt)
	) {
		return cached.healthy;
	}
	let healthy = false;
	try {
		const code = (
			await (opts.runner ?? defaultSrtEgressRunner)(targetUrl)
		).trim();
		// A real HTTP code is three digits and not the curl "could-not-connect" 000.
		healthy = /^\d{3}$/.test(code) && code !== "000";
	} catch {
		// Defensive: a runner that rejects is treated as an unhealthy bridge, not a throw.
		healthy = false;
	}
	egressProbeCache.set(
		targetUrl,
		healthy
			? { healthy: true }
			: { healthy: false, expiresAt: now() + SRT_EGRESS_UNHEALTHY_TTL_MS },
	);
	return healthy;
}

/**
 * Create an `enforced` srt boundary. Throws (never degrades) when srt cannot be
 * resolved — the caller/selection layer decides what to do about that. One instance
 * per run; `destroy()` reaps stragglers and removes the settings file.
 */
export function createSrtSandbox(options: SrtSandboxOptions = {}): Sandbox {
	const entry = resolveSrtEntry();
	if (!entry) {
		throw new Error(
			"srt sandbox unavailable: could not resolve '@anthropic-ai/sandbox-runtime' " +
				"or an `srt` binary on PATH. Install it (`npm i -g @anthropic-ai/sandbox-runtime`) " +
				"or select a different sandbox mode (--sandbox process).",
		);
	}

	// The srt settings the spike used: allow-only egress (empty ⇒ no network) and
	// workspace-scoped writes — ADR-0020's "generous workspace inside a tight box".
	// Written once at construction; the allowlist is fixed for this boundary's life.
	const { settingsDir, settingsPath } = writeSrtSettings(
		options.allowedDomains ?? [],
	);

	const children = new Set<SandboxProcess>();
	return {
		id: "srt",
		fidelity: "enforced",
		spawn(command, args, spawnOptions: SandboxSpawnOptions): SandboxProcess {
			// `srt --settings <path> -- <command> <args...>`: the `--` ends srt's own
			// option parsing so harness flags (e.g. `-m <model>`) pass through verbatim.
			// srt runs the child with inherited stdio, so our fully-piped stdio is the
			// harness's duplex JSON-RPC channel across the OS boundary (spike 2026-07-03).
			const srtArgv = [
				...entry.prefixArgs,
				"--settings",
				settingsPath,
				"--",
				command,
				...args,
			];

			// Resource limits (ADR-0020): srt exposes no memory/cpu knob, so cap those
			// two by WRAPPING the whole srt invocation in a transient systemd `--scope`
			// cgroup WHEN AVAILABLE (probed once, lazily). Absent systemd-run, they are
			// honestly unsupported — reported by their ABSENCE from `appliedLimits`, not
			// faked. Wall-clock is enforced for every provider by {@link withLimits}.
			const memArg = memoryMaxArg(spawnOptions.limits?.memoryMb);
			const cpuArg = cpuQuotaArg(spawnOptions.limits?.cpuCores);
			const systemdRun = memArg || cpuArg ? resolveSystemdRun() : null;
			const enforced: Pick<AppliedLimits, "memoryMb" | "cpuCores"> = {};
			let spawnCommand = entry.command;
			let spawnArgs = srtArgv;
			if (systemdRun) {
				const props: string[] = [];
				if (memArg) {
					props.push("-p", memArg);
					enforced.memoryMb = spawnOptions.limits?.memoryMb;
				}
				if (cpuArg) {
					props.push("-p", cpuArg);
					enforced.cpuCores = spawnOptions.limits?.cpuCores;
				}
				// `--user --scope` attaches the cgroup in the caller's user manager (no
				// root); `--quiet` keeps systemd's own chatter off our JSON-RPC stderr.
				spawnCommand = systemdRun;
				spawnArgs = [
					"--user",
					"--scope",
					"--quiet",
					...props,
					"--",
					entry.command,
					...srtArgv,
				];
			}

			// Own-secret isolation (ADR-0009): the srt process — and thus the harness it
			// wraps — gets the scrubbed floor env (allowlist + BYO-key), never our verbatim
			// process.env; srt layers its egress-proxy vars on top of that.
			const child = spawn(spawnCommand, spawnArgs, {
				cwd: spawnOptions.cwd,
				env: buildFloorEnv(spawnOptions.env),
				stdio: ["pipe", "pipe", "pipe"],
			});
			const proc = withLimits(child, spawnOptions.limits, enforced);
			children.add(proc);
			proc.on("close", () => children.delete(proc));
			return proc;
		},
		async destroy(): Promise<void> {
			for (const child of children) {
				if (!child.killed) child.kill();
			}
			children.clear();
			try {
				rmSync(settingsDir, { recursive: true, force: true });
			} catch {
				// best-effort temp cleanup — a leftover settings file is harmless
			}
		},
	};
}
