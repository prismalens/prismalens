// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
 *   - `auto`    — srt if available AND its egress bridge actually carries traffic, else
 *                 the floor (Desktop's "on if available, else degrade — honestly" default;
 *                 ADR-0020 table). The degrade is visible in `actual` + `degradeReason`.
 *                 `auto` considers only local providers.
 *
 * `auto`'s EGRESS SELF-CHECK (B.1.1): `isSrtAvailable` only sees srt's binary, not whether
 * its in-netns relay carries traffic. On WSL mirrored networking the mux logs "bridges
 * ready" yet every sandboxed request returns curl 000 (verified on real WSL2) — a silent
 * total-egress blackout. So `auto` probes srt's bridge ({@link probeSrtEgress}) against a
 * REAL `probeUrl` the caller derived from config and degrades to the floor when it is dead.
 * When NO `probeUrl` is derivable at all, `auto` also floors (FIX 6): an enforced
 * zero-egress boundary would starve the harness of its own model endpoint, so that is a
 * degrade to name, not a silent srt selection.
 *
 * The config default is `auto` (see the CLI schema) — honest precisely BECAUSE of this
 * self-check: `auto` never silently claims an OS boundary whose egress is broken.
 */
import { createE2bSandbox, type E2bSandboxOptions } from "./e2b.js";
import { createProcessFloorSandbox } from "./process-floor.js";
import {
	createSrtSandbox,
	isSrtAvailable,
	probeSrtEgress,
	type SrtEgressRunner,
	type SrtSandboxOptions,
} from "./srt.js";
import type { Sandbox } from "./types.js";
import { detectWsl } from "./wsl.js";

/** The sandbox modes selectable via config/CLI. Shared by the CLI schema + `--sandbox`. */
export const SANDBOX_MODES = ["auto", "process", "srt", "e2b"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export interface ResolveSandboxOptions
	extends SrtSandboxOptions,
		E2bSandboxOptions {
	/**
	 * A REAL, full URL for `auto`'s egress self-check (B.1.1) to curl through a throwaway
	 * srt boundary — chosen by the caller from its configured endpoints (telemetry/logs/api
	 * URLs). Distinct from `allowedDomains` (which arms the LIVE boundary's egress
	 * allowlist): this one url is what the PROBE actually hits. Absent ⇒ `auto` floors (FIX
	 * 6): an enforced zero-egress boundary would starve the harness.
	 */
	probeUrl?: string;
	/**
	 * TEST SEAM (ADR-0020 egress self-check): the srt-egress runner threaded into
	 * {@link probeSrtEgress} for `auto`'s health probe. Production omits it (the real
	 * srt+curl runner is used); hermetic tests inject a fake so no srt is spawned.
	 */
	egressRunner?: SrtEgressRunner;
	/**
	 * TEST SEAM: `auto`'s WSL check ({@link detectWsl}). Production omits it; hermetic
	 * tests inject a stub so selection is host-independent.
	 */
	wslDetector?: () => Promise<boolean>;
}

/** A resolved sandbox plus the honest requested-vs-actual pair (ADR-0017). */
export interface SandboxSelection {
	/** The live boundary to spawn the harness into. */
	sandbox: Sandbox;
	/** What the caller asked for. */
	requested: SandboxMode;
	/** What was actually obtained — the provider id (`"srt"` | `"process-floor"`). */
	actual: string;
	/**
	 * Why `auto` fell short of the enforced provider it hoped for, when it did — srt's
	 * binary absent, no egress allowlist derivable, or its egress bridge dead (B.1.1).
	 * Present ONLY on a degrade, so a caller surfaces the honest reason instead of a silent
	 * downgrade (ADR-0017).
	 */
	degradeReason?: string;
	/**
	 * True when the degrade is the EXPECTED outcome for this host (WSL: srt's bridge is
	 * unreliable in both networking modes) rather than a surprise — callers log it calmly
	 * (info, once) instead of warning on every run. Honesty stays: `actual` +
	 * `degradeReason` are still populated.
	 */
	degradeExpected?: boolean;
}

/** Build a floor selection carrying the honest reason `auto` degraded. */
function floorSelection(
	requested: SandboxMode,
	degradeReason: string,
): SandboxSelection {
	const sandbox = createProcessFloorSandbox();
	return { sandbox, requested, actual: sandbox.id, degradeReason };
}

/**
 * Resolve `mode` into a live {@link Sandbox} + honest selection metadata. Throws for an
 * explicit `srt`/`e2b` request whose provider is unavailable; `auto` degrades to the floor
 * instead (and never reaches for `e2b`). ASYNC because `auto` runs an egress self-check
 * (B.1.1) — a real srt+curl probe — before trusting srt for an egress-needing run.
 */
export async function resolveSandbox(
	mode: SandboxMode,
	options: ResolveSandboxOptions = {},
): Promise<SandboxSelection> {
	switch (mode) {
		case "process": {
			const sandbox = createProcessFloorSandbox();
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "srt": {
			// Explicit request for enforcement — a validated opt-in, so NO probe: construct
			// or throw loudly. The user asked for srt; second-guessing it here would be
			// wrong (that honest degrade is `auto`'s job, not an explicit request's).
			const sandbox = createSrtSandbox(options);
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "e2b": {
			// Explicit request for the cloud boundary — surface the failure, never degrade.
			const sandbox = createE2bSandbox(options);
			return { sandbox, requested: mode, actual: sandbox.id };
		}
		case "auto": {
			// Binary absent ⇒ floor. isSrtAvailable only sees the binary, so this is the
			// cheap gate before the (spawn-y) egress probe.
			if (!isSrtAvailable()) {
				return floorSelection(mode, "srt unavailable");
			}
			// No probeUrl derivable (FIX 6): an enforced zero-egress boundary would starve the
			// harness of its own model endpoint, so this is a degrade to name — NOT a silent srt
			// selection. Explicit `srt` (below) still keeps zero-egress when the user forces it.
			if (options.probeUrl === undefined) {
				return floorSelection(
					mode,
					"no egress allowlist derivable from config — an enforced zero-egress boundary " +
						"would starve the harness (its own model endpoint included); set telemetry " +
						"endpoints or force --sandbox srt",
				);
			}
			// WSL ⇒ floor WITHOUT spending the (spawn-y) probe, as an EXPECTED degrade:
			// srt's bridge is unreliable under WSL in both networking modes (see wsl.ts),
			// so probing every run spends a spawn and a per-run warning on a foregone
			// conclusion. Explicit `--sandbox srt` (above) remains the opt-in for WSL
			// setups where the bridge works.
			if (await (options.wslDetector ?? detectWsl)()) {
				return {
					...floorSelection(
						mode,
						"WSL detected — srt's egress bridge is unreliable under WSL, so auto uses " +
							"the process floor without probing; force --sandbox srt to override",
					),
					degradeExpected: true,
				};
			}
			// srt is only trustworthy if its bridge actually carries traffic on THIS host (WSL
			// mirrored networking silently blackholes it, B.1.1): probe the REAL probeUrl.
			const healthy = await probeSrtEgress(
				options.probeUrl,
				options.egressRunner ? { runner: options.egressRunner } : {},
			);
			if (healthy) {
				const sandbox = createSrtSandbox(options);
				return { sandbox, requested: mode, actual: sandbox.id };
			}
			return floorSelection(
				mode,
				"srt egress bridge unhealthy — WSL mirrored networking? Using the process floor",
			);
		}
	}
}
