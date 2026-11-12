// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The state gallery (dev only): shared components in each state, from fixtures,
 * with no API or agent behind them. The design matrix shoots it; a new component
 * shows its states here before it is wired to data (design/GUIDELINES.md).
 */
import type {
	ThreadRow as FeedRow,
	IncidentWithRelations,
	ThreadUnit,
} from "@prismalens/contracts";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { Transcript } from "@/components/investigation/Transcript";
import { RunStrip } from "@/components/run/RunStrip";
import { TriggerCard } from "@/components/run/TriggerCard";
import { Ring } from "@/components/shared/Ring";
import { Blank, Empty, Loading, Problem } from "@/components/shared/State";
import { StateWord } from "@/components/shared/StateWord";
import {
	type ThreadRow,
	ThreadRowView,
	unitRow,
} from "@/components/shell/ThreadList";
import { appGallery } from "@/design/gallery.app";
import { composerGallery } from "@/design/gallery.composer";
import { kitGallery } from "@/design/gallery.kit";
import { listGallery } from "@/design/gallery.list";
import { panelGallery } from "@/design/gallery.panel";
import type { TranscriptItem } from "@/lib/investigation-events";

export const Route = createFileRoute("/_design")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw notFound();
	},
	component: Gallery,
});

/** Each lane adds its states to its own file, so lanes never edit this one (#1024). */
const LANE_SECTIONS = [
	...kitGallery,
	...composerGallery,
	...panelGallery,
	...appGallery,
	...listGallery,
];

const NOW = Date.parse("2026-11-05T12:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();

const incident = (
	title: string,
	source: string | null,
	p: Partial<IncidentWithRelations> = {},
) =>
	({
		id: `fixture-${title}`,
		number: 7,
		title,
		status: "investigating",
		severity: "high",
		triggeredAt: ago(30),
		updatedAt: ago(2),
		alertCount: source ? 1 : 0,
		alerts: source
			? [
					{
						id: `alert-${title}`,
						title,
						status: "triggered",
						source,
						triggeredAt: ago(30),
						labels: { severity: "high", service: "checkout-api" },
					},
				]
			: [],
		investigations: [],
		tags: source ? [] : ["chat"],
		service: { id: "s1", name: "checkout-api", displayName: "Checkout API" },
		...p,
	}) as unknown as IncidentWithRelations;

/** A fixture incident as the feed shows it: one unit, one run. */
const incidentRow = (i: IncidentWithRelations): ThreadRow =>
	unitRow(
		{
			section: "active",
			incident: {
				id: i.id,
				number: i.number,
				title: i.title,
				severity: i.severity,
				status: i.status,
			},
			threads: [
				{
					id: `run-${i.id}`,
					incidentId: i.id,
					kind: "investigation",
					status: "completed",
					title: i.title,
					triggerType: i.alertCount ? "alert" : "manual",
					lastActivityAt: i.updatedAt,
					serviceName: "Checkout API",
					projectName: null,
				} as unknown as FeedRow,
			],
		} as ThreadUnit,
		i,
	);

const ROWS: ThreadRow[] = [
	{
		...incidentRow(incident("CheckoutLatencyHigh", "prometheus")),
		state: "asks",
	},
	{
		...incidentRow(incident("PaymentsQueueBacklog", "prometheus")),
		state: "failed",
	},
	{
		...incidentRow(incident("CacheMissSpike", "prometheus")),
		state: "working",
	},
	{
		...incidentRow(incident("ApiLatencyP99High", "prometheus")),
		state: "ready",
	},
	incidentRow(incident("CI failed on main", "github")),
	incidentRow(incident("Why does the cart reload twice?", null)),
];

const ITEMS: TranscriptItem[] = [
	{ kind: "prose", key: "p1", text: "Looking at **recent commits** first." },
	{
		kind: "tools",
		key: "t1",
		count: 3,
		summary: "ran 2 commands, read 1 file",
		failed: 0,
		running: 0,
		rows: [],
		callIds: ["c1", "c2", "c3"],
	},
	{
		kind: "prose",
		key: "p2",
		text: "The p99 rise follows `d37d888`, which dropped the index the list query uses.",
	},
	{ kind: "end", key: "e1", tone: "done", text: "Report ready", report: true },
];

function Gallery() {
	return (
		<div className="h-full overflow-y-auto" data-testid="design-gallery">
			<div className="mx-auto flex max-w-[960px] flex-col gap-10 px-6 py-8">
				<h1 className="text-display">States</h1>

				<Section title="Thread rows: sidebar, then the Threads page">
					<div className="grid gap-6 md:grid-cols-2">
						<div className="flex flex-col gap-px rounded-pool bg-surface-1 p-2">
							{ROWS.map((r) => (
								<ThreadRowView key={r.key} row={r} now={NOW} on={false} />
							))}
						</div>
						<div className="flex flex-col gap-px">
							{ROWS.map((r) => (
								<ThreadRowView
									key={r.key}
									row={r}
									now={NOW}
									on={false}
									detailed
								/>
							))}
						</div>
					</div>
				</Section>

				<Section title="What started a thread">
					<ul className="flex flex-col gap-3">
						<TriggerCard
							incident={incident("CheckoutLatencyHigh", "prometheus")}
						/>
						<TriggerCard incident={incident("CI failed on main", "github")} />
					</ul>
				</Section>

				<Section title="Run strip">
					<div className="flex flex-col gap-2 rounded-pool bg-surface-1">
						{(
							[
								[
									"working",
									"Run 1 investigating",
									"Reading worker/consumer.py",
								],
								["done", "Run 1 concluded", "Likely cause found, 2m ago"],
								["failed", "Run 1 failed", "The agent is not signed in."],
							] as const
						).map(([state, label, detail]) => (
							<RunStrip
								key={state}
								state={state}
								label={label}
								detail={detail}
								incidentId="fixture"
								runs={[]}
								current={null}
							/>
						))}
					</div>
				</Section>

				<Section title="Transcript: a folded tool group and the report card">
					<div className="h-[420px] rounded-pool bg-canvas">
						<Transcript
							items={ITEMS}
							incidentId={null}
							agent="The agent"
							report={{
								title: "Run 1 concluded: likely cause",
								summary: "The p99 rise follows d37d888.",
								stop: null,
								lasting: null,
							}}
						/>
					</div>
				</Section>

				<Section title="State words, the ring and agent marks">
					<div className="flex flex-wrap items-center gap-4">
						{(
							[
								"danger",
								"warn",
								"ok",
								"live",
								"accent",
								"neutral",
								"quiet",
							] as const
						).map((t) => (
							<StateWord key={t} tone={t}>
								{t}
							</StateWord>
						))}
						<Ring />
						{["claude-code", "codex", "opencode", "gemini", "unknown"].map(
							(id) => (
								<AgentMark key={id} id={id} className="size-5" />
							),
						)}
					</div>
				</Section>

				<Section title="Empty, loading and failed">
					<div className="grid gap-4 md:grid-cols-2">
						<Empty text="No threads yet." />
						<Loading rows={3} />
						<Problem text="This run did not load." onRetry={() => undefined} />
						<Blank title="Add your first service" testId="gallery-blank">
							<p className="text-body text-text-2">One action fills this.</p>
						</Blank>
					</div>
				</Section>

				{LANE_SECTIONS.map((s) => (
					<Section key={s.id} title={s.title}>
						{s.render()}
					</Section>
				))}
			</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-heading text-text-2">{title}</h2>
			{children}
		</section>
	);
}
