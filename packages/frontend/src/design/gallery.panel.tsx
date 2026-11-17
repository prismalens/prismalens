// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	NO_CHECKS,
	PR_TONES,
	type PrTone,
	type ThreadContext,
	type ThreadLinks,
} from "@prismalens/contracts";
import { DetailsCard } from "@/components/kit/DetailsCard";
import {
	BOX_H,
	DETAILS_LAYOUT,
	detailsRows,
} from "@/components/kit/details-registry";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { Problem } from "@/components/shared/State";
import type {
	DiffFileCtx,
	DiffLineCtx,
} from "@/components/thread/diff/diff.actions";
import {
	DetailsActions,
	DetailsFolder,
} from "@/components/thread/panel/DetailsActions";
import type {
	DetailsCtx,
	EditorChoice,
} from "@/components/thread/panel/details.actions";
import { KindTab } from "@/components/thread/panel/KindTab";
import { NewTabPage } from "@/components/thread/panel/PaneBodies";
import { PrView } from "@/components/thread/panel/PrView";
import {
	type PrWatch,
	PullRequestList,
	type PullRequestView,
} from "@/components/thread/panel/PullRequests";
import type { PaneCtx } from "@/components/thread/panel/pane.actions";
import {
	SessionSection,
	StartedSection,
	startedHeading,
} from "@/components/thread/panel/ThreadSections";
import { ThreadSidePanel } from "@/components/thread/panel/ThreadSidePanel";
import { startedCount } from "@/components/thread/panel/thread-details";
import type { GallerySection } from "./gallery";
import { browserGallery } from "./gallery.browser";

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

const LINKS: ThreadLinks = {
	startedBy: {
		id: "t0",
		title: "Checkout 502s after deploy",
		link: "/threads/t0",
		state: "running",
		unread: 0,
		via: "agent",
	},
	started: (
		[
			["t2", "queued", 0, "tester"],
			["t3", "running", 2, "reviewer"],
			["t4", "answered", 0, "docs"],
			["t5", "failed", 1, "build"],
			["t6", "stopped", 0, "deep"],
			["t7", "running", 0, "load"],
			["t8", "answered", 0, "cache"],
		] as const
	).map(([id, state, unread, what], i) => ({
		id,
		title: `Check the ${what} path`,
		link: `/threads/${id}`,
		state,
		unread,
		harness: "claude-code",
		via: (["agent", "fork", "fix", "side"] as const)[i % 4],
		startedAt: `2026-11-05T11:0${i}:00Z`,
		endedAt:
			state === "answered" || state === "stopped" || state === "failed"
				? `2026-11-05T11:${i + 3}5:00Z`
				: null,
	})),
	subagents: [
		{
			sessionId: "s-run",
			parentSessionId: null,
			title: "Read the pool settings",
			state: "running",
			startedAt: "2026-11-05T11:00:30Z",
			endedAt: null,
		},
		{
			sessionId: "s-fail",
			parentSessionId: null,
			title: "Bisect the deploy",
			state: "failed",
			startedAt: "2026-11-05T11:01:00Z",
			endedAt: "2026-11-05T11:03:20Z",
		},
		{
			sessionId: "s-done",
			parentSessionId: null,
			title: "Readiness check",
			state: "completed",
			startedAt: "2026-11-05T11:02:00Z",
			endedAt: "2026-11-05T11:02:48Z",
		},
	],
	allowance: { grantedAt: "2026-11-05T11:00:00Z" },
	chainId: "t0",
	limits: {
		agentsStartThreads: "ask",
		perStarter: 4,
		total: 10,
		turnsPerDay: 200,
		pairPerDay: 20,
	},
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

const TOKENS = {
	input: 1800,
	output: 350,
	cacheRead: 0,
	cacheWrite: 0,
	total: 2150,
};
/** The Session section's usage in each state (#1176 D10). */
const USAGES: {
	caption: string;
	context: Parameters<typeof SessionSection>[0]["context"];
}[] = [
	{
		caption: "Usage, two currencies, a resumed session",
		context: {
			...base,
			usage: {
				context: { used: 48_000, size: 200_000, at: "2026-11-05T11:58:00Z" },
				turns: 3,
				tokens: TOKENS,
				costs: [
					{ amount: 0.15, currency: "USD" },
					{ amount: 1, currency: "EUR" },
				],
				unpricedTurns: 0,
			},
			session: {
				how: "resume",
				cause: "follow_up",
				harness: "claude-code",
				model: "opus",
			},
		},
	},
	{
		caption: "Context at 85% (warn), one turn unpriced, a new session",
		context: {
			...base,
			usage: {
				context: { used: 170_000, size: 200_000, at: "2026-11-05T11:58:00Z" },
				turns: 4,
				tokens: TOKENS,
				costs: [{ amount: 0.42, currency: "USD" }],
				unpricedTurns: 1,
			},
			session: {
				how: "new",
				cause: "follow_up",
				harness: "claude-code",
				model: "opus",
			},
		},
	},
	{
		caption: "Context at 95% (danger), no turn priced",
		context: {
			...base,
			usage: {
				context: { used: 190_000, size: 200_000, at: "2026-11-05T11:58:00Z" },
				turns: 2,
				tokens: TOKENS,
				costs: [],
				unpricedTurns: 2,
			},
			session: null,
		},
	},
	{
		caption: "Nothing reported, no session recorded",
		context: { ...base, session: null },
	},
];

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

const PROJECT = KINDS.find((k) => k.kind === "project") as Extract<
	ThreadContext,
	{ kind: "project" }
>;
/** The owner's Scripts: stored first with their menus, then what the folder declares; then none. */
const SCRIPT_KINDS: ThreadContext[] = [
	{
		...PROJECT,
		machine: { ...PROJECT.machine, isOwner: true },
		scripts: [
			{ runner: "custom", id: "s1", name: "seed", command: "pnpm db:seed" },
			...PROJECT.scripts,
		],
	},
	{ ...PROJECT, machine: { ...PROJECT.machine, isOwner: true }, scripts: [] },
];

const EDITOR_WORD: Record<EditorChoice, string> = {
	vscode: "VS Code",
	cursor: "Cursor",
	zed: "Zed",
	jetbrains: "JetBrains",
	sublime: "Sublime Text",
	system: "Files",
};
const openWithCtx = (
	owner: boolean,
	newBranch?: DetailsCtx["newBranch"],
): DetailsCtx => ({
	branch: null,
	host: "github",
	ask: noopFile,
	openPr: noopFile,
	openFolder: noopFile,
	openTerminal: noopFile,
	editor: { current: "vscode", label: (e) => EDITOR_WORD[e] },
	openIn: noopFile,
	...(newBranch ? { newBranch } : {}),
	facts: {
		is: {
			folder: true,
			terminal: true,
			notOwner: !owner,
			"has.vscode": true,
			"has.zed": true,
			...(newBranch ? { branchAndPush: true } : {}),
		},
	},
});
const detachedRows = (pushable: boolean) => {
	const ctx = openWithCtx(true, {
		name: "prismalens/acme-shop-1f2e",
		pushable,
	});
	return detailsRows({
		kind: "thread",
		machine: "build-box · Linux",
		place: { name: "acme/shop", path: "/work/pl-1f2e/repo" },
		detached: "9f3c2ab",
		changes: { added: 12, removed: 3 },
		folder: <DetailsFolder ctx={ctx} />,
		actions: <DetailsActions ctx={ctx} primary="branchAndPush" />,
	});
};

/** UI 2's states in the gallery (#1024). Only UI 2 edits this file. */
const noopFile = () => {};
/** A file that can revert, for the diff-file menu state. */
const DIFF_FILE_CTX: DiffFileCtx = {
	viewFile: noopFile,
	openEditor: noopFile,
	copyPath: noopFile,
	attach: noopFile,
	revert: noopFile,
	facts: { is: { revertable: true } },
};

const DIFF_TREE_CTX: DiffFileCtx = {
	...DIFF_FILE_CTX,
	openDiff: noopFile,
	facts: { is: { tree: true } },
};
const DIFF_LINE_CTX: DiffLineCtx = {
	comment: noopFile,
	quote: noopFile,
	copy: noopFile,
	openEditor: noopFile,
	viewFile: noopFile,
	facts: {},
};

const paneCtx = (shown: boolean): PaneCtx => ({
	show: noopFile,
	tile: noopFile,
	close: noopFile,
	widen: noopFile,
	link: "https://prismalens.local/threads/t1?panel=changes",
	facts: { is: { shown, tileable: !shown, widenable: true } },
});

export const panelGallery: GallerySection[] = [
	{
		id: "pane-tabs",
		title: "Pane tabs: right-click a tab to show, tile or link it",
		render: () => (
			<div className="h-[160px] w-full max-w-[360px]">
				<ThreadSidePanel
					tabs={[
						{ id: "thread", label: "Details" },
						{ id: "changes", label: "Changes" },
						{ id: "files", label: "Files" },
					]}
					tab="changes"
					onTab={noopFile}
					onClose={noopFile}
					content={null}
					paneCtx={(id) => paneCtx(id === "changes")}
				/>
			</div>
		),
	},
	{
		id: "pane-new-tab",
		title: "New tab: every tool with its key, Tile below, and a path to open",
		render: () => (
			<div className="flex h-[300px] w-full max-w-[420px] flex-col">
				<NewTabPage
					tools={[
						{
							id: "thread",
							label: "Details",
							detail: "Pull requests, child threads, steps",
							keys: ["Alt", "1"],
						},
						{
							id: "changes",
							label: "Changes",
							detail: "The diff, by turn or against base",
							keys: ["Alt", "2"],
						},
						{
							id: "files",
							label: "Files",
							detail: "The worktree's files",
							keys: ["Alt", "3"],
						},
						{
							id: "browser",
							label: "Browser",
							detail: "A browser you and the agent share",
							keys: ["Alt", "4"],
						},
						{
							id: "terminal",
							label: "Terminal",
							detail: "A shell on the host, below the thread",
							keys: ["Ctrl", "`"],
							unavailable: {
								why: "The terminal opens only on the host.",
								next: "Open PrismaLens on that machine, or use Copy on any command.",
							},
						},
					]}
					onOpen={noopFile}
					onTile={noopFile}
					onOpenPath={noopFile}
				/>
			</div>
		),
	},
	{
		id: "diff-tree-menu",
		title: "A changed file's row in the tree: right-click or Shift+F10",
		render: () => (
			<div className="flex h-[260px] justify-start">
				<SurfaceMore id="diff.tree" ctx={DIFF_TREE_CTX} open align="start" />
			</div>
		),
	},
	{
		id: "diff-line-menu",
		title: "A line of the diff: right-click",
		render: () => (
			<div className="flex h-[220px] justify-start">
				<SurfaceMore id="diff.line" ctx={DIFF_LINE_CTX} open align="start" />
			</div>
		),
	},
	{
		id: "diff-file-menu",
		title: "The open file's actions: ⋯ and right-click",
		render: () => (
			<div className="flex h-[260px] justify-start">
				<SurfaceMore id="diff.file" ctx={DIFF_FILE_CTX} open align="start" />
			</div>
		),
	},
	{
		id: "pr-tones",
		title: "Pull requests: every tone, each with its word",
		render: () => (
			<div className={box}>
				<PullRequestList prs={TONES} onOpen={() => undefined} />
			</div>
		),
	},
	{
		id: "pr-checks",
		title: "Pull requests: checks, review and a merge conflict",
		render: () => (
			<div className={box}>
				<PullRequestList prs={CHECKS} onOpen={() => undefined} />
			</div>
		),
	},
	{
		id: "pr-watch",
		title: "Pull requests: the watch line in each state",
		render: () => (
			<div className={box}>
				{WATCHES.map((watch, i) => (
					<div key={watch.state} className="h-[150px] overflow-hidden">
						<PrView
							pr={pr(300 + i, "open", { title: `Watch ${watch.state}`, watch })}
							onWatch={() => undefined}
						/>
					</div>
				))}
			</div>
		),
	},
	{
		id: "thread-links",
		title: "Details: started by, then sub-agents and started threads",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				<div className={box}>
					<p className="px-2 text-meta text-text-2">
						{startedHeading(startedCount(LINKS).running)}
					</p>
					<StartedSection
						links={LINKS}
						isHost
						harness="claude-code"
						onRevoke={() => undefined}
						onOpenSubagent={() => undefined}
					/>
				</div>
				<div className={box}>
					<p className="px-2 text-meta text-text-2">{startedHeading(0)}</p>
					<StartedSection
						links={{
							...LINKS,
							started: LINKS.started.filter((l) => l.state === "answered"),
							subagents: LINKS.subagents?.filter(
								(s) => s.state === "completed",
							),
							allowance: null,
						}}
						isHost
						harness="claude-code"
					/>
				</div>
			</div>
		),
	},
	{
		id: "details-failed",
		title: "Details: the context, threads and steps reads failed",
		render: () => (
			<div className={box}>
				<Problem text="Details didn't load" onRetry={() => undefined} />
				<Problem text="Threads didn't load" onRetry={() => undefined} />
				<Problem text="Steps didn't load" onRetry={() => undefined} />
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
		id: "session-usage",
		title: "Session: usage, context tone, cost and the session row",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				{USAGES.map((u) => (
					<div key={u.caption} className={box}>
						<p className="px-2 text-meta text-text-3">{u.caption}</p>
						<SessionSection context={u.context} />
					</div>
				))}
			</div>
		),
	},
	{
		id: "kind-scripts",
		title:
			"Project scripts: stored ones the owner changes, then detected; then none",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				{SCRIPT_KINDS.map((c) => (
					<div
						key={c.kind + String(c.kind === "project" && c.scripts.length)}
						className={box}
					>
						<KindTab context={c} />
					</div>
				))}
			</div>
		),
	},
	{
		id: "details-open-with",
		title:
			"Open with: the default in words, the rest behind the chevron (owner, then another device)",
		render: () => (
			<div className="flex flex-col gap-3">
				{[true, false].map((owner) => (
					<Surface
						key={String(owner)}
						id="thread.details"
						ctx={openWithCtx(owner)}
					>
						<div className="flex items-center gap-2">
							<DetailsFolder ctx={openWithCtx(owner)} />
							<SurfaceMore id="thread.details" ctx={openWithCtx(owner)} />
						</div>
					</Surface>
				))}
			</div>
		),
	},
	{
		id: "details-detached",
		title:
			"A detached worktree: its tip, and a branch to make (pushable, then not)",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				{[true, false].map((pushable) => (
					<div key={String(pushable)} className="w-full max-w-[280px]">
						<DetailsCard
							rows={detachedRows(pushable)}
							layout={DETAILS_LAYOUT.thread}
							height={BOX_H}
						/>
					</div>
				))}
			</div>
		),
	},
	{
		id: "machine",
		title: "Session: on the host, then from another machine",
		render: () => (
			<div className="grid gap-4 md:grid-cols-2">
				<div className={box}>
					<SessionSection
						context={base}
						session={{
							lastActivityAt: "2026-11-05T11:58:00Z",
							cache: "warm",
							compaction: "none",
						}}
					/>
				</div>
				<div className={box}>
					<SessionSection
						context={{
							...base,
							machine: { ...base.machine, isHost: false },
						}}
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
	// The browser pane keeps its states in its own file (#1061).
	...browserGallery,
];
