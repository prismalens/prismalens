// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * One model list for the picker and Settings → Agent (#907): the agent's own
 * default folds into PrismaLens's Default row (#902 f10), and the operator's
 * hidden models, order and stars apply.
 */
import type { FavouriteModel, HarnessStatus } from "@prismalens/contracts";

/** The agent's own "default" entry, which the Default row already stands for. */
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

const PROVIDERS: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	google: "Google",
	opencode: "OpenCode Zen",
	"github-copilot": "GitHub Copilot",
	openrouter: "OpenRouter",
	xai: "xAI",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	ollama: "Ollama",
};
const VENDOR: Record<string, string> = {
	"claude-code": "Anthropic",
	codex: "OpenAI",
	gemini: "Google",
};

/** The provider a model id lists under: its prefix, else the agent's own vendor. */
export function providerOf(harnessId: string, modelId: string): string {
	const slash = modelId.indexOf("/");
	if (slash > 0) {
		const prefix = modelId.slice(0, slash);
		return (
			PROVIDERS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1)
		);
	}
	if (/:[\w.-]*cloud$|^[\w.-]+:\d/.test(modelId)) return "Ollama";
	return VENDOR[harnessId] ?? "Models";
}

export interface ModelPrefs {
	custom?: string[];
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
	const custom = Array.from(new Set(s.custom ?? [])).filter(
		(id) => !listed.has(id) && !isAgentDefault({ id }),
	);
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
