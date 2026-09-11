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
} from "./providers/harness.js";

export function isOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
): boolean {
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			try {
				accessSync(join(dir, bin + ext), fsConstants.X_OK);
				return true;
			} catch {
				// not here; keep scanning
			}
		}
	}
	return false;
}

export type HarnessSelectionFailure =
	| "invalid-env-harness"
	| "pinned-harness-missing"
	| "no-harness";

export type HarnessSelection =
	| { runnable: true; harness: HarnessId; auto: boolean; verified: boolean }
	| {
			runnable: false;
			failure: HarnessSelectionFailure;
			reason: string;
			harness?: HarnessId;
	  };

export interface HarnessSelectionInput {
	/** PRISMALENS_HARNESS; the only override. */
	envHarness?: string;
	isOnPath?: (bin: string) => boolean;
}

export interface HarnessStatus {
	id: HarnessId;
	label: string;
	binary: string;
	installed: boolean;
	verified: boolean;
	install: string;
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
		};
	});
}

function installHints(): string {
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
		if (!HARNESS_IDS.includes(pin as HarnessId)) {
			return {
				runnable: false,
				failure: "invalid-env-harness",
				reason: `PRISMALENS_HARNESS="${pin}" is not a known harness (${HARNESS_IDS.join(", ")})`,
			};
		}
		const id = pin as HarnessId;
		const d = HARNESS_REGISTRY[id];
		if (!check(d.binary)) {
			return {
				runnable: false,
				failure: "pinned-harness-missing",
				reason: `PRISMALENS_HARNESS="${id}" but ${d.binary} is not on PATH. Install: ${d.install}`,
				harness: id,
			};
		}
		return { runnable: true, harness: id, auto: false, verified: d.verified };
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
