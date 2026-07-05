/**
 * Sandbox selection (ADR-0020 placement-scaled defaults + ADR-0017 honest fidelity):
 * turn a requested `mode` into a concrete {@link Sandbox}, reporting BOTH what was
 * asked for and what was actually obtained so a degrade is never silent.
 *
 *   - `process` — always the `process` floor (cooperative).
 *   - `srt`     — the enforced srt provider; THROWS when srt is unavailable (the
 *                 caller explicitly asked for enforcement — we do not quietly downgrade).
 *   - `e2b`     — the enforced server/cloud provider (ADR-0020 cloud row); THROWS when
 *                 E2B is unavailable. EXPLICIT-ONLY — `auto` never reaches for it: E2B is
 *                 a remote service needing an `E2B_API_KEY`, so silently selecting it on a
 *                 laptop would be wrong. It is chosen deliberately in server placement.
 *   - `auto`    — srt if available, else the floor (Desktop's "on if available, else
 *                 degrade — honestly" default; ADR-0020 table). The degrade is visible
 *                 in the returned `actual`. `auto` considers only local providers.
 *
 * The default wired into config today is `process` (see the CLI schema); flipping the
 * default to `auto` is a later deliberate change once the egress gate (B.1.1) clears.
 */
import { createE2bSandbox, type E2bSandboxOptions } from "./e2b.js";
import { createProcessFloorSandbox } from "./process-floor.js";
import {
	createSrtSandbox,
	isSrtAvailable,
	type SrtSandboxOptions,
} from "./srt.js";
import type { Sandbox } from "./types.js";

/** The sandbox modes selectable via config/CLI. Shared by the CLI schema + `--sandbox`. */
export const SANDBOX_MODES = ["auto", "process", "srt", "e2b"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export interface ResolveSandboxOptions
	extends SrtSandboxOptions,
		E2bSandboxOptions {}

/** A resolved sandbox plus the honest requested-vs-actual pair (ADR-0017). */
export interface SandboxSelection {
	/** The live boundary to spawn the harness into. */
	sandbox: Sandbox;
	/** What the caller asked for. */
	requested: SandboxMode;
	/** What was actually obtained — the provider id (`"srt"` | `"process-floor"`). */
	actual: string;
}

/**
 * Resolve `mode` into a live {@link Sandbox} + honest selection metadata. Throws for an
 * explicit `srt`/`e2b` request whose provider is unavailable; `auto` degrades to the
 * floor instead (and never reaches for `e2b`).
 */
export function resolveSandbox(
	mode: SandboxMode,
	options: ResolveSandboxOptions = {},
): SandboxSelection {
	switch (mode) {
		case "process": {
			const sandbox = createProcessFloorSandbox();
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "srt": {
			// Explicit request for enforcement — surface the failure, never degrade.
			const sandbox = createSrtSandbox(options);
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "e2b": {
			// Explicit request for the cloud boundary — surface the failure, never degrade.
			const sandbox = createE2bSandbox(options);
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "auto": {
			if (isSrtAvailable()) {
				const sandbox = createSrtSandbox(options);
				return { sandbox, requested: mode, actual: sandbox.id };
			}
			const sandbox = createProcessFloorSandbox();
			return { sandbox, requested: mode, actual: sandbox.id };
		}
	}
}
