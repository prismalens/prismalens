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
	reopens,
} from "@prismalens/agent-host/registry";
import {
	type AgentFacts,
	agents,
	type CatalogueSource,
	type CheckedModes,
	type AccessLevel as DescribedLevel,
	installCommand,
	type Lines,
	modeNamed,
	noModeLines,
	offers,
} from "@prismalens/providers";
import CATALOGUE_SOURCES from "./catalogue-sources.json" with { type: "json" };
import { modelProvider, providerName } from "./model-makers.js";

export {
	ACCESS_LEVELS,
	type AccessLevel,
	type AgentFact,
	type AgentFacts,
	DEFAULT_ACCESS_LEVEL,
	type FactCheck,
	type FactVersions,
	factMismatches,
	GATEWAY_RUN_FILE,
	isSafeGatewayUrl,
	levelOfAgentMode,
	type ModeMechanism,
	mergeConfigPatch,
	PROBED_FACTS,
	reopens,
	reservedEnvNames,
	runsInSandbox,
	type SubagentStopFacts,
	staleFacts,
} from "@prismalens/agent-host/registry";

export {
	type CatalogueSource,
	type CheckedModes,
	type InstallChannel,
	installCommand,
} from "@prismalens/providers";

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
	/** A new run asked for an agent turned off in Settings (#1171). */
	"agent-off",
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

/** One permission level on one agent: the package's facts, and the line under the level. */
export interface HarnessAccess extends LevelFacts {
	/** The row line under the level: what this agent runs, by its own mode name when the check listed one. */
	line: (checked: CheckedModes) => string;
}

const DEEPAGENTS_CHANNEL = {
	uv: ["deepagents-code", "deepagents-acp"],
} as const;

/** What PrismaLens alone says and pins about an agent (#916): its descriptor's facts and lettered mark. */
type ProductFacts = Omit<AgentFacts, "lines"> & {
	/** A lettered tile, only where the agent has no published logo (#1101). */
	mark?: AgentMarkFact;
};

/** Two letters for an agent with no published logo; one with a logo has its art in `assets/brands.ts`. */
export type AgentMarkFact = { letters: string };

export interface HarnessDescriptor extends AgentDescriptor, ProductFacts {
	/** Each permission level on this agent, with its line (#673 w21 ruling 2026-10-10). */
	access: Record<AccessLevel, HarnessAccess>;
}

/** Agents not yet moved to a descriptor in @prismalens/providers. */
const PRODUCT: Partial<Record<HarnessId, ProductFacts & { lines: Lines }>> = {
	opencode: {
		// Retention depends on the provider and model behind it, so nothing is known (#1024).
		cacheTtlMinutes: null,
		// A 15% reserve below the window by default (compaction.ts, #1101).
		autoCompactPercent: 85,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["opencode", "opencode-v2"],
		// Its own published logo in both themes: opencode.ai/brand (assets/brands.ts).
		usageReports: [],
		settingsFile: "~/.config/opencode/opencode.json",
		noLevelReason: "OpenCode has per-tool rules, not one permission level.",
		ownSettingsNote: () =>
			"Your opencode.json rules stay; PrismaLens sets each tool's catch-all for the level.",
		// opencode.ai/docs/permissions: object rules merge, so the user's own patterns stay (#673 w21).
		permissionRulesNote:
			"A run sets each tool's default rule to match its permission level. Your other rules in opencode.json stay as they are.",
		// npm only: the curl installer ships releases npm and the pin have not reached (#1013).
		install: "npm i -g opencode-ai",
		channel: { npm: "opencode-ai" },
		// OpenCode 2's docs install it as `npm install -g @opencode/cli`.
		nextChannel: { npm: "@opencode/cli" },
		// @opencode/cli 2.3.2 answers `additionalDirectories`; opencode-ai 1.19.x does not.
		nextFacts: { directories: true },
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
		// The pin-bump PR moved this on 2026-11-21: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "1.19.6", date: "2026-11-21" },
		loginHint: "`opencode auth login`, or a provider key in env",
		signInArgs: ["auth", "login"],
		providerAuth: { args: ["auth", "list"], keyless: ["opencode"] },
		loginEnvKeys: ["XDG_DATA_HOME", "OPENCODE_DB"],
	},
	codex: {
		// codex-acp 2.5.0 advertises `compact`, taking no input; retention depends on the model and request (#1024).
		cacheTtlMinutes: null,
		// 90% of the window unless the model sets less (openai_models.rs, #1101).
		autoCompactPercent: 90,
		compactsWhenIdle: false,
		compactCommand: "compact",
		// codex-acp maps `compact` to Op::Compact, which takes no input.
		compactTakesFocus: false,
		// No harnessToolSearch: the agent defers MCP tools itself on its own API, which the scripted model cannot measure (#848).
		acpRegistryIds: ["codex-acp"],
		// Its own published mark in its owner's colours: lobehub/lobe-icons (assets/brands.ts).
		vendor: "openai",
		usageReports: ["cache"],
		settingsFile: "~/.codex/config.toml",
		ownSettingsNote: (c) =>
			c?.modes && !offers(c, "workspace-write")
				? "This codex-acp runs Ask always and Auto-accept edits in the same mode, Ask for approval; edits inside the copy need no ask."
				: null,
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
		// The pin-bump PR moved this on 2026-11-23: zero-token probe and aimock CI, no real-model run yet (#914).
		tested: { version: "2.8.0", date: "2026-11-23", companion: "0.171.0" },
		loginHint: "`codex login`, or `OPENAI_API_KEY` in env",
		signInArgs: ["login"],
		loginEnvKeys: ["CODEX_HOME"],
	},
	gemini: {
		// Gemini's implicit caching states no TTL (#1024).
		cacheTtlMinutes: null,
		// `model.compressionThreshold` defaults to 0.5 (chatCompressionService.ts, #1101).
		autoCompactPercent: 50,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["gemini"],
		// Its own published mark in its owner's colours: lobehub/lobe-icons (assets/brands.ts).
		vendor: "google",
		usageReports: [],
		settingsFile: "~/.gemini/settings.json",
		ownSettingsNote: () =>
			"Gemini CLI's own folder trust and settings apply, as in your terminal.",
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
		signInArgs: [],
		loginEnvKeys: ["GEMINI_CLI_HOME"],
		// No trust command is quoted: Gemini's own one is unconfirmed (#848 §11 Q4).
		toolsHint: {
			text: "If you use Gemini's folder trust, trust the runs folder to give it PrismaLens's tools",
		},
	},
	deepagents: {
		// No source states a cache lifetime or a compact command.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		// Measured on the scripted-model matrix: about half the tool tokens per run, same pass rate (#848).
		harnessToolSearch: true,
		acpRegistryIds: ["deepagents"],
		// Its own published tile: langchain-ai/deepagents .github/images (assets/brands.ts).
		picksOwnModel: true,
		install: installCommand(DEEPAGENTS_CHANNEL),
		channel: DEEPAGENTS_CHANNEL,
		lines: noModeLines("deepagents"),
		// 3 of 3 on Ollama gemma4:31b-cloud; dcode reports no version in initialize, so this is the installed package (#634).
		tested: { version: "0.1.75", date: "2026-09-23" },
		loginHint: "`ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in env",
	},
	local: {
		// An agent PrismaLens knows nothing about.
		cacheTtlMinutes: null,
		autoCompactPercent: null,
		compactsWhenIdle: false,
		compactCommand: null,
		compactTakesFocus: false,
		commandSetByUser: true,
		// An agent of the user's own has no owner's logo, so it takes letters.
		mark: { letters: "LA" },
		install: "Add it under Settings → Agents → Add agent → Local ACP command.",
		lines: noModeLines("Local agent"),
		loginHint: "It signs in on its own.",
	},
};

// A descriptor names agent-host's levels without importing it; this fails to compile if they part.
const LEVELS_MATCH: [AccessLevel, DescribedLevel] extends [
	DescribedLevel,
	AccessLevel,
]
	? true
	: never = true;
void LEVELS_MATCH;

const DESCRIBED = new Map(agents().map((a) => [a.launch, a]));

/** An agent's facts from its descriptor, else the table above; a launch row with neither fails at load. */
function productOf(id: HarnessId): ProductFacts & { lines: Lines } {
	const a = DESCRIBED.get(id);
	if (a)
		return { ...a.facts, ...("letters" in a.mark ? { mark: a.mark } : {}) };
	const p = PRODUCT[id];
	if (!p)
		throw new Error(`agent ${id} has no descriptor in @prismalens/providers`);
	return p;
}

/**
 * The providers a multi-provider agent's model id names first ("opencode/…", "deepseek/…"):
 * the name a model lists under, and its account pages where one is known.
 */
export const HARNESS_REGISTRY: Record<HarnessId, HarnessDescriptor> =
	Object.fromEntries(
		HARNESS_IDS.map((id) => {
			const { lines, ...facts } = productOf(id);
			const row = AGENT_REGISTRY[id];
			const access = Object.fromEntries(
				ACCESS_LEVELS.map((l) => [l, { ...row.levels[l], line: lines[l] }]),
			) as Record<AccessLevel, HarnessAccess>;
			const catalogue = (
				CATALOGUE_SOURCES as Partial<Record<HarnessId, CatalogueSource>>
			)[id];
			return [
				id,
				{ ...row, ...facts, ...(catalogue ? { catalogue } : {}), access },
			];
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
	if (reopens(row)) return null;
	return `${row.label} can't reopen a finished session, so a new run starts from the report.`;
}

/** A provider's name and its models.dev id compare equal: `Ollama Cloud` and `ollama-cloud`. */
export function providerKey(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Can `harness` run `modelId` as far as its provider login goes? `unchecked` is a multi-provider
 * agent whose logins no check has read: never reported as ready. `na` is an agent with no such check.
 */
export function providerSignIn(
	harness: HarnessId,
	checked: { providers?: readonly string[] | null } | null | undefined,
	modelId: string | null | undefined,
): "signed-in" | "signed-out" | "unchecked" | "na" {
	const gate = HARNESS_REGISTRY[harness].providerAuth;
	if (!gate) return "na";
	const provider = modelId ? modelProvider(modelId) : null;
	// A model not known is a login not known: never ready.
	if (!provider) return "unchecked";
	if (gate.keyless.includes(provider)) return "signed-in";
	if (!checked?.providers) return "unchecked";
	// The list may print the provider's display name, which need not resemble its id: Vertex for google-vertex.
	const keys = [provider, providerName(provider)].flatMap((n) =>
		n ? [providerKey(n)] : [],
	);
	return checked.providers.some((p) => keys.includes(providerKey(p)))
		? "signed-in"
		: "signed-out";
}

/**
 * The model a run takes when none is starred: the agent's own when its provider is signed in,
 * else the first listed one whose provider is. The agent's own when none is, or its logins were not read.
 */
export function preferredModel(
	harness: HarnessId,
	checked:
		| { providers?: readonly string[] | null; servedModel?: string | null }
		| null
		| undefined,
	entries: readonly { id: string }[],
): string | null {
	const own = checked?.servedModel ?? null;
	if (!HARNESS_REGISTRY[harness].providerAuth || !checked?.providers)
		return own;
	if (own && providerSignIn(harness, checked, own) === "signed-in") return own;
	const signedIn = entries.find(
		(e) => providerSignIn(harness, checked, e.id) === "signed-in",
	);
	return signedIn?.id ?? own;
}

/** A model whose provider the agent holds no login for, in the words the box, the picker and the Timeline share. */
export function providerSignedOutLine(
	harness: HarnessId,
	modelId: string | null | undefined,
): string {
	const provider = modelId ? modelProvider(modelId) : null;
	const named =
		(provider && providerName(provider)) || provider || "its provider";
	return `${HARNESS_REGISTRY[harness].label} is not signed in to ${named}. Sign in with its own CLI, then retry.`;
}
