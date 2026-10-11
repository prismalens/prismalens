// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9): the harness is the first installed registry
 * row, in HARNESS_AUTO_ORDER, unless PRISMALENS_HARNESS pins one. Installed
 * means the agent itself is on PATH; PrismaLens never ships the agent, only
 * the ACP adapter some agents need (#818).
 */
import { accessSync, constants as fsConstants } from "node:fs";
import { delimiter, join } from "node:path";
import { shippedAdapter } from "@prismalens/agent-adapters";
import {
	HARNESS_AUTO_ORDER,
	HARNESS_IDS,
	HARNESS_REGISTRY,
	type HarnessDescriptor,
	type HarnessId,
	type HarnessSelectionFailure,
	harnessEnvModel,
} from "./providers/harness.js";
import { isWindowsMountPath, isWsl } from "./utils/wsl.js";

// Re-exported so the union stays importable from the module that produces it,
// even though it is now declared beside the registry.
export type { HarnessSelectionFailure };
export { shippedAdapter };

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

/** What to spawn for a row, and whether it is the adapter PrismaLens ships. */
export interface HarnessLaunch {
	command: string;
	/** Goes before the row's `acpArgs`. */
	args: string[];
	env: Record<string, string>;
	shipped: boolean;
}

export interface LaunchProbe {
	isOnPath?: (bin: string) => boolean;
	/** The shipped adapter's script; none when `isOnPath` is injected, as for `windowsInstall`. */
	shippedAdapter?: (pkg: string) => string | null;
}

/**
 * How a row starts (#818): its binary on PATH, the user's own install, wins;
 * else the adapter PrismaLens ships, once its companion (the agent) is on PATH.
 * Null: not installed.
 */
export function harnessLaunch(
	d: Pick<HarnessDescriptor, "binary" | "companionBinary" | "adapterPackage">,
	probe: LaunchProbe = {},
): HarnessLaunch | null {
	const onPath = probe.isOnPath ?? isOnPath;
	if (onPath(d.binary))
		return { command: d.binary, args: [], env: {}, shipped: false };
	if (!d.adapterPackage || !d.companionBinary || !onPath(d.companionBinary))
		return null;
	const shipped =
		probe.shippedAdapter ?? (probe.isOnPath ? () => null : shippedAdapter);
	const script = shipped(d.adapterPackage);
	if (!script) return null;
	return {
		command: process.execPath,
		args: [script],
		// The desktop's backend is Electron-as-Node; its child must be too.
		env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
		shipped: true,
	};
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
	shippedAdapter?: (pkg: string) => string | null;
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
	tested: { version: string; date: string; companion?: string } | null;
	install: string;
	/** The model prismalens asks for when the operator set none; null means the harness's own default. */
	defaultModel: string | null;
	/** How the Model setting reaches this harness; `unsupported` means it is ignored. */
	modelVia: "acp" | "unsupported";
	/** One line the picker and the doctor show: how to sign this harness in. */
	loginHint: string;
	/** The model the host env names for this harness (e.g. ANTHROPIC_MODEL); a run with no model set uses it. */
	envModel: { key: string; model: string } | null;
	/** Under WSL, a Windows install on PATH that cannot run here; null otherwise. */
	windowsOnlyPath: string | null;
}

function probeOf(input: HarnessSelectionInput): LaunchProbe {
	return {
		...(input.isOnPath ? { isOnPath: input.isOnPath } : {}),
		...(input.shippedAdapter ? { shippedAdapter: input.shippedAdapter } : {}),
	};
}

export function listHarnessStatus(
	input: HarnessSelectionInput = {},
): HarnessStatus[] {
	const windowsInstall =
		input.windowsInstall ??
		(input.isOnPath ? () => null : (bin: string) => windowsInstallOnPath(bin));
	return HARNESS_IDS.map((id) => {
		const d = HARNESS_REGISTRY[id];
		const installed = !!harnessLaunch(d, probeOf(input));
		return {
			id,
			label: d.label,
			binary: d.binary,
			installed,
			windowsOnlyPath: installed
				? null
				: (windowsInstall(d.binary) ??
					(d.companionBinary ? windowsInstall(d.companionBinary) : null)),
			tested: d.tested ?? null,
			install: d.install,
			defaultModel: d.defaultModel ?? null,
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
	const present = (id: HarnessId) =>
		!!harnessLaunch(HARNESS_REGISTRY[id], probeOf(input));
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
		if (!present(id)) {
			return {
				runnable: false,
				failure: "pinned-harness-missing",
				reason: `${pinLabel(source, id)} but ${d.label} is not installed. Install: ${d.install}`,
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
		if (present(id)) {
			return { runnable: true, harness: id, auto: true };
		}
	}
	return {
		runnable: false,
		failure: "no-harness",
		reason: `No coding agent on this machine. Install one: ${installHints()}.`,
	};
}
