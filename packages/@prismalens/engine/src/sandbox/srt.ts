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
import { buildFloorEnv } from "./process-floor.js";
import type { Sandbox, SandboxProcess, SandboxSpawnOptions } from "./types.js";

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

/** Egress allowlist for the srt boundary (ADR-0020: allowlist, not closed, not open). */
export interface SrtSandboxOptions {
	/**
	 * Domains the sandboxed harness may reach (git hosts, telemetry endpoints, package
	 * registries). Empty/omitted ⇒ NO egress — srt's network default is allow-only.
	 */
	allowedDomains?: string[];
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
	const settingsDir = mkdtempSync(join(tmpdir(), "pl-srt-"));
	const settingsPath = join(settingsDir, "srt-settings.json");
	writeFileSync(
		settingsPath,
		JSON.stringify({
			network: {
				allowedDomains: options.allowedDomains ?? [],
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

	const children = new Set<SandboxProcess>();
	return {
		id: "srt",
		fidelity: "enforced",
		spawn(command, args, spawnOptions: SandboxSpawnOptions): SandboxProcess {
			// `srt --settings <path> -- <command> <args...>`: the `--` ends srt's own
			// option parsing so harness flags (e.g. `-m <model>`) pass through verbatim.
			// srt runs the child with inherited stdio, so our fully-piped stdio is the
			// harness's duplex JSON-RPC channel across the OS boundary (spike 2026-07-03).
			// Own-secret isolation (ADR-0009): the srt process — and thus the harness it
			// wraps — gets the scrubbed floor env (allowlist + BYO-key), never our verbatim
			// process.env; srt layers its egress-proxy vars on top of that.
			const child = spawn(
				entry.command,
				[
					...entry.prefixArgs,
					"--settings",
					settingsPath,
					"--",
					command,
					...args,
				],
				{
					cwd: spawnOptions.cwd,
					env: buildFloorEnv(spawnOptions.env),
					stdio: ["pipe", "pipe", "pipe"],
				},
			);
			children.add(child);
			child.on("close", () => children.delete(child));
			return child;
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
