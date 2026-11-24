// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The agent and model choice without the picker's UI, for rows and lists that only name them.
import {
	type AccessLevel,
	type HarnessId,
	modelProvider,
	preferredModel,
	providerName,
	providerSignedOutLine,
	providerSignIn,
} from "@prismalens/config/harness";
import {
	type AxisSource,
	effectiveAccess,
	type HarnessSetting,
	type HarnessStatus,
} from "@prismalens/contracts";
import { useMemo } from "react";
import { agentFacts } from "@/lib/agent-facts";
import { useHarnesses, useHarnessSettings } from "@/lib/api/hooks";
import { failureLine, notSignedIn } from "@/lib/failure-words";
import { isAgentDefault, isFoldedId } from "./model-list";

/** What the current setting resolves to, for the picker and for Settings. */
export function useAgentChoice() {
	const harnessesQuery = useHarnesses();
	const settingsQuery = useHarnessSettings();
	const hData = harnessesQuery.data;
	const sData = settingsQuery.data;
	const isLoading = harnessesQuery.isLoading || settingsQuery.isLoading;
	const isError = harnessesQuery.isError;
	// One object per data change, so the pickers that read it can memoise (#1101 cat 1.8).
	return useMemo(() => {
		const harnesses = hData?.harnesses ?? [];
		const selection = hData?.selection;
		const setting: HarnessSetting = sData?.harness ?? "auto";
		const effectiveId = setting === "auto" ? selection?.harness : setting;
		const effective = harnesses.find((h) => h.id === effectiveId);
		return {
			harnesses,
			selection,
			setting,
			effective,
			model: (effective && sData?.models?.[effective.id as HarnessId]) ?? "",
			models: sData?.models ?? {},
			efforts: sData?.efforts ?? {},
			axes: {
				accessLevels: sData?.accessLevels ?? {},
			},
			customModels: sData?.customModels ?? {},
			hiddenModels: sData?.hiddenModels ?? {},
			modelOrder: sData?.modelOrder ?? {},
			isLoading: isLoading,
			isError: isError,
		};
	}, [hData, sData, isLoading, isError]);
}

type Axes = ReturnType<typeof useAgentChoice>["axes"];

/** The level a run on `agent` takes when the box names none, and where it came from (#673 w21). */
export function defaultAccessOf(
	agent: HarnessStatus | undefined,
	axes: Axes,
	autoStart = false,
): { level: { level: AccessLevel; from: AxisSource } } {
	if (!agent) return { level: { level: "supervised", from: "prismalens" } };
	const id = agent.id as HarnessId;
	return {
		level: effectiveAccess(axes, id, agent.localDefault?.permission, autoStart),
	};
}

/** `OpenCode Zen/Muse Spark 1.3 Free` is `Muse Spark 1.3 Free` under its provider's heading. */
function withoutProvider(name: string, id: string): string {
	const slash = name.indexOf("/");
	const provider = modelProvider(id);
	const known = provider ? (providerName(provider) ?? provider) : null;
	return known &&
		slash > 0 &&
		name.toLowerCase().startsWith(known.toLowerCase())
		? name.slice(slash + 1).trim() || name
		: name;
}

/** `Sonnet 4.5` and `sonnet-4-5` compare equal; `Nova 13` and `Nova 1.3` do not (#805). */
const comparable = (s: string) =>
	s
		.toLowerCase()
		.replace(/(\d)[.\-_ ](?=\d)/g, "$1.")
		.replace(/[^a-z0-9.]/g, "");

/**
 * A model by the name the agent's own list gives it, less the provider
 * prefix, else the id as is. A served model the agent names its own way
 * (`Muse Spark 1.3 (free)`) takes the list's name too: one name everywhere (#673 f7).
 */
export function modelName(
	harness: HarnessStatus | undefined,
	id: string | null | undefined,
): string | null {
	if (!id || isFoldedId(harness, id)) return null;
	const entries = (harness?.models.entries ?? []).filter(
		(m) => !isAgentDefault(m),
	);
	const named = (m: { id: string; name?: string | null }) =>
		withoutProvider(m.name ?? m.id, m.id);
	const exact = entries.find((m) => m.id === id);
	if (exact) return named(exact);
	const key = comparable(id);
	const alike = entries.filter(
		(m) => comparable(named(m)) === key || comparable(m.name ?? "") === key,
	);
	// Two models that read alike leave the id as the one unambiguous name.
	return alike.length === 1 && alike[0] ? named(alike[0]) : id;
}

export interface NamedModel {
	/** Null when the agent named a model its list doesn't hold. */
	id: string | null;
	name: string;
}

/**
 * The model the agent runs when a run sends none: what the env or its check
 * reports, a `default` entry resolved through its description, as Claude
 * Code's "Default (recommended)" names the model behind it (#907).
 */
export function agentCurrentModel(h: HarnessStatus): NamedModel | null {
	const raw = h.envModel?.model || h.checked?.servedModel || null;
	if (!raw) return null;
	if (!isFoldedId(h, raw)) return { id: raw, name: modelName(h, raw) ?? raw };
	const said = h.models.entries.find((e) => e.id === raw)?.description;
	const name = said ? modelName(h, said) : null;
	if (!name) return null;
	const listed = h.models.entries.find(
		(e) => !isAgentDefault(e) && modelName(h, e.id) === name,
	);
	return { id: listed?.id ?? null, name };
}

/**
 * PrismaLens's model for `h` by its real name, never the word Default: the
 * starred one, else what the agent runs, else its list's first (#907).
 */
export function defaultModel(
	h: HarnessStatus,
	starred: string | null | undefined,
): NamedModel | null {
	if (starred && !isFoldedId(h, starred))
		return { id: starred, name: modelName(h, starred) ?? starred };
	const own = agentCurrentModel(h);
	// The server's pick for a run with none starred: a signed-in provider's model over the agent's own.
	const preferred = preferredModel(
		h.id as HarnessId,
		{ ...h.checked, servedModel: own?.id ?? null },
		h.models.entries.filter((e) => !isAgentDefault(e)),
	);
	if (preferred && preferred !== own?.id)
		return { id: preferred, name: modelName(h, preferred) ?? preferred };
	if (own) return own;
	const first = h.models.entries.find((e) => !isAgentDefault(e));
	return first
		? { id: first.id, name: modelName(h, first.id) ?? first.id }
		: null;
}

/** The agent and model the next run starts with, each named once. */
export function agentModelLabel(
	effective: HarnessStatus | undefined,
	model: string,
): { agent: string; model: string } {
	if (!effective) return { agent: "Pick an agent", model: "" };
	if (effective.modelVia === "unsupported") {
		return { agent: effective.label, model: "its default model" };
	}
	return {
		agent: effective.label,
		model: defaultModel(effective, model)?.name ?? "its default model",
	};
}

/** The chip's words for a model: always a model's real name (#673 w7, #907). */
export function chipModel(h: HarnessStatus | undefined, model: string): string {
	if (!h) return "Pick an agent";
	if (h.modelVia === "unsupported") return h.label;
	return defaultModel(h, model)?.name ?? h.label;
}

/** What a chip last read, so a cold load names the model at once (#1101 category 6). */
const CHIP_KEY = "pl.modelChip";
type ChipMemo = { last?: { agent: string; name: string } } & Record<
	string,
	unknown
>;

function readChipMemo(): ChipMemo {
	try {
		return JSON.parse(localStorage.getItem(CHIP_KEY) ?? "{}") as ChipMemo;
	} catch {
		return {};
	}
}

/** `asLast`: a box with no thread of its own, whose chip names the default. */
export function rememberChip(
	agent: string,
	model: string,
	name: string,
	asLast: boolean,
) {
	const memo = readChipMemo();
	const key = `${agent}::${model}`;
	const last = asLast ? { agent, name } : memo.last;
	if (memo[key] === name && memo.last?.name === last?.name) return;
	try {
		localStorage.setItem(
			CHIP_KEY,
			JSON.stringify({ ...memo, [key]: name, ...(last ? { last } : {}) }),
		);
	} catch {}
}

/**
 * The chip's words before the agent list loads: a thread's recorded agent and
 * model by the name last shown, else the record itself; else the last chip.
 */
export function knownChip(
	known: { agent: string; model?: string | null } | null | undefined,
): { agent: string; name: string } | null {
	const memo = readChipMemo();
	if (known?.agent) {
		const named = memo[`${known.agent}::${known.model ?? ""}`];
		if (typeof named === "string") return { agent: known.agent, name: named };
		const label = agentFacts(known.agent)?.label ?? known.agent;
		return { agent: known.agent, name: known.model || label };
	}
	return memo.last ?? null;
}

/**
 * A model name that fits the phone footer: no "(free)"-style suffix, and past
 * 14 characters no leading family word ("DeepSeek V4.1 Flash" is "V4.1 Flash").
 */
export function shortModel(name: string): string {
	const bare = name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name;
	const words = bare.split(/\s+/);
	return bare.length > 14 && words.length >= 3
		? words.slice(1).join(" ")
		: bare;
}

/**
 * The agent's provider login for `model` (the agent's own pick when none is named): the server's
 * word for its chosen model, or the same check run against another one.
 */
export function providerState(
	h: HarnessStatus,
	model?: string | null,
): NonNullable<HarnessStatus["providerSignIn"]> {
	return model
		? providerSignIn(h.id as HarnessId, h.checked, model)
		: (h.providerSignIn ??
				providerSignIn(
					h.id as HarnessId,
					h.checked,
					defaultModel(h, null)?.id,
				));
}

/** Why an installed agent cannot take a run, in the gate's words; null when it can. */
export function unreadyReason(
	h: HarnessStatus,
	model?: string | null,
): string | null {
	if (!h.installed || !h.checked) return null;
	if (h.checked.outcome === "answers-acp")
		return providerState(h, model) === "signed-out"
			? providerSignedOutLine(h.id as HarnessId, model || h.checked.servedModel)
			: null;
	// The same words a run that fails on sign-in shows (#831 w7-3).
	if (h.checked.outcome === "sign-in-needed")
		return failureLine(notSignedIn(h.label, h.loginHint));
	return `${h.label}: ${h.checked.detail}`;
}

/** The run gate's line: the reason, then where to check it, one full stop each (#673 w9-1). */
export function unreadyLine(
	h: HarnessStatus,
	model?: string | null,
): string | null {
	const why = unreadyReason(h, model)?.replace(/[.\s]+$/, "");
	return why ? `${why}. Check it in Settings, Agent.` : null;
}

export function modelState(h: HarnessStatus): "list" | "pending" | "own" {
	if (h.modelVia === "unsupported")
		return agentFacts(h.id)?.picksOwnModel ? "own" : "pending";
	return h.checked || h.models.entries.length > 0 ? "list" : "pending";
}
