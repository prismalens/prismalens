// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent, Schedule } from "@prismalens/contracts";
import { PrStatusNode } from "@/components/investigation/transcript/PrStatusNode";
import { ListGrid } from "@/components/kit";
import { ScheduleRow } from "@/components/schedules/SchedulesSection";
import { PrView } from "@/components/thread/panel/PrView";
import {
	PullRequestList,
	type PullRequestView,
} from "@/components/thread/panel/PullRequests";
import { checkFixMessage } from "@/components/thread/panel/pr-fix";
import { ThreadPrChip } from "@/components/thread/ThreadPrChip";
import type { GallerySection } from "./gallery";

const SHA = "9f3c2ab71d0e4c55b8a1e2f3d4c5b6a798e0f1a2";

/** A PR with failing, running and passing checks and an open review thread (#1101 category 15). */
export const FIXTURE_PR: PullRequestView = {
	id: "pr-1101",
	url: "https://example.com/acme/shop/pull/412",
	host: "github",
	repo: "acme/shop",
	number: 412,
	title: "Restore the orders index the checkout query lost",
	state: "open",
	review: "changes_requested",
	checks: { state: "failing", total: 9, failed: 1, pending: 1 },
	conflicts: false,
	tone: "failing",
	source: "branch",
	fetchedAt: "2026-11-05T12:00:00Z",
	headSha: SHA,
	headRef: "fix/orders-index",
	baseRef: "main",
	mergeState: "blocked",
	watch: { state: "watching", since: "2026-11-05T11:00:00Z" },
	checkRuns: [
		{
			name: "build",
			state: "passing",
			appName: "CI",
			id: "1",
			appId: "15368",
			url: "https://example.com/acme/shop/actions/runs/1",
		},
		{
			name: "unit tests",
			state: "failing",
			appName: "CI",
			id: "2",
			appId: "15368",
			headSha: SHA,
			url: "https://example.com/acme/shop/actions/runs/2",
		},
		{
			name: "e2e",
			state: "pending",
			appName: "CI",
			id: "3",
			appId: "15368",
			url: "https://example.com/acme/shop/actions/runs/3",
		},
		{ name: "lint", state: "passing", appName: "CI", id: "4", appId: "15368" },
	],
	checkLogs: [
		{
			runId: "2",
			headSha: SHA,
			step: "Run pnpm test",
			lines: [
				" FAIL  src/orders/query.test.ts > lists a customer's orders by date",
				"AssertionError: expected 412 ms to be below 200 ms",
				" ❯ src/orders/query.test.ts:48:31",
				"Test Files  1 failed | 41 passed (42)",
				"##[error]Process completed with exit code 1.",
			],
			unavailable: null,
			fetchedAt: "2026-11-05T12:00:00Z",
		},
	],
	reviewThreads: [
		{
			id: "rt1",
			path: "packages/api/src/orders/query.ts",
			line: 31,
			author: "dana",
			resolved: false,
			outdated: false,
			excerpt:
				"This still sorts in memory. Can the index cover created_at too?",
			replies: 1,
		},
		{
			id: "rt2",
			path: "packages/api/prisma/schema.prisma",
			line: 88,
			author: "lee",
			resolved: true,
			outdated: false,
			excerpt: "Name the index so the migration diff stays readable.",
			replies: 2,
		},
	],
};

const ANSWERS = {
	incidentNumber: 7,
	cause: "likely the orders list query lost its index",
};

const statusEvent = (
	tone: PullRequestView["tone"],
	lines: string[],
	seq: number,
) =>
	({
		kind: "pr_status",
		runId: "t1",
		branchId: "__links__",
		path: [],
		label: null,
		seq,
		ts: "2026-11-05T12:00:00Z",
		prId: FIXTURE_PR.id,
		pr: "acme/shop#412",
		lines,
		phase: "noted",
		tone,
	}) as CanonicalEvent;

const at = (m: number) =>
	new Date(Date.parse("2026-11-05T12:00:00Z") + m * 60_000).toISOString();

const schedule = (p: Partial<Schedule>): Schedule => ({
	id: "s1",
	name: "Watch checkout",
	serviceId: null,
	repositoryId: null,
	runbook: null,
	brief: "Check checkout's errors and deploys.",
	recurrence: { type: "interval", everyMinutes: 120, anchorAt: at(-600) },
	harness: "claude-code",
	model: null,
	effort: null,
	accessLevel: null,
	report: true,
	whenAsks: "decide",
	missedPolicy: "run_once",
	catchUpMinutes: 360,
	subject: "service",
	serviceName: "checkout",
	repositoryName: null,
	alwaysAllow: [],
	description: "Every 2 hours",
	shape: "interval",
	enabled: true,
	pausedReason: null,
	nextRunAt: at(80),
	lastTick: {
		id: "k1",
		scheduledFor: at(-40),
		decidedAt: at(-40),
		outcome: "started",
		reason: null,
		missedCount: 0,
		missedOverflow: false,
		run: {
			id: "r1",
			status: "completed",
			summary: "Nothing wrong found",
			error: null,
			startedAt: at(-40),
			completedAt: at(-35),
			incidentId: null,
			incidentNumber: null,
			unseen: true,
			limit: null,
		},
	},
	liveRunId: null,
	unreadRuns: 2,
	revision: 1,
	createdAt: at(-6000),
	updatedAt: at(-60),
	...p,
});

const LIMITED = schedule({
	id: "s2",
	name: "Daily digest",
	subject: "none",
	serviceName: "",
	description: "Weekdays at 09:00",
	unreadRuns: 0,
	lastTick: {
		id: "k2",
		scheduledFor: at(-30),
		decidedAt: at(-30),
		outcome: "started",
		reason: null,
		missedCount: 0,
		missedOverflow: false,
		run: {
			id: "r2",
			status: "failed",
			summary: null,
			error: "Usage limit reached",
			startedAt: at(-30),
			completedAt: at(-28),
			incidentId: null,
			incidentNumber: null,
			unseen: false,
			limit: { resetsAt: at(140) },
		},
	},
});

const noop = () => {};
/** The PR view at the panel's width. */
const VIEW =
	"flex h-[520px] w-[380px] max-w-full flex-col rounded-pool bg-surface-1";

/** PR and checks, and scheduled tasks (#1101 categories 15 and 22). Only that lane edits this file. */
export const prGallery: GallerySection[] = [
	{
		id: "pr-row",
		title: "PR chip (a GitLab MR last) and the panel's one-line PR row",
		render: () => (
			<div className="flex max-w-md flex-col gap-3">
				<div className="flex gap-2">
					<ThreadPrChip pr={FIXTURE_PR} more={0} onOpen={noop} />
					<ThreadPrChip
						pr={{
							...FIXTURE_PR,
							number: 413,
							tone: "ready",
							checks: { state: "passing", total: 6, failed: 0, pending: 0 },
						}}
						more={1}
						onOpen={noop}
					/>
					<ThreadPrChip
						pr={{ ...FIXTURE_PR, host: "gitlab", number: 88 }}
						more={0}
						onOpen={noop}
					/>
				</div>
				<PullRequestList
					prs={[{ ...FIXTURE_PR, reviewThreads: [] }]}
					onOpen={noop}
				/>
			</div>
		),
	},
	{
		id: "pr-checks-tail",
		title: "PR view: checks, failing first, the first one open",
		render: () => (
			<div className={VIEW}>
				<PrView
					pr={FIXTURE_PR}
					answers={ANSWERS}
					onWatch={noop}
					onDraft={noop}
					onBack={noop}
				/>
			</div>
		),
	},
	{
		id: "pr-check-unavailable",
		title: "PR view: a log that cannot be read says why",
		render: () => (
			<div className={VIEW}>
				<PrView
					pr={{
						...FIXTURE_PR,
						reviewThreads: [],
						checkLogs: [
							{
								runId: "2",
								headSha: SHA,
								step: null,
								lines: [],
								unavailable:
									"The git host gives logs only to a signed-in reader with access to its CI; this repository's token cannot read them.",
								fetchedAt: "2026-11-05T12:00:00Z",
							},
						],
					}}
					onDraft={noop}
				/>
			</div>
		),
	},
	{
		id: "pr-fix-draft",
		title: "Ask the agent to fix: the drafted message, editable before Send",
		render: () => (
			<div
				className="max-w-xl rounded-pool bg-surface-2 p-3"
				data-testid="gallery-fix-draft"
			>
				<p className="whitespace-pre-wrap text-body text-text-1">
					{checkFixMessage(
						FIXTURE_PR,
						FIXTURE_PR.checkRuns?.[1] ?? { name: "unit tests" },
						FIXTURE_PR.checkLogs?.[0],
					)}
				</p>
			</div>
		),
	},
	{
		id: "pr-review-threads",
		title: "PR view: review threads, open first",
		render: () => (
			<div className={VIEW}>
				<PrView
					pr={FIXTURE_PR}
					initialTab="reviews"
					onOpenFile={noop}
					onDraft={noop}
				/>
			</div>
		),
	},
	{
		id: "pr-status-lines",
		title: "Pushed PR status in the transcript",
		render: () => (
			<ul className="m-0 flex max-w-xl list-none flex-col gap-1 p-0">
				<li>
					<PrStatusNode
						event={statusEvent("failing", ["unit tests failed on 9f3c2ab"], 1)}
						incidentId={null}
					/>
				</li>
				<li>
					<PrStatusNode
						event={statusEvent("attention", ["dana requested changes"], 2)}
						incidentId={null}
					/>
				</li>
				<li>
					<PrStatusNode
						event={statusEvent("ready", ["All 9 checks pass"], 3)}
						incidentId={null}
					/>
				</li>
			</ul>
		),
	},
	{
		id: "schedules-list",
		title: "Schedules: cadence, next run, last result, unread runs",
		render: () => (
			<ListGrid label="Schedules">
				<ScheduleRow schedule={schedule({})} canEdit />
				<ScheduleRow schedule={LIMITED} canEdit />
			</ListGrid>
		),
	},
	{
		id: "schedule-limit",
		title: "A scheduled run that hit a usage limit, with its reset",
		render: () => (
			<ListGrid label="Schedules">
				<ScheduleRow schedule={LIMITED} canEdit={false} />
			</ListGrid>
		),
	},
];
