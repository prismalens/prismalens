/**
 * Sandbox selection (ADR-0020 placement-scaled defaults + ADR-0017 honest fidelity):
 * turn a requested `mode` into a concrete {@link Sandbox}, reporting BOTH what was
 * asked for and what was actually obtained so a degrade is never silent.
 *
 *   - `process` — always the `process` floor (cooperative).
 *   - `srt`     — the enforced srt provider; THROWS when srt is unavailable (the
 *                 caller explicitly asked for enforcement — we do not quietly downgrade).
 *   - `auto`    — srt if available, else the floor (Desktop's "on if available, else
 *                 degrade — honestly" default; ADR-0020 table). The degrade is visible
 *                 in the returned `actual`.
 *
 * The default wired into config today is `process` (see the CLI schema); flipping the
 * default to `auto` is a later deliberate change once the egress gate (B.1.1) clears.
 */
import { createProcessFloorSandbox } from "./process-floor.js";
import {
	createSrtSandbox,
	isSrtAvailable,
	type SrtSandboxOptions,
} from "./srt.js";
import type { Sandbox } from "./types.js";

/** The sandbox modes selectable via config/CLI. Shared by the CLI schema + `--sandbox`. */
export const SANDBOX_MODES = ["auto", "process", "srt"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export interface ResolveSandboxOptions extends SrtSandboxOptions {}

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
 * Resolve `mode` into a live {@link Sandbox} + honest selection metadata. Throws only
 * for `srt` when srt is unavailable; `auto` degrades to the floor instead.
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
