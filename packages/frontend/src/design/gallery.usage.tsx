// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	UsageBucket,
	UsageDay,
	UsageLimits,
	UsageModel,
	UsageSummary,
} from "@prismalens/contracts";
import { ModelCardBody } from "@/components/usage/ModelCard";
import {
	UsageWarnRing,
	type WaitingThread,
} from "@/components/usage/UsageLimitsPanel";
import { UsagePanel, type UsageTab } from "@/components/usage/UsageView";
import type { GallerySection } from "./gallery";

const NOW = Date.parse("2026-11-12T15:15:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const DAYS = Array.from({ length: 8 }, (_, i) =>
	new Date(NOW - (7 - i) * 86_400_000).toISOString().slice(0, 10),
);
const noop = () => {};

function bucket(
	input: number,
	output: number,
	cacheRead: number,
	cacheWrite: number,
	cost: number | null,
	turns: number,
	unpricedTurns = 0,
): UsageBucket {
	return {
		turns,
		tokens: {
			input,
			output,
			cacheRead,
			cacheWrite,
			total: input + output + cacheRead + cacheWrite,
		},
		cost: { amount: cost, currency: "USD", unpricedTurns },
	};
}

const empty = () => bucket(0, 0, 0, 0, null, 0);
const scale = (b: UsageBucket, k: number): UsageBucket =>
	bucket(
		Math.round(b.tokens.input * k),
		Math.round(b.tokens.output * k),
		Math.round(b.tokens.cacheRead * k),
		Math.round(b.tokens.cacheWrite * k),
		b.cost.amount === null ? null : b.cost.amount * k,
		Math.max(1, Math.round(b.turns * k)),
		Math.round(b.cost.unpricedTurns * k),
	);
const SHAPE = [0.05, 0.12, 0, 0.2, 0.18, 0.08, 0.22, 0.15];
const daysOf = (b: UsageBucket): UsageDay[] =>
	DAYS.map((day, i) => ({
		day,
		...(SHAPE[i] ? scale(b, SHAPE[i]) : empty()),
	}));

function model(name: string, agent: string, b: UsageBucket): UsageModel {
	return { ...b, model: name, agent, days: daysOf(b) };
}

const sonnet = model(
	"claude-sonnet-5-5",
	"claude-code",
	bucket(1_840_000, 412_000, 9_600_000, 820_000, 18.42, 640),
);
const opus = model(
	"claude-opus-5-5",
	"claude-code",
	bucket(310_000, 96_000, 1_420_000, 210_000, 9.75, 88),
);
const unpriced = model(
	"gpt-6.1-sol",
	"codex",
	bucket(520_000, 140_000, 0, 0, null, 120, 120),
);

function sum(models: UsageModel[]): UsageBucket {
	const t = models.reduce(
		(acc, m) => ({
			input: acc.input + m.tokens.input,
			output: acc.output + m.tokens.output,
			cacheRead: acc.cacheRead + m.tokens.cacheRead,
			cacheWrite: acc.cacheWrite + m.tokens.cacheWrite,
			cost: acc.cost + (m.cost.amount ?? 0),
			turns: acc.turns + m.turns,
			unpriced: acc.unpriced + m.cost.unpricedTurns,
		}),
		{
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			turns: 0,
			unpriced: 0,
		},
	);
	return bucket(
		t.input,
		t.output,
		t.cacheRead,
		t.cacheWrite,
		t.cost,
		t.turns,
		t.unpriced,
	);
}

function summary(
	models: UsageModel[],
	silentAgents: string[] = [],
): UsageSummary {
	const totals = models.length ? sum(models) : empty();
	return {
		range: "7d",
		since: new Date(NOW - 7 * 86_400_000).toISOString(),
		until: new Date(NOW).toISOString(),
		step: "day",
		totals,
		threads: models.length ? 37 : 0,
		days: models.length
			? daysOf(totals)
			: DAYS.map((day) => ({ day, ...empty() })),
		models,
		projects: [
			{ id: "p1", name: "acme/checkout" },
			{ id: "p2", name: "acme/payments-api" },
		],
		agents: ["claude-code", "codex", "gemini"],
		silentAgents,
	};
}

const WITH_DATA = summary([sonnet, opus], ["gemini"]);
const WITH_UNPRICED = summary([sonnet, opus, unpriced]);
const EMPTY = summary([], ["codex"]);

const LIMITS: UsageLimits = {
	agents: [
		{
			agent: "claude-code",
			windows: [
				{
					window: "session",
					type: "five_hour",
					usedPercent: 62,
					resetsAt: at(159),
					status: "allowed",
					at: at(-13),
				},
				{
					window: "weekly",
					type: "seven_day",
					usedPercent: 31,
					resetsAt: at(3 * 1440 + 4 * 60),
					status: "allowed",
					at: at(-13),
				},
				{
					window: "model",
					type: "seven_day_opus",
					usedPercent: null,
					resetsAt: at(3 * 1440 + 4 * 60),
					status: null,
					at: at(-13),
				},
			],
		},
		{ agent: "codex", windows: [] },
	],
};

/** The same windows near and past their limit: amber, then red with the clock. */
const LIMITS_HOT: UsageLimits = {
	agents: [
		{
			agent: "claude-code",
			windows: [
				{
					window: "session",
					type: "five_hour",
					usedPercent: 100,
					resetsAt: at(74),
					status: "rejected",
					at: at(-2),
				},
				{
					window: "weekly",
					type: "seven_day",
					usedPercent: 93,
					resetsAt: at(1440 + 6 * 60),
					status: "allowed_warning",
					at: at(-2),
				},
				{
					window: "model",
					type: "seven_day_opus",
					usedPercent: 48,
					resetsAt: at(1440 + 6 * 60),
					status: "allowed",
					at: at(-2),
				},
			],
		},
		{ agent: "gemini", windows: [] },
	],
};

/** Threads a limit holds: one goes on at the reset, one waits for a person. */
const WAITING: WaitingThread[] = [
	{
		id: "t-limited",
		title: "Nightly flaky test triage",
		harness: "claude-code",
		limit: { resetsAt: at(95) },
	},
	{
		id: "t-blocked",
		title: "Why are checkouts failing",
		harness: "claude-code",
		limit: { resetsAt: null, mode: "spend_cap" },
	},
];

function panel(
	tab: UsageTab,
	data: UsageSummary,
	limits: UsageLimits = LIMITS,
	waiting: WaitingThread[] = [],
) {
	return (
		<UsagePanel
			range="7d"
			onRangeChange={noop}
			onProjectChange={noop}
			onAgentChange={noop}
			tab={tab}
			onTabChange={noop}
			summary={{ status: "ready", data }}
			limits={{ status: "ready", data: limits }}
			now={NOW}
			waiting={waiting}
		/>
	);
}

/** The Usage view's states (#1101 category 17), from fixtures only. */
export const usageGallery: GallerySection[] = [
	{
		id: "usage-tokens",
		title: "Usage: tokens, one agent silent",
		render: () => panel("tokens", WITH_DATA),
	},
	{
		id: "usage-cost-unpriced",
		title: "Usage: cost with an unpriced model",
		render: () => panel("cost", WITH_UNPRICED),
	},
	{
		id: "usage-model-card",
		title: "Usage: a model's card",
		render: () => (
			<div className="max-w-[480px]">
				<ModelCardBody model={sonnet} step="day" />
			</div>
		),
	},
	{
		id: "usage-limits",
		title: "Usage: limits, one agent reports none",
		render: () => panel("limits", WITH_DATA),
	},
	{
		id: "usage-limits-hot",
		title: "Usage: limits near and at the limit, with the threads they hold",
		render: () => panel("limits", WITH_DATA, LIMITS_HOT, WAITING),
	},
	{
		id: "composer-usage-ring",
		title: "Composer footer: usage ring near and at the limit",
		render: () => (
			<div className="flex items-center gap-4 text-meta text-text-2">
				<UsageWarnRing
					w={{
						window: "session",
						type: "five_hour",
						usedPercent: 93,
						status: "allowed_warning",
						resetsAt: new Date(NOW + 74 * 60_000).toISOString(),
					}}
					now={NOW}
				/>
				<UsageWarnRing
					w={{
						window: "weekly",
						type: "seven_day",
						usedPercent: 100,
						status: "rejected",
						resetsAt: new Date(NOW + 2 * 86_400_000).toISOString(),
					}}
					now={NOW}
				/>
			</div>
		),
	},
	{
		id: "usage-empty",
		title: "Usage: an empty range",
		render: () => panel("tokens", EMPTY),
	},
];
