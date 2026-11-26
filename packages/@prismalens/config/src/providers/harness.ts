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
	type Lines,
} from "@prismalens/providers/agents";
import CATALOGUE_SOURCES from "./catalogue-sources.json" with { type: "json" };
import { modelProvider, providerName } from "./model-makers.js";

export {
	ACCESS_LEVELS,
	type AccessLevel,
	type AgentFact,
	type AgentFacts,
	type AuthenticateMethod,
	authenticateMethod,
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
	type ConfigLayout,
	type InstallChannel,
	installCommand,
	type LayoutKey,
	type LayoutPath,
} from "@prismalens/providers/agents";

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

// A descriptor names agent-host's levels without importing it; this fails to compile if they part.
const LEVELS_MATCH: [AccessLevel, DescribedLevel] extends [
	DescribedLevel,
	AccessLevel,
]
	? true
	: never = true;
void LEVELS_MATCH;

const DESCRIBED = new Map(agents().map((a) => [a.launch, a]));

/** An agent's facts from its descriptor; a launch row with none fails at load. */
function productOf(id: HarnessId): ProductFacts & { lines: Lines } {
	const a = DESCRIBED.get(id);
	if (!a)
		throw new Error(`agent ${id} has no descriptor in @prismalens/providers`);
	return { ...a.facts, ...("letters" in a.mark ? { mark: a.mark } : {}) };
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
export const HARNESS_AUTO_ORDER: readonly HarnessId[] = HARNESS_IDS;

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
