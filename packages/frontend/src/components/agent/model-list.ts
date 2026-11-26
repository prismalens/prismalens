// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One model list for the picker and Settings → Agent (#907): the agent's own
 * `default` pseudo-entry is left out, as every model shows by its real name,
 * and the operator's hidden models, order and star apply.
 */
import {
	type HarnessId,
	type ModelMaker,
	modelMaker,
	modelProvider,
	providerName,
} from "@prismalens/config/harness";
import {
	type CustomModel,
	customModelsOf,
	type FavouriteModel,
	type HarnessStatus,
	MODEL_LABELS,
	type ModelLabel,
} from "@prismalens/contracts";
import { MARKS } from "@/components/kit/marks";
import { agentFacts } from "@/lib/agent-facts";

/** The agent's own "default" entry; it names no model of its own, so no row shows it. */
export function isAgentDefault(e: {
	id: string;
	name?: string | null;
}): boolean {
	return e.id.toLowerCase() === "default" || /^default\b/i.test(e.name ?? "");
}

/** Whether `id` is the agent's folded default entry, by its id or its listed name. */
export function isFoldedId(h: HarnessStatus | undefined, id: string): boolean {
	if (!id) return false;
	const listed = h?.models.entries.find((e) => e.id === id);
	return isAgentDefault(listed ?? { id });
}

/** Each agent's starred model: the one a run on it uses when none is picked (#907). */
export function starredOf(
	harnesses: HarnessStatus[],
	models: Partial<Record<HarnessId, string>>,
): FavouriteModel[] {
	return harnesses.flatMap((h) => {
		const model = models[h.id as HarnessId];
		return model && !isFoldedId(h, model)
			? [{ harness: h.id as HarnessId, model }]
			: [];
	});
}

/** The provider a model id routes through, by its registry name: its `provider/` prefix, else the agent's vendor. */
export function providerOf(harnessId: string, modelId: string): string {
	const id = modelProvider(modelId) ?? agentFacts(harnessId)?.vendor;
	return id ? (providerName(id) ?? id) : "Models";
}

/** Who makes a model: the agent's entry for it, else its vendor or routing provider (#1101). */
export function makerOf(
	h: HarnessStatus | undefined,
	modelId: string,
): ModelMaker | null {
	const listed = h?.models.entries.find((e) => e.id === modelId)?.maker;
	const id =
		listed ?? agentFacts(h?.id)?.vendor ?? modelProvider(modelId) ?? null;
	return id ? modelMaker(id) : null;
}

export interface ModelPrefs {
	/** Bare ids, or models with the name and labels the person gave them. */
	custom?: readonly (string | CustomModel)[];
	order?: string[];
	hidden?: string[];
}

export interface ListedModel {
	id: string;
	custom: boolean;
	hidden: boolean;
}

/** Custom ids the agent doesn't list, then its entries (folded default removed); re-sorted by `order` when set, unknown ids after in base order. */
export function agentModels(h: HarnessStatus, s: ModelPrefs): ListedModel[] {
	const entries = h.models.entries.filter((e) => !isAgentDefault(e));
	const listed = new Set(h.models.entries.map((e) => e.id));
	const custom = Array.from(
		new Set(customModelsOf(s.custom).map((m) => m.id)),
	).filter((id) => !listed.has(id) && !isAgentDefault({ id }));
	const hidden = new Set(s.hidden ?? []);
	const base: ListedModel[] = [
		...custom.map((id) => ({ id, custom: true, hidden: hidden.has(id) })),
		...entries.map((e) => ({
			id: e.id,
			custom: false,
			hidden: hidden.has(e.id),
		})),
	];
	if (!s.order?.length) return base;
	const rank = new Map(s.order.map((id, i) => [id, i]));
	const at = (m: ListedModel) => rank.get(m.id) ?? Number.POSITIVE_INFINITY;
	return base
		.map((m, i) => ({ m, i }))
		.sort((a, b) => at(a.m) - at(b.m) || a.i - b.i)
		.map(({ m }) => m);
}

/** The picker's rows: hidden ones left out (except `chosen`), starred first; with no `order` the provider grouping is kept. */
export function pickerModels(
	h: HarnessStatus,
	s: ModelPrefs & { favourites: FavouriteModel[]; chosen: string },
): string[] {
	const shown = agentModels(h, s).filter((m) => !m.hidden || m.id === s.chosen);
	const starred = (id: string) =>
		s.favourites.some((f) => f.harness === h.id && f.model === id);
	const group = (m: ListedModel) =>
		m.custom ? "\u0000custom" : providerOf(h.id, m.id);
	const groups = Array.from(new Set(shown.map(group)));
	return shown
		.map((m, i) => ({ m, i }))
		.sort(
			(a, b) =>
				Number(starred(b.m.id)) - Number(starred(a.m.id)) ||
				(s.order?.length
					? 0
					: groups.indexOf(group(a.m)) - groups.indexOf(group(b.m))) ||
				a.i - b.i,
		)
		.map(({ m }) => m.id);
}

/** `ids` with `id` moved one place up (-1) or down (1); unchanged at the ends. */
export function move(ids: string[], id: string, by: -1 | 1): string[] {
	const from = ids.indexOf(id);
	const to = from + by;
	if (from === -1 || to < 0 || to >= ids.length) return ids;
	const out = [...ids];
	out.splice(from, 1);
	out.splice(to, 0, id);
	return out;
}

/** The rows whose name, id or provider holds every word of `q`, ignoring case (#1180). */
export function filterModels<
	T extends { id: string; name: string; provider: string },
>(list: readonly T[], q: string): T[] {
	const words = q.toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return [...list];
	return list.filter((m) => {
		const text = `${m.name} ${m.id} ${m.provider}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
}

/** Whether the person marked this model a favourite: a list of their own, apart from the default star. */
export function isFavourite(
	favourites: readonly FavouriteModel[],
	harness: string,
	model: string,
): boolean {
	return favourites.some((f) => f.harness === harness && f.model === model);
}

/** `favourites` with this model added, or removed when it was there; the order is kept. */
export function toggleFavourite(
	favourites: readonly FavouriteModel[],
	harness: HarnessId,
	model: string,
): FavouriteModel[] {
	return isFavourite(favourites, harness, model)
		? favourites.filter((f) => !(f.harness === harness && f.model === model))
		: [...favourites, { harness, model }];
}

/** A label and the words it shows; Claude Code's large window shows its own size. */
export interface ShownLabel {
	label: ModelLabel;
	word: string;
}

const LABEL_WORDS: Record<ModelLabel, string> = MARKS.modelCapability.words;

/**
 * A model's labels from evidence only (#1180): a custom model's own, the agent's large-window
 * alias on its id, and Fast where the agent's own options listed a Fast mode for it. Nothing
 * is read from a missing effort selector.
 */
export function modelLabels(
	agentId: string,
	modelId: string,
	evidence: { custom?: CustomModel; fastModel?: string | null } = {},
): ShownLabel[] {
	const { custom, fastModel } = evidence;
	const window = agentFacts(agentId)?.modelWindow;
	const labels = new Set<ModelLabel>(custom?.labels ?? []);
	const large = !!window && modelId.endsWith(window.alias);
	if (large) labels.add("large-context");
	if (fastModel && fastModel === modelId) labels.add("fast");
	return MODEL_LABELS.filter((l) => labels.has(l)).map((label) => ({
		label,
		word:
			label === "large-context" && large && window
				? `${window.large} context`
				: LABEL_WORDS[label],
	}));
}

/** `ids` with this agent's favourites first, each in its own order; the picker groups them (#1180). */
export function favouritesFirst(
	ids: readonly string[],
	favourites: readonly FavouriteModel[],
	harness: string,
): { id: string; favourite: boolean }[] {
	const rows = ids.map((id) => ({
		id,
		favourite: isFavourite(favourites, harness, id),
	}));
	return [
		...rows.filter((r) => r.favourite),
		...rows.filter((r) => !r.favourite),
	];
}
