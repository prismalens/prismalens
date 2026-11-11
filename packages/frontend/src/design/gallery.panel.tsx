// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	NO_CHECKS,
	PR_TONES,
	type PrTone,
	type ThreadContext,
	type ThreadTree,
} from "@prismalens/contracts";
import { KindTab } from "@/components/thread/panel/KindTab";
import {
	type PrWatch,
	PullRequestList,
	type PullRequestView,
} from "@/components/thread/panel/PullRequests";
import {
	MachineAgentSection,
	ThreadTreeSection,
} from "@/components/thread/panel/ThreadSections";
import type { GallerySection } from "./gallery";

const TONE_STATE: Record<PrTone, PullRequestView["state"]> = {
	ready: "open",
	open: "open",
	draft: "draft",
	attention: "open",
	failing: "open",
	merged: "merged",
	closed: "closed",
	unknown: "unknown",
};

const pr = (
	n: number,
	tone: PrTone,
	p: Partial<PullRequestView> = {},
): PullRequestView => ({
	id: `pr-${n}`,
	url: `https://example.com/acme/shop/pull/${n}`,
	host: "github",
	repo: "acme/shop",
	number: n,
	title: `Pull request ${tone}`,
	state: TONE_STATE[tone],
	review: "none",
	checks: NO_CHECKS,
	conflicts: false,
	tone,
	source: "agent",
	fetchedAt: "2026-11-05T12:00:00Z",
	...p,
});

const TONES = PR_TONES.map((t, i) => pr(100 + i, t));

const CHECKS: PullRequestView[] = [
	pr(201, "failing", {
		title: "Two failing, one running",
		checks: { state: "failing", total: 9, failed: 2, pending: 1 },
		review: "changes_requested",
		conflicts: true,
		checkRuns: [
			{ name: "build", state: "passing", appName: "CI" },
			{ name: "unit tests", state: "failing", appName: "CI" },
			{ name: "lint", state: "pending", appName: "CI" },
		],
	}),
	pr(202, "ready", {
		title: "All passing",
		checks: { state: "passing", total: 4, failed: 0, pending: 0 },
		review: "approved",
	}),
];

const WATCHES: PrWatch[] = [
	{ state: "watching" },
	{ state: "waiting" },
	{ state: "disconnected" },
	{ state: "expired", reason: "thread idle 7 days" },
	{ state: "stopped", reason: "merged" },
];

const TREE: ThreadTree = {
	rootId: "t1",
	allowance: { grantedAt: "2026-11-05T11:00:00Z" },
	nodes: (
		[
			["t1", null, 0, "running", 0, null],
			["t2", "t1", 1, "queued", 0, "tester"],
			["t3", "t1", 1, "running", 2, "reviewer"],
			["t4", "t3", 2, "answered", 0, "docs"],
			["t5", "t4", 3, "failed", 1, "build"],
			["t6", "t5", 4, "stopped", 0, "deep"],
		] as const
	).map(([id, parentId, depth, state, unread, role], i) => ({
		id,
		number: i + 1,
		title: role ? `Check the ${role} path` : "Fix the checkout timeout",
		role,
		parentId,
		depth,
		state,
		unread,
		link: `/threads/${id}`,
	})),
};

const base = {
	threadId: "t1",
	title: "Fix the checkout timeout",
	machine: { hostName: "build-box", os: "linux" as const, isHost: true },
	agent: { harness: "claude-code", model: "opus", effort: "high" },
	workspace: null,
	lineage: [],
	plan: null,
	pullRequests: [],
};

const KINDS: ThreadContext[] = [
	{
		...base,
		kind: "incident",
		incident: {
			id: "i1",
			number: 7,
			title: "CheckoutLatencyHigh",
			severity: "high",
			status: "investigating",
			alertCount: 2,
			impact: "p99 checkout latency above 2 s",
		},
		suspects: [
			{
				id: "h1",
				statement: "The list query lost its index",
				status: "supported",
			},
		],
		report: "ready",
	} as ThreadContext,
	{
		...base,
		kind: "schedule",
		schedule: {
			id: "s1",
			name: "Morning check",
			recurrence: { type: "cron", expr: "0 9 * * 1-5", timezone: "UTC" },
			nextRunAt: "2026-11-06T09:00:00Z",
			lastRuns: [
				{ id: "r1", status: "completed", at: "2026-11-05T09:00:00Z" },
				{ id: "r2", status: "failed", at: "2026-11-04T09:00:00Z" },
			],
		},
	},
	{
		...base,
		kind: "service",
		service: {
			id: "svc1",
			name: "checkout-api",
			tier: "tier 1",
			owner: "payments",
			dependencies: [{ id: "svc2", name: "orders-db" }],
		},
	},
	{
		...base,
		kind: "project",
		project: { id: "p1", name: "acme/shop" },
		scripts: [{ runner: "pnpm", name: "test", command: "pnpm run test" }],
	},
];

const box = "flex flex-col gap-2 rounded-pool bg-surface-1 p-2";

/** UI 2's states in the gallery (#1024). Only UI 2 edits this file. */
export const panelGallery: GallerySection[] = [
	{
		id: "pr-tones",
		title: "Pull requests: every tone, each with its word",
		render: () => (
			<div className={box}>
				<PullRequestList prs={TONES} />
			</div>
		),
	},
	{
		id: "pr-checks",
		title: "Pull requests: checks, review and a merge conflict",
		render: () => (
			<div className={box}>
				<PullRequestList prs={CHECKS} />
			</div>
		),
	},
	{
		id: "pr-watch",
		title: "Pull requests: the watch line in each state",
		render: () => (
			<div className={box}>
				<PullRequestList
					prs={WATCHES.map((watch, i) =>
						pr(300 + i, "open", { title: `Watch ${watch.state}`, watch }),
					)}
					onWatch={() => undefined}
				/>
			</div>
		),
	},
	{
		id: "tree",
		title: "Threads an agent started: states, unread, deep indent",
		render: () => (
			<div className={box}>
				<ThreadTreeSection
					tree={TREE}
					currentId="t3"
					isHost
					onRevoke={() => undefined}
				/>
			</div>
		),
	},
	{
		id: "kinds",
		title: "The panel's kind tab, per kind",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				{KINDS.map((c) => (
					<div key={c.kind} className={box}>
						<KindTab context={c} />
					</div>
				))}
			</div>
		),
	},
	{
		id: "machine",
		title: "Machine and agent: on the host, then from another machine",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				<div className={box}>
					<MachineAgentSection
						context={base}
						agentLabel="The agent"
						live
						session={{
							lastActivityAt: "2026-11-05T11:58:00Z",
							cache: "warm",
							compaction: "none",
						}}
					/>
				</div>
				<div className={box}>
					<MachineAgentSection
						context={{
							...base,
							machine: { ...base.machine, isHost: false },
						}}
						agentLabel="The agent"
						live={false}
						session={{
							lastActivityAt: "2026-11-05T09:00:00Z",
							cache: "unknown",
							compaction: "none",
							limit: {
								since: "2026-11-05T11:00:00Z",
								resetsAt: "2026-11-05T15:45:00Z",
								autoResume: true,
								attempts: 0,
							},
						}}
					/>
				</div>
			</div>
		),
	},
];
