// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The agent and model choice without the picker's UI, for rows and lists that only name them.
import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import {
	type AxisSource,
	effectiveAccess,
	type HarnessSetting,
	type HarnessStatus,
} from "@prismalens/contracts";
import { agentFacts } from "@/lib/agent-facts";
import { useHarnesses, useHarnessSettings } from "@/lib/api/hooks";
import { failureLine, notSignedIn } from "@/lib/failure-words";
import { isAgentDefault, isFoldedId, providerOf } from "./model-list";

/** What the current setting resolves to, for the picker and for Settings. */
export function useAgentChoice() {
	const harnessesQuery = useHarnesses();
	const settingsQuery = useHarnessSettings();
	const harnesses = harnessesQuery.data?.harnesses ?? [];
	const selection = harnessesQuery.data?.selection;
	const setting: HarnessSetting = settingsQuery.data?.harness ?? "auto";
	const effectiveId = setting === "auto" ? selection?.harness : setting;
	const effective = harnesses.find((h) => h.id === effectiveId);
	return {
		harnesses,
		selection,
		setting,
		effective,
		model:
			(effective && settingsQuery.data?.models?.[effective.id as HarnessId]) ??
			"",
		models: settingsQuery.data?.models ?? {},
		efforts: settingsQuery.data?.efforts ?? {},
		axes: {
			accessLevels: settingsQuery.data?.accessLevels ?? {},
		},
		customModels: settingsQuery.data?.customModels ?? {},
		hiddenModels: settingsQuery.data?.hiddenModels ?? {},
		modelOrder: settingsQuery.data?.modelOrder ?? {},
		isLoading: harnessesQuery.isLoading || settingsQuery.isLoading,
		isError: harnessesQuery.isError,
	};
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
function withoutProvider(name: string, provider: string): string {
	const prefix = `${provider}/`;
	return name.toLowerCase().startsWith(prefix.toLowerCase())
		? name.slice(prefix.length).trim() || name
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
		withoutProvider(m.name ?? m.id, providerOf(harness?.id ?? "", m.id));
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
	const current = agentCurrentModel(h);
	if (current) return current;
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

/** Why an installed agent cannot take a run, in the gate's words; null when it can. */
export function unreadyReason(h: HarnessStatus): string | null {
	if (!h.installed || !h.checked || h.checked.outcome === "answers-acp")
		return null;
	// The same words a run that fails on sign-in shows (#831 w7-3).
	if (h.checked.outcome === "sign-in-needed")
		return failureLine(notSignedIn(h.label));
	return `${h.label}: ${h.checked.detail}`;
}

/** The run gate's line: the reason, then where to check it, one full stop each (#673 w9-1). */
export function unreadyLine(h: HarnessStatus): string | null {
	const why = unreadyReason(h)?.replace(/[.\s]+$/, "");
	return why ? `${why}. Check it in Settings, Agent.` : null;
}

export function modelState(h: HarnessStatus): "list" | "pending" | "own" {
	if (h.modelVia === "unsupported")
		return agentFacts(h.id)?.picksOwnModel ? "own" : "pending";
	return h.checked || h.models.entries.length > 0 ? "list" : "pending";
}

/** A provider's mark where an agent mark is the same company's. */
export const PROVIDER_MARK: Record<string, string> = {
	Anthropic: "claude-code",
	Google: "gemini",
	"OpenCode Zen": "opencode",
};
