// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	IncidentWithRelations,
	ServiceWithRelations,
	ThreadSession,
} from "@prismalens/contracts";
import type { ReactNode } from "react";
import { AgentReadyChip } from "@/components/home/HomeComposer";
import { IncidentCard } from "@/components/inbox/NeedsYou";
import { ListCard, ListGrid, MARKS, Mark, type MarkId } from "@/components/kit";
import { ServiceCard } from "@/components/services/ServiceCard";
import { Mono } from "@/components/shared/Mono";
import { LimitDock } from "@/components/thread/session/LimitDock";
import {
	ConnectionDock,
	InterruptedDock,
} from "@/components/thread/session/StopDocks";
import type { GallerySection } from "./gallery";

const noop = () => undefined;
const NOW = Date.parse("2026-11-05T12:00:00Z");
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();

function Stage({
	id,
	caption,
	children,
}: {
	id: string;
	caption: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2" data-kit-state={id}>
			<span className="text-meta text-text-3">{caption}</span>
			<div>{children}</div>
		</div>
	);
}

const service = (
	name: string,
	over: Partial<ServiceWithRelations> = {},
): ServiceWithRelations =>
	({
		id: `svc-${name}`,
		name,
		displayName: name,
		type: "service",
		tier: "tier_2",
		team: "platform",
		repositories: [],
		...over,
	}) as unknown as ServiceWithRelations;

const linked = {
	repositories: [
		{
			isPrimary: true,
			subPath: null,
			repository: {
				sourceKind: "git",
				url: "https://example.com/acme/api.git",
			},
		},
	],
} as unknown as Partial<ServiceWithRelations>;

const incident = (
	n: number,
	title: string,
	over: Partial<IncidentWithRelations> = {},
): IncidentWithRelations =>
	({
		id: `fixture-inc-${n}`,
		number: n,
		title,
		status: "investigating",
		severity: "high",
		triggeredAt: ago(42),
		updatedAt: ago(3),
		alerts: [],
		investigations: [],
		tags: [],
		services: [{ id: "s1", name: "checkout-api" }],
		...over,
	}) as unknown as IncidentWithRelations;

/** Each state a mark from `marks.ts` can take, with its word. */
function MarkRow({ id }: { id: MarkId }) {
	const tones = Object.keys(MARKS[id].tones);
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-text-2">
			<span className="w-20 text-text-3">{MARKS[id].label}</span>
			{tones.map((state) => (
				<span key={state} className="inline-flex items-center gap-1.5">
					<Mark id={id} state={state} word={state} />
					{state}
				</span>
			))}
		</div>
	);
}

/** The five list screens on the kit (#1101): Home's chips, services, incidents, alerts. */

type Stop = NonNullable<ThreadSession["limit"]>;

const STOP_NOW = Date.parse("2026-11-12T15:15:00Z");
const at = (min: number) => new Date(STOP_NOW + min * 60_000).toISOString();
const clock = (iso: string) => iso.slice(11, 16);
const switchChoices = {
	models: [
		{ id: "sonnet", label: "Sonnet 5.5" },
		{ id: "haiku", label: "Haiku 5.5" },
	],
	agents: [{ id: "codex", label: "Codex" }],
};

const base: Stop = {
	since: at(-5),
	autoResume: true,
	attempts: 1,
	agent: "Claude Code",
};

/** Each provider stop's dock (#1101 categories 17 and 23), one per mode and state. */
const STOPS: { name: string; limit: Stop; draft?: string; url?: string }[] = [
	{
		name: "Usage limit, resumes at the reset, a queued message",
		limit: {
			...base,
			mode: "usage_limit",
			window: "session",
			resetsAt: at(30),
			nextAttemptAt: at(32),
			message: "Then check the cache hit rate.",
		},
	},
	{
		name: "Usage limit, reset unknown, try 2 of 7",
		limit: {
			...base,
			mode: "usage_limit",
			resetsAt: null,
			nextAttemptAt: at(30),
			maxAttempts: 6,
		},
		draft: "Also look at the slow query log.",
	},
	{
		name: "Rate limited, try 2 of 5",
		limit: {
			...base,
			mode: "rate_limited",
			resetsAt: null,
			nextAttemptAt: at(2),
			attempts: 2,
			maxAttempts: 5,
		},
	},
	{
		name: "Provider busy, try 3 of 5",
		limit: {
			...base,
			mode: "overloaded",
			resetsAt: null,
			nextAttemptAt: at(1),
			attempts: 3,
			maxAttempts: 5,
		},
	},
	{
		name: "Provider busy, five tries spent",
		limit: {
			...base,
			mode: "overloaded",
			resetsAt: null,
			attempts: 6,
			maxAttempts: 5,
			gaveUp: true,
		},
	},
	{
		name: "Blocked: out of credit",
		limit: { ...base, mode: "out_of_credit", resetsAt: null },
		url: "https://platform.claude.com/settings/billing",
	},
	{
		name: "Blocked: API key rejected",
		limit: { ...base, mode: "key_rejected", resetsAt: null },
	},
	{
		name: "Blocked: spend cap",
		limit: { ...base, mode: "spend_cap", resetsAt: null },
		url: "https://platform.claude.com/settings/limits",
	},
];

/** UI 3's states in the gallery (#1024, #1101). Only UI 3 edits this file. */
export const appGallery: GallerySection[] = [
	{
		id: "app-marks",
		title: "Marks for lists",
		render: () => (
			<Stage id="app-marks" caption="Every state of the list marks">
				<div className="flex flex-col gap-2">
					{(
						[
							"agentReady",
							"severity",
							"firing",
							"alert",
							"health",
							"code",
							"repeats",
						] as const
					).map((id) => (
						<MarkRow key={id} id={id} />
					))}
				</div>
			</Stage>
		),
	},
	{
		id: "app-home-chips",
		title: "Home chips",
		render: () => (
			<Stage
				id="app-home-chips"
				caption="Agent ready, needs sign-in, not installed; no code linked"
			>
				<div className="flex items-center gap-0.5">
					<AgentReadyChip
						agent="claude-code"
						state="ready"
						word="Claude Code ready"
					/>
					<AgentReadyChip
						agent="codex"
						state="signIn"
						word="Codex needs a sign-in"
					/>
					<AgentReadyChip
						agent={null}
						state="missing"
						word="No agent installed"
					/>
					<span className="inline-flex h-8 items-center px-2">
						<Mark id="code" state="missing" word="No code linked" />
					</span>
				</div>
			</Stage>
		),
	},
	{
		id: "app-services",
		title: "Service cards",
		render: () => (
			<Stage
				id="app-services"
				caption="Healthy with code, degraded, down, stopped reporting"
			>
				<ListGrid label="Services">
					<ServiceCard
						service={service("checkout-api", linked)}
						open={0}
						health="ok"
					/>
					<ServiceCard
						service={service("payments", { type: "database" })}
						open={1}
						health="degraded"
					/>
					<ServiceCard
						service={service("edge-gateway", {
							type: "gateway",
							tier: "tier_1",
						})}
						open={3}
						health="down"
					/>
					<ServiceCard
						service={service("ledger-sync", {
							...linked,
							lastReportAt: ago(3 * 24 * 60),
						})}
						open={0}
						health="silent"
						now={NOW}
					/>
				</ListGrid>
			</Stage>
		),
	},
	{
		id: "app-incidents",
		title: "Incident cards",
		render: () => (
			<Stage
				id="app-incidents"
				caption="Triage order; repeats folded as ×N; not investigated"
			>
				<ListGrid label="Incidents" wide>
					<IncidentCard
						incident={incident(41, "5xx spike on checkout-api", {
							severity: "critical",
							investigations: [
								{
									id: "fixture-run-41",
									kind: "investigation",
									status: "completed",
									rootCause: "Pool size capped at 10 after release 2.4.1",
									createdAt: ago(30),
								},
							] as unknown as IncidentWithRelations["investigations"],
						})}
						repeats={2}
						need="ready"
						now={NOW}
						onAction={noop}
						onMergePick={noop}
					/>
					<IncidentCard
						incident={incident(
							39,
							"BooklogrWorkerCrashLoopWithAVeryLongAlertNameForTruncation",
							{
								severity: "medium",
								status: "triggered",
							},
						)}
						need="uninvestigated"
						now={NOW}
						onAction={noop}
						onMergePick={noop}
					/>
				</ListGrid>
			</Stage>
		),
	},
	{
		id: "app-alerts",
		title: "Alert cards",
		render: () => (
			<Stage id="app-alerts" caption="Firing ×4, acknowledged, suppressed">
				<ListGrid label="Alerts" wide>
					{(
						[
							[
								"critical",
								"triggered",
								"Firing",
								4,
								"HTTP 502 on edge-gateway",
							],
							["medium", "acknowledged", "Acknowledged", 1, "Disk 85% on db-1"],
							["info", "suppressed", "Suppressed", 1, "Maintenance probe"],
						] as const
					).map(([sev, status, word, n, title]) => (
						<ListCard
							key={title}
							title={title}
							icon={<Mark id="severity" state={sev} word={sev} />}
							onOpen={noop}
							meta={
								<span className="flex min-w-0 items-center gap-2.5">
									<Mark id="alert" state={status} word={word} />
									{n > 1 && (
										<Mark
											id="repeats"
											word={`${n} like this`}
											className="text-text-2"
										>
											×{n}
										</Mark>
									)}
									<Mono className="text-text-3">INC-41</Mono>
									<span className="truncate text-text-3">
										edge-gateway, 14:02
									</span>
								</span>
							}
						/>
					))}
				</ListGrid>
			</Stage>
		),
	},
	{
		id: "provider-stops",
		title: "Provider stops: limits, API-key failures, restart and connection",
		render: () => (
			<div className="flex max-w-[760px] flex-col gap-4">
				{STOPS.map((s) => (
					<div key={s.name} className="flex flex-col gap-1">
						<span className="text-meta text-text-3">{s.name}</span>
						<LimitDock
							limit={s.limit}
							draft={s.draft}
							now={STOP_NOW}
							clock={clock}
							onDontResume={noop}
							onSendAtReset={noop}
							onResumeAtReset={noop}
							onRemoveQueued={noop}
							onSend={noop}
							onRetryNow={noop}
							onUpdateKey={noop}
							accountUrl={s.url}
							switchChoices={switchChoices}
						/>
					</div>
				))}
				<div className="flex flex-col gap-1">
					<span className="text-meta text-text-3">Interrupted by restart</span>
					<InterruptedDock onResume={noop} />
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-meta text-text-3">
						Interrupted by restart, not resumed
					</span>
					<InterruptedDock
						onResume={noop}
						notResumed="PrismaLens was off for 26 hours, and a run resumes on its own only within a day of stopping."
					/>
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-meta text-text-3">Connection lost</span>
					<ConnectionDock fixedAsOf={STOP_NOW} />
				</div>
			</div>
		),
	},
];
