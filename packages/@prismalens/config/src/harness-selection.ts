// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9): the harness is the first registry row on
 * PATH, in HARNESS_AUTO_ORDER, unless PRISMALENS_HARNESS pins one. Nothing
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
	harnessEnvModel,
} from "./providers/harness.js";
import { isWindowsMountPath, isWsl } from "./utils/wsl.js";

// Re-exported so the union stays importable from the module that produces it,
// even though it is now declared beside the registry.
export type { HarnessSelectionFailure };

export function isOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
): boolean {
	return resolveOnPath(bin, pathEnv) !== null;
}

export interface PathScanOptions {
	/** Read for WSL detection; process.env when absent. */
	env?: NodeJS.ProcessEnv;
	/** Whether a candidate is executable; an X_OK access check when absent. */
	isExecutable?: (path: string) => boolean;
}

function executable(path: string): boolean {
	try {
		accessSync(path, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function scanPath(
	bin: string,
	pathEnv: string,
	options: PathScanOptions,
): { resolved: string | null; windowsOnly: string | null } {
	const exts =
		process.platform === "win32"
			? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
			: [""];
	const wsl = isWsl(options.env ?? process.env);
	const isExecutable = options.isExecutable ?? executable;
	let windowsOnly: string | null = null;
	for (const dir of pathEnv.split(delimiter)) {
		if (dir.length === 0) continue;
		for (const ext of exts) {
			const candidate = join(dir, bin + ext);
			if (!isExecutable(candidate)) continue;
			// A Windows shim on WSL's PATH starts but never answers ACP (#673 w8).
			if (wsl && isWindowsMountPath(candidate)) {
				windowsOnly ??= candidate;
				continue;
			}
			return { resolved: candidate, windowsOnly: null };
		}
	}
	return { resolved: null, windowsOnly };
}

/** The first executable `bin` on PATH, or null. The doctor prints it so a bare sudo or service PATH shows. */
export function resolveOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
	options: PathScanOptions = {},
): string | null {
	return scanPath(bin, pathEnv, options).resolved;
}

/** Under WSL, the Windows install of `bin` that `resolveOnPath` skipped, when nothing else resolved. */
export function windowsInstallOnPath(
	bin: string,
	pathEnv = process.env.PATH ?? "",
	options: PathScanOptions = {},
): string | null {
	return scanPath(bin, pathEnv, options).windowsOnly;
}

/** Who pinned the harness: the env var, or the persisted Settings → Agent choice. */
export type PinSource = "env" | "settings";

export type HarnessSelection =
	| {
			runnable: true;
			harness: HarnessId;
			auto: boolean;
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
	/** The Windows install WSL skipped; `windowsInstallOnPath`, or none when `isOnPath` is injected. */
	windowsInstall?: (bin: string) => string | null;
	/** The host env a run inherits its model from; process.env when absent. */
	env?: Record<string, string | undefined>;
}

function pinLabel(source: PinSource, id: string): string {
	return source === "settings"
		? `Harness pinned to "${id}" under Settings → Agent`
		: `PRISMALENS_HARNESS="${id}"`;
}

export interface HarnessStatus {
	id: HarnessId;
	label: string;
	binary: string;
	installed: boolean;
	/** The version a compatibility run passed on; null when none has run. */
	tested: { version: string; date: string } | null;
	install: string;
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: string | null;
	/** The agent's own mode a run asks for when Settings names none (#673 w21). */
	defaultMode: string;
	/** How the Model setting reaches this harness; `unsupported` means it is ignored. */
	modelVia: "acp" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/** The model the host env names for this harness (e.g. ANTHROPIC_MODEL); a run with no model set uses it. */
	envModel: { key: string; model: string } | null;
	/** Under WSL, a Windows install on PATH that cannot run here; null otherwise. */
	windowsOnlyPath: string | null;
}

export function listHarnessStatus(
	input: HarnessSelectionInput = {},
): HarnessStatus[] {
	const check = input.isOnPath ?? isOnPath;
	const windowsInstall =
		input.windowsInstall ??
		(input.isOnPath ? () => null : (bin: string) => windowsInstallOnPath(bin));
	return HARNESS_IDS.map((id) => {
		const d = HARNESS_REGISTRY[id];
		const installed = check(d.binary);
		return {
			id,
			label: d.label,
			binary: d.binary,
			installed,
			windowsOnlyPath: installed ? null : windowsInstall(d.binary),
			tested: d.tested ?? null,
			install: d.install,
			defaultModel: d.defaultModel ?? null,
			defaultMode: d.defaultMode,
			modelVia: d.modelVia,
			loginHint: d.loginHint,
			envModel: harnessEnvModel(id, input.env ?? process.env),
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
			pinnedBy: source,
		};
	}
	for (const id of HARNESS_AUTO_ORDER) {
		if (check(HARNESS_REGISTRY[id].binary)) {
			return { runnable: true, harness: id, auto: true };
		}
	}
	return {
		runnable: false,
		failure: "no-harness",
		reason: `No coding agent on this machine. Install one: ${installHints()}.`,
	};
}
