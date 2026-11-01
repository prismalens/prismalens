// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Harness registry: every harness speaks ACP over stdio (ADR 0003). The launch facts
 * (binary, args, env, levels, provider keys) are `@prismalens/agent-host`'s; this file
 * keeps what stays in PrismaLens (#916): copy, `tested` pins, model resolution and hints.
 */
import {
	ACCESS_LEVELS,
	type AccessLevel,
	AGENT_IDS,
	AGENT_REGISTRY,
	type AgentDescriptor,
	type AgentId,
	type AgentRunEnv,
	type LevelFacts,
} from "@prismalens/agent-host/registry";

export {
	ACCESS_LEVELS,
	type AccessLevel,
	DEFAULT_ACCESS_LEVEL,
	GATEWAY_RUN_FILE,
	isSafeGatewayUrl,
	levelOfAgentMode,
	type ModeMechanism,
	mergeConfigPatch,
	reservedEnvNames,
	runsInSandbox,
} from "@prismalens/agent-host/registry";

export const HARNESS_IDS = AGENT_IDS;
export type HarnessId = AgentId;
export type HarnessRunEnv = AgentRunEnv;

/**
 * Every way `resolveHarnessSelection` can refuse, and the only ones the API can
 * put in a PRECONDITION_FAILED payload. This is the single source of truth:
 * `HarnessSelectionFailure` and the contract's `HarnessSelectionFailureSchema`
 * are both derived from it, so the two cannot drift apart again. It lives here,
 * beside the registry, because this module is pure data — the selection logic
 * imports `node:fs`, and the contracts package is bundled for the browser.
 */
export const HARNESS_SELECTION_FAILURES = [
	/** PRISMALENS_HARNESS names something that is not a registry id. */
	"invalid-env-harness",
	/** A pin (env or persisted) names a real harness whose binary is absent. */
	"pinned-harness-missing",
	/** No registry harness is on PATH. */
	"no-harness",
	/** A model is set for a harness that has no way to take one (#639 rec 4). */
	"model-unsupported",
	/** A run asked for another agent than the one PRISMALENS_HARNESS pins (#673 w52). */
	"env-pinned-other",
] as const;
export type HarnessSelectionFailure =
	(typeof HARNESS_SELECTION_FAILURES)[number];

export type PermissionFidelity = "enforced" | "cooperative" | "advisory";

/** Does the agent's own OS sandbox hold a mode on this machine: shown by a local probe, absent, or not shown (#673 w51). */
export const SANDBOX_STATES = ["enforced", "none", "unknown"] as const;
export type SandboxState = (typeof SANDBOX_STATES)[number];
export interface SandboxCheck {
	state: SandboxState;
	/** One line: what the check saw, or why it could not tell. */
	reason: string;
}

/** The sandbox check's key for an agent that offers no modes; never sent to an agent. */
export const NO_MODE_KEY = "agent-default";

/** What the last readiness check offered, as much of it as a row line reads. */
export type CheckedModes = {
	modes: readonly { id: string; name: string }[] | null;
} | null;

/** One permission level on one agent: the package's facts, and the line under the level. */
export interface HarnessAccess extends LevelFacts {
	/** The row line under the level: what this agent runs, by its own mode name when the check listed one. */
	line: (checked: CheckedModes) => string;
}

/** A package registry an install hint names: npm, or uv's PyPI with the first package the CLI. */
export type InstallChannel =
	| { npm: string }
	| { uv: readonly [string, ...string[]] };

/** The command an install hint gives for `channel`. */
export function installCommand(channel: InstallChannel): string {
	if ("npm" in channel) return `npm i -g ${channel.npm}`;
	const [cli, ...extras] = channel.uv;
	return ["uv tool install -U", cli, ...extras.map((p) => `--with ${p}`)].join(
		" ",
	);
}

/** What PrismaLens alone says and pins about an agent (#916). */
interface ProductFacts {
	/** One line the readiness check shows when the binary is missing; it names `channel`'s command. */
	install: string;
	/** Where `install` gets the agent's CLI from; the nightly probe installs from here (#1013). */
	channel?: InstallChannel;
	/** The vendor's next major, on its own package; the nightly probes its latest too (#1013). */
	nextChannel?: InstallChannel;
	/** One line the picker and the readiness check show: how to sign this harness in. */
	loginHint: string;
	/**
	 * The model prismalens asks for when the operator set none: the id the
	 * row's compatibility run passed on. Absent means the harness's own default,
	 * which nobody tested (#337 run e: OpenCode's default ignored the report
	 * schema twice). Recorded per run with its source in `RunFidelity`.
	 */
	defaultModel?: string;
	/** The version a compatibility run passed on (ADR 0003 §10), or absent: never run. Written by hand from `scripts/acp-admission.ts` output; CI re-runs the OpenCode row on every push with a pinned model. */
	tested?: { version: string; date: string; companion?: string };
	/** Its entries in the bundled ACP registry, so Add agent never lists it twice (#911). */
	acpRegistryIds?: readonly string[];
	/** What the run view says when PrismaLens's tools did not reach this agent (#848). */
	toolsHint?: { text: string };
}

export interface HarnessDescriptor extends AgentDescriptor, ProductFacts {
	/** Each permission level on this agent, with its line (#673 w21 ruling 2026-10-10). */
	access: Record<AccessLevel, HarnessAccess>;
}

/** A mode by the agent's own name in the last check, else `fallback`. */
function modeNamed(
	checked: CheckedModes,
	id: string,
	fallback: string,
): string {
	return checked?.modes?.find((m) => m.id === id)?.name ?? fallback;
}

function offers(checked: CheckedModes, id: string): boolean {
	return !!checked?.modes?.some((m) => m.id === id);
}

type Lines = Record<AccessLevel, HarnessAccess["line"]>;

function noModeLines(label: string): Lines {
	const line = () =>
		`${label} has no modes; PrismaLens answers its asks by this level.`;
	return {
		supervised: line,
		"auto-edits": line,
		auto: line,
		"full-access": line,
	};
}

const PRODUCT: Record<HarnessId, ProductFacts & { lines: Lines }> = {
	opencode: {
		acpRegistryIds: ["opencode", "opencode-v2"],
		// npm only: the curl installer ships releases npm and the pin have not reached (#1013).
		install: "npm i -g opencode-ai",
		channel: { npm: "opencode-ai" },
		// OpenCode 2's docs install it as `npm install -g @opencode/cli`.
		nextChannel: { npm: "@opencode/cli" },
		lines: {
			supervised: () =>
				"OpenCode runs its build agent; each tool's catch-all asks.",
			"auto-edits": () =>
				"OpenCode runs its build agent; edits are allowed and other tools ask.",
			auto: () =>
				"OpenCode has no reviewer of its own; its build agent keeps the Ask always rules.",
			"full-access": () =>
				"OpenCode runs its build agent with each tool's catch-all allowed; your own deny rules stay.",
		},
		// The pin-bump PR moved this on 2026-10-31: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "1.19.5", date: "2026-10-31" },
		loginHint: "`opencode auth login`, or a provider key in env",
	},
	"claude-code": {
		acpRegistryIds: ["claude-acp"],
		install:
			"curl -fsSL https://claude.ai/install.sh | bash  (or: npm i -g @anthropic-ai/claude-code; then `claude /login`, or set ANTHROPIC_API_KEY)",
		channel: { npm: "@anthropic-ai/claude-code" },
		// claude-agent-acp 0.81.1 reports `acceptEdits` when the model has no `auto`, and
		// leaves `bypassPermissions` unoffered when the user's settings turn it off (#673 w21).
		lines: {
			supervised: (c) =>
				`Claude Code runs in ${modeNamed(c, "default", "Manual")}.`,
			"auto-edits": (c) =>
				`Claude Code runs in ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			auto: (c) =>
				`Claude Code runs in ${modeNamed(c, "auto", "Auto")}; with a model that has no Auto it runs ${modeNamed(c, "acceptEdits", "Accept Edits")}.`,
			"full-access": (c) => {
				const bypass = modeNamed(c, "bypassPermissions", "Bypass Permissions");
				const edits = modeNamed(c, "acceptEdits", "Accept Edits");
				return c?.modes && !offers(c, "bypassPermissions")
					? `Claude Code runs in ${edits}: your settings turn ${bypass} off.`
					: `Claude Code runs in ${bypass}, or ${edits} where your settings turn it off.`;
			},
		},
		// The pin-bump PR moved this on 2026-10-31: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "0.98.0", date: "2026-10-31", companion: "2.1.312" },
		loginHint: "`claude /login`, or `ANTHROPIC_API_KEY` in env",
	},
	codex: {
		acpRegistryIds: ["codex-acp"],
		install:
			"npm i -g @openai/codex  (then `codex login`, or set OPENAI_API_KEY)",
		channel: { npm: "@openai/codex" },
		lines: {
			supervised: (c) =>
				`Codex runs in ${modeNamed(c, "read-only", "Ask for approval")}.`,
			"auto-edits": (c) => {
				const ask = modeNamed(c, "read-only", "Ask for approval");
				if (offers(c, "workspace-write"))
					return `Codex runs in ${modeNamed(c, "workspace-write", "Workspace write")}.`;
				return c?.modes
					? `Codex runs in ${ask}, the same mode as Ask always on this version.`
					: `Codex runs in Workspace write, or ${ask} on a version without it.`;
			},
			auto: (c) =>
				`Codex runs in ${modeNamed(c, "agent", "Approve for me")}, its own reviewer.`,
			"full-access": (c) =>
				`Codex runs in ${modeNamed(c, "agent-full-access", "Full access")}, outside its sandbox.`,
		},
		// Real-model runs were on codex 0.163.0: scripts/acp-admission.ts 3 of 3, gpt-6-luna (#846), and #848 live runs. Must equal @prismalens/agent-adapters' pin.
		// The pin-bump PR moved this on 2026-10-31: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "2.3.0", date: "2026-10-31", companion: "0.165.0" },
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
	},
	gemini: {
		acpRegistryIds: ["gemini"],
		install: "npm i -g @google/gemini-cli",
		channel: { npm: "@google/gemini-cli" },
		lines: {
			supervised: (c) =>
				`Gemini CLI runs in ${modeNamed(c, "default", "Default")}.`,
			"auto-edits": (c) =>
				`Gemini CLI runs in ${modeNamed(c, "autoEdit", "Auto Edit")}.`,
			auto: (c) =>
				`Gemini CLI has no reviewer of its own; it runs in ${modeNamed(c, "default", "Default")}, as Ask always does.`,
			"full-access": (c) =>
				`Gemini CLI runs in ${modeNamed(c, "yolo", "YOLO")}.`,
		},
		loginHint: "`gemini` sign-in, or `GEMINI_API_KEY` in env",
		// No trust command is quoted: Gemini's own one is unconfirmed (#848 §11 Q4).
		toolsHint: {
			text: "If you use Gemini's folder trust, trust the runs folder to give it PrismaLens's tools",
		},
	},
	deepagents: {
		acpRegistryIds: ["deepagents"],
		install: "uv tool install -U deepagents-code --with deepagents-acp",
		channel: { uv: ["deepagents-code", "deepagents-acp"] },
		lines: noModeLines("deepagents"),
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
	},
	local: {
		install: "Add it under Settings → Agent → Add agent → Local ACP command.",
		lines: noModeLines("Local agent"),
		loginHint: "It signs in on its own.",
	},
};

export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> =
	Object.fromEntries(
		HARNESS_IDS.map((id) => {
			const { lines, ...facts } = PRODUCT[id];
			const row = AGENT_REGISTRY[id];
			const access = Object.fromEntries(
				ACCESS_LEVELS.map((l) => [l, { ...row.levels[l], line: lines[l] }]),
			) as Record<AccessLevel, HarnessAccess>;
			return [id, { ...row, ...facts, access }];
		}),
	) as Record<HarnessId, HarnessDescriptor>;

/** Where a run's model id came from; recorded in `RunFidelity` (#337 run e, G11). */
export const MODEL_SOURCES = [
	"operator",
	"product-default",
	"harness-default",
	"env",
] as const;
export type ModelSource = (typeof MODEL_SOURCES)[number];

export interface ResolvedModel {
	/** The id passed to the harness; undefined leaves the harness to its own default. */
	model?: string;
	source: ModelSource;
}

/** The model the host env names for this harness, when it reads one. */
export function harnessEnvModel(
	harnessId: HarnessId,
	env: Record<string, string | undefined>,
): { key: string; model: string } | null {
	const key = HARNESS_REGISTRY[harnessId]?.envModelKey;
	const model = key ? env[key]?.trim() : undefined;
	return key && model ? { key, model } : null;
}

/** Operator setting first, then the host env's model, then the row's tested default, then the harness's own. */
export function resolveHarnessModel(
	harnessId: HarnessId,
	operatorModel?: string,
	env: Record<string, string | undefined> = {},
): ResolvedModel {
	const operator = operatorModel?.trim();
	if (operator) return { model: operator, source: "operator" };
	const fromEnv = harnessEnvModel(harnessId, env);
	if (fromEnv) return { model: fromEnv.model, source: "env" };
	const row = HARNESS_REGISTRY[harnessId]?.defaultModel;
	if (row) return { model: row, source: "product-default" };
	return { source: "harness-default" };
}

/** Auto-selection order: the first one on PATH runs unless one is pinned. */
export const HARNESS_AUTO_ORDER: readonly HarnessId[] = [
	"opencode",
	"claude-code",
	"codex",
	"gemini",
	"deepagents",
	"local",
];

export const HARNESS_BINARY: Record<HarnessId, string> = Object.fromEntries(
	HARNESS_IDS.map((id) => [id, HARNESS_REGISTRY[id].binary]),
) as Record<HarnessId, string>;

/** A permission level on one agent (#673 w21 ruling 2026-10-10). */
export function resolveAccess(
	harnessId: HarnessId,
	level: AccessLevel,
): HarnessAccess {
	return HARNESS_REGISTRY[harnessId].access[level];
}

/** `enforced` only where a local check saw the agent's sandbox hold the run's mode; every other mode is the agent's word. */
export function modeFidelity(
	sandbox: SandboxCheck | undefined,
): PermissionFidelity {
	return sandbox?.state === "enforced" ? "enforced" : "cooperative";
}

/**
 * Why a run on `harnessId` must not start with `model` set, or null. A run
 * refuses what the row lacks rather than dropping it and running anyway
 * (ADR 0003 item 5, #639 rec 4).
 */
export function refuseModel(
	harnessId: HarnessId,
	model: string | undefined,
): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.modelVia !== "unsupported" || !model?.trim()) return null;
	return `${row.label} picks its own model. Unstar ${model.trim()} in the picker above.`;
}

/** Why a finished run on `harnessId` cannot be continued, or null when it can (#747). */
export function resumeBlockedReason(harnessId: HarnessId): string | null {
	const row = HARNESS_REGISTRY[harnessId];
	if (row.resume) return null;
	return `${row.label} can't reopen a finished session, so a new run starts from the report.`;
}
