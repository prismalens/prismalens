// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9): the harness is whatever verified registry row
 * is on PATH, in HARNESS_AUTO_ORDER, unless PRISMALENS_HARNESS pins one. Nothing
 * on PATH is a refusal with the install hints, never a bundled fallback.
 */
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";
import {
	HARNESS_AUTO_ORDER,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessId,
	type HarnessSelectionFailure,
} from "./providers/harness.js";

// Re-exported so the union stays importable from the module that produces it,
// even though it is now declared beside the registry.
export type { HarnessSelectionFailure };

export function isOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
): boolean {
	return resolveOnPath(bin, pathEnv) !== null;
}

/** The first executable `bin` on PATH, or null. The doctor prints it so a bare sudo or service PATH shows. */
export function resolveOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
): string | null {
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			const candidate = join(dir, bin + ext);
			try {
				accessSync(candidate, fsConstants.X_OK);
				return candidate;
			} catch {
				// not here; keep scanning
			}
		}
	}
	return null;
}

/** Who pinned the harness: the env var, or the persisted Settings → Harness choice. */
export type PinSource = "env" | "settings";

export type HarnessSelection =
	| {
			runnable: true;
			harness: HarnessId;
			auto: boolean;
			verified: boolean;
			pinnedBy?: PinSource;
	  }
	| {
			runnable: false;
			failure: HarnessSelectionFailure;
			reason: string;
			harness?: HarnessId;
			pinnedBy?: PinSource;
	  };

export interface HarnessSelectionInput {
	/** The pinned harness id: PRISMALENS_HARNESS, or the persisted setting. */
	envHarness?: string;
	/** Which of the two pinned it; the refusal names that one (#337 run e, G15). */
	pinSource?: PinSource;
	isOnPath?: (bin: string) => boolean;
}

function pinLabel(source: PinSource, id: string): string {
	return source === "settings"
		? `Harness pinned to "${id}" under Settings → Harness`
		: `PRISMALENS_HARNESS="${id}"`;
}

export interface HarnessStatus {
	id: HarnessId;
	label: string;
	binary: string;
	installed: boolean;
	verified: boolean;
	install: string;
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: string | null;
}

export function listHarnessStatus(
	input: HarnessSelectionInput = {},
): HarnessStatus[] {
	const check = input.isOnPath ?? isOnPath;
	return HARNESS_IDS.map((id) => {
		const d = HARNESS_REGISTRY[id];
		return {
			id,
			label: d.label,
			binary: d.binary,
			installed: check(d.binary),
			verified: d.verified,
			install: d.install,
			defaultModel: d.defaultModel ?? null,
		};
	});
}

/** Every auto-order row's install line, for the doctor's ERROR and the app's tooltip. */
export function installHints(): string {
	return HARNESS_AUTO_ORDER.map(
		(id) => `${HARNESS_REGISTRY[id].label}: ${HARNESS_REGISTRY[id].install}`,
	).join("; ");
}

export function resolveHarnessSelection(
	input: HarnessSelectionInput = {},
): HarnessSelection {
	const check = input.isOnPath ?? isOnPath;
	const pin = input.envHarness?.trim();
	if (pin) {
		const source = input.pinSource ?? "env";
		if (!HARNESS_IDS.includes(pin as HarnessId)) {
			return {
				runnable: false,
				failure: "invalid-env-harness",
				reason: `${pinLabel(source, pin)} is not a known harness (${HARNESS_IDS.join(", ")})`,
				pinnedBy: source,
			};
		}
		const id = pin as HarnessId;
		const d = HARNESS_REGISTRY[id];
		if (!check(d.binary)) {
			return {
				runnable: false,
				failure: "pinned-harness-missing",
				reason: `${pinLabel(source, id)} but ${d.binary} is not on PATH. Install: ${d.install}`,
				harness: id,
				pinnedBy: source,
			};
		}
		return {
			runnable: true,
			harness: id,
			auto: false,
			verified: d.verified,
			pinnedBy: source,
		};
	}
	for (const id of HARNESS_AUTO_ORDER) {
		const d = HARNESS_REGISTRY[id];
		if (d.verified && check(d.binary)) {
			return { runnable: true, harness: id, auto: true, verified: true };
		}
	}
	const unverifiedPresent = HARNESS_AUTO_ORDER.filter(
		(id) =>
			!HARNESS_REGISTRY[id].verified && check(HARNESS_REGISTRY[id].binary),
	);
	const pinHint =
		unverifiedPresent.length > 0
			? ` ${unverifiedPresent.map((id) => HARNESS_REGISTRY[id].binary).join(", ")} found but not yet verified; pin one with PRISMALENS_HARNESS=<id> to use it anyway.`
			: "";
	return {
		runnable: false,
		failure: "no-harness",
		reason: `No coding agent found on PATH. Install one: ${installHints()}.${pinHint}`,
	};
}
