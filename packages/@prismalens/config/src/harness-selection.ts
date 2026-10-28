// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Detect and report (ADR 0003 §9): the harness is the first installed registry
 * row, in HARNESS_AUTO_ORDER, unless PRISMALENS_HARNESS pins one. Installed
 * means the agent itself is on PATH; PrismaLens never ships the agent, only
 * the ACP adapter some agents need (#818).
 */
import { accessSync, constants as fsConstants, statSync } from "node:fs";
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

/** The first executable `bin` on PATH, or null; Settings shows it, so a bare sudo or service PATH shows. */
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

/** A regular file this process may execute; on WSL, never a Windows install (#673 w8). */
export function isExecutableFile(
	path: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	try {
		if (!statSync(path).isFile()) return false;
	} catch {
		return false;
	}
	if (isWsl(env) && isWindowsMountPath(path)) return false;
	return process.platform === "win32" || executable(path);
}

export interface LaunchProbe {
	isOnPath?: (bin: string) => boolean;
	/** The shipped adapter's script; none when `isOnPath` is injected, as for `windowsInstall`. */
	shippedAdapter?: (pkg: string) => string | null;
	/** Settings → Agent → Binary path: the agent's own program; for `local`, its command (#907). */
	binaryPath?: string;
	/** `local` only: the arguments its command takes. */
	launchArgs?: string[];
	/** Whether `binaryPath` can run; `isExecutableFile` when absent. */
	isExecutable?: (path: string) => boolean;
}

/**
 * How a row starts (#818): its binary on PATH, the user's own install, wins;
 * else the adapter PrismaLens ships, once its companion (the agent) is on PATH.
 * A set binary path replaces the PATH lookup of the agent itself (#907).
 * Null: not installed.
 */
export function harnessLaunch(
	d: Pick<HarnessDescriptor, "binary" | "companionBinary" | "adapterPackage">,
	probe: LaunchProbe = {},
): HarnessLaunch | null {
	const onPath = probe.isOnPath ?? isOnPath;
	const shipped =
		probe.shippedAdapter ?? (probe.isOnPath ? () => null : shippedAdapter);
	if (probe.binaryPath) {
		const canRun = probe.isExecutable ?? ((p: string) => isExecutableFile(p));
		if (!canRun(probe.binaryPath)) return null;
		if (!d.companionBinary)
			return {
				command: probe.binaryPath,
				args: probe.launchArgs ?? [],
				env: {},
				shipped: false,
			};
		// The path is the agent's CLI; the adapter that drives it is ours, else one on PATH.
		const script = d.adapterPackage ? shipped(d.adapterPackage) : null;
		if (script) return shippedLaunch(script);
		if (d.binary && onPath(d.binary))
			return { command: d.binary, args: [], env: {}, shipped: false };
		return null;
	}
	if (!d.binary) return null;
	if (onPath(d.binary))
		return { command: d.binary, args: [], env: {}, shipped: false };
	if (!d.adapterPackage || !d.companionBinary || !onPath(d.companionBinary))
		return null;
	const script = shipped(d.adapterPackage);
	return script ? shippedLaunch(script) : null;
}

function shippedLaunch(script: string): HarnessLaunch {
	return {
		command: process.execPath,
		args: [script],
		// The desktop's backend is Electron-as-Node; its child must be too.
		env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
		shipped: true,
	};
}

/** The `local` agent's command and arguments, from Settings (#907). */
export interface LocalAgent {
	command: string;
	args: string[];
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
	/** Settings → Agent → Binary path, per agent (#907). */
	binaryPaths?: Partial<Record<HarnessId, string>>;
	/** The `local` agent's command, when one is set up. */
	localAgent?: LocalAgent | null;
	/** Auto skips an agent this answers false for: its remembered check failed (#907). */
	isRunnable?: (id: HarnessId) => boolean;
	/** Whether a binary path can run; `isExecutableFile` when absent. */
	isExecutable?: (path: string) => boolean;
	/** One agent's env for `envModel`, with its Settings rows; `env` when absent. */
	envFor?: (id: HarnessId) => Record<string, string | undefined>;
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
	/** One line the picker and the Settings check show: how to sign this harness in. */
	loginHint: string;
	/** The model the host env names for this harness (e.g. ANTHROPIC_MODEL); a run with no model set uses it. */
	envModel: { key: string; model: string } | null;
	/** Under WSL, a Windows install on PATH that cannot run here; null otherwise. */
	windowsOnlyPath: string | null;
	/** The program a binary path names: the agent's own CLI, not its adapter; empty for `local`. */
	cliBinary: string;
	/** The agent's config-folder env var and what unset means; null when it has none. */
	configDir: { envKey: string; shownDefault: string } | null;
	/** Provider key names the agent reads from its env. */
	providerKeys: string[];
	/** What the run view says when PrismaLens's tools did not reach this agent. */
	toolsHint?: { text: string };
}

/** The launch probe for one agent, with its binary path or local command (#907). */
export function launchProbeOf(
	input: HarnessSelectionInput,
	id: HarnessId,
): LaunchProbe {
	const local = id === "local" ? input.localAgent : null;
	const binaryPath = local ? local.command : input.binaryPaths?.[id];
	return {
		...(input.isOnPath ? { isOnPath: input.isOnPath } : {}),
		...(input.shippedAdapter ? { shippedAdapter: input.shippedAdapter } : {}),
		...(input.isExecutable ? { isExecutable: input.isExecutable } : {}),
		...(binaryPath ? { binaryPath } : {}),
		...(local ? { launchArgs: local.args } : {}),
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
		const installed = !!harnessLaunch(d, launchProbeOf(input, id));
		return {
			id,
			label: d.label,
			binary: d.binary,
			installed,
			windowsOnlyPath:
				installed || !d.binary
					? null
					: (windowsInstall(d.binary) ??
						(d.companionBinary ? windowsInstall(d.companionBinary) : null)),
			cliBinary: d.companionBinary ?? d.binary,
			configDir: d.configDir ?? null,
			providerKeys: [...(d.providerKeys ?? [])],
			tested: d.tested ?? null,
			install: d.install,
			defaultModel: d.defaultModel ?? null,
			modelVia: d.modelVia,
			loginHint: d.loginHint,
			envModel: harnessEnvModel(
				id,
				input.envFor?.(id) ?? input.env ?? process.env,
			),
			...(d.toolsHint ? { toolsHint: d.toolsHint } : {}),
		};
	});
}

/** Every auto-order row's install line, for the no-agent selection reason. */
function installHints(): string {
	// The local agent has nothing to install; Settings → Agent sets it up.
	return HARNESS_AUTO_ORDER.filter((id) => id !== "local")
		.map(
			(id) => `${HARNESS_REGISTRY[id].label}: ${HARNESS_REGISTRY[id].install}`,
		)
		.join("; ");
}

export function resolveHarnessSelection(
	input: HarnessSelectionInput = {},
): HarnessSelection {
	const present = (id: HarnessId) =>
		!!harnessLaunch(HARNESS_REGISTRY[id], launchProbeOf(input, id));
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
	const runnable = input.isRunnable ?? (() => true);
	for (const id of HARNESS_AUTO_ORDER) {
		if (present(id) && runnable(id)) {
			return { runnable: true, harness: id, auto: true };
		}
	}
	return {
		runnable: false,
		failure: "no-harness",
		reason: `No coding agent on this machine. Install one: ${installHints()}.`,
	};
}
