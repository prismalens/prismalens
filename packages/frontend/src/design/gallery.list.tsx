// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PendingAsk,
	ThreadRow,
	ThreadStatus,
	ThreadStatusInfo,
	ThreadUnit,
} from "@prismalens/contracts";
import { SurfaceMore } from "@/components/kit/Surface";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { ThreadMenu } from "@/components/shell/ThreadMenu";
import { StatusMark, ThreadTreeView } from "@/components/shell/ThreadTree";
import type { ThreadCtx } from "@/components/shell/thread.actions";
import { threadList } from "@/lib/thread-list";
import { STATUS_WORD } from "@/lib/thread-status";
import type { GallerySection } from "./gallery";

const NOW = Date.parse("2026-11-12T15:15:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

interface Fx {
	n: number;
	title: string;
	parent?: number;
	state: ThreadStatusInfo;
	ago: number;
	say: string;
	pr?: ThreadRow["pr"];
	seen?: boolean;
	settled?: boolean;
	pinned?: boolean;
	limit?: ThreadRow["limit"];
	error?: string;
}

const st = (status: ThreadStatus, extra: Partial<ThreadStatusInfo> = {}) => ({
	status,
	...extra,
});

/** The 40-thread fixture: six trees and single threads in every status (#1101 category 1). */
const FX: Fx[] = [
	{
		n: 1,
		title: "Checkout 502s after deploy",
		state: st("waiting", {
			waitingOn: {
				kind: "thread",
				id: uuid(3),
				title: "Bisect the deploy",
				more: 0,
			},
		}),
		ago: 3,
		say: "Two threads are still running.",
		seen: true,
	},
	{
		n: 2,
		parent: 1,
		title: "Restart the checkout pods",
		state: st("approval"),
		ago: 4,
		say: "A rolling restart clears the stuck connections.",
	},
	{
		n: 3,
		parent: 1,
		title: "Bisect the deploy",
		state: st("working"),
		ago: 0,
		say: "Testing commit 4 of 9.",
	},
	{
		n: 4,
		parent: 1,
		title: "Check replica lag",
		state: st("working", { quietSince: ago(14) }),
		ago: 14,
		say: "Waiting on the metrics query.",
	},
	{
		n: 5,
		parent: 1,
		title: "Draft the rollback PR",
		state: st("waiting", {
			waitingOn: { kind: "pr", number: 331, until: "checks_done" },
		}),
		ago: 6,
		say: "Watching its checks.",
		pr: { number: 331, tone: "failing" },
		seen: true,
	},
	{
		n: 6,
		parent: 3,
		title: "Which commit changed maxIdle?",
		state: st("question"),
		ago: 2,
		say: "Which should I test first?",
	},
	{
		n: 7,
		parent: 1,
		title: "Summarise the timeline",
		state: st("done"),
		ago: 9,
		say: "Deploy at 13:58, errors from 14:01.",
	},
	...[8, 9, 10].map((n) => ({
		n,
		parent: 1,
		title: `Collect error samples ${n - 7}`,
		state: st("done"),
		ago: 20 + n,
		say: "Saved the traces.",
		seen: true,
	})),
	{
		n: 11,
		title: "Flaky test in payments",
		state: st("done"),
		ago: 8,
		say: "Three threads chase the flake.",
		pinned: true,
		seen: true,
	},
	{
		n: 12,
		parent: 11,
		title: "Run the suite 50 times",
		state: st("question"),
		ago: 5,
		say: "Race detector on?",
	},
	{
		n: 13,
		parent: 11,
		title: "Rerun under load",
		state: st("failed"),
		ago: 11,
		say: "",
		error: "The load generator exited with code 137.",
	},
	{
		n: 14,
		parent: 11,
		title: "Watch the nightly run",
		state: st("waiting", {
			waitingOn: { kind: "cron", schedule: "*/30 * * * *", nextAt: ago(-14) },
		}),
		ago: 16,
		say: "Checking every 30 minutes.",
		seen: true,
	},
	{
		n: 15,
		parent: 11,
		title: "Retry after the cache warms",
		state: st("waiting", { waitingOn: { kind: "wake", at: ago(-35) } }),
		ago: 12,
		say: "Looking again later.",
		seen: true,
	},
	{
		n: 16,
		title: "Nightly dependency upgrade",
		state: st("limited", { mode: "usage_limit" }),
		ago: 20,
		say: "Hit the usage limit.",
		limit: { resetsAt: ago(-47), mode: "usage_limit", nextAttemptAt: ago(-47) },
	},
	{
		n: 17,
		parent: 16,
		title: "Upgrade the API client",
		state: st("blocked", { mode: "key_rejected" }),
		ago: 22,
		say: "",
		limit: { resetsAt: null, mode: "key_rejected" },
	},
	{
		n: 18,
		parent: 16,
		title: "Run the type checks",
		state: st("working"),
		ago: 1,
		say: "Type checking 412 files.",
	},
	{
		n: 19,
		title: "Release notes draft",
		state: st("waiting", { waitingOn: { kind: "wake", at: ago(-90) } }),
		ago: 18,
		say: "Waking at the release cut.",
		pr: { number: 412, tone: "draft" },
		seen: true,
	},
	{
		n: 20,
		parent: 19,
		title: "Write the upgrade notes",
		state: st("working"),
		ago: 0,
		say: "Writing the retry section.",
	},
	{
		n: 21,
		title: "Rotate the staging secrets",
		state: st("approval"),
		ago: 2,
		say: "Needs to write the vault.",
	},
	{
		n: 22,
		title: "Why is the build cache cold?",
		state: st("working"),
		ago: 0,
		say: "Comparing cache keys.",
	},
	{
		n: 23,
		title: "Docs cleanup",
		state: st("done"),
		ago: 45,
		say: "Removed 12 dead links.",
	},
	{
		n: 24,
		title: "Profile the search endpoint",
		state: st("failed"),
		ago: 26,
		say: "",
		error: "The profiler could not attach.",
		seen: true,
	},
	{
		n: 25,
		title: "Investigate latency regression",
		state: st("blocked", { paused: true }),
		ago: 33,
		say: "Automatic updates paused.",
	},
	...Array.from({ length: 8 }, (_, i) => ({
		n: 26 + i,
		title: `Plan step ${i + 1}`,
		parent: i ? 26 : undefined,
		state: st("done"),
		ago: 95 + i,
		say: "Done.",
		seen: true,
	})),
	...Array.from({ length: 7 }, (_, i) => ({
		n: 34 + i,
		title: `Old: housekeeping ${i + 1}`,
		state: st("done"),
		ago: 4000 + i * 900,
		say: "Done.",
		seen: true,
		settled: true,
	})),
];

const BRANCHES = [
	"fix/checkout-pool-size",
	"feat/orders-index-restore-concurrently",
	"agent/flaky-payments-retry",
];

function row(f: Fx): ThreadRow {
	const root = (() => {
		let at = f;
		while (at.parent) at = FX.find((x) => x.n === at.parent) as Fx;
		return at.n;
	})();
	const inTree = !!f.parent || FX.some((x) => x.parent === f.n);
	const depth = (() => {
		let d = 0;
		let at = f;
		while (at.parent) {
			d++;
			at = FX.find((x) => x.n === at.parent) as Fx;
		}
		return d;
	})();
	return {
		id: uuid(f.n),
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: null,
		subject: "none",
		status:
			f.state.status === "working"
				? "running"
				: f.state.status === "failed"
					? "failed"
					: "completed",
		kind: "chat",
		title: f.title,
		accessLevel: "supervised",
		harness: f.n % 5 === 0 ? "codex" : "claude-code",
		model: f.n % 5 === 0 ? "gpt-6.1" : "claude-opus-5-5",
		// Every other thread works on a branch; the running ones also have a change request (#1105).
		branch: f.n % 2 === 1 ? BRANCHES[f.n % BRANCHES.length] : null,
		effort: null,
		startedAt: ago(f.ago + 20),
		completedAt: null,
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		error: f.error ?? null,
		awaitingApprovalAt: null,
		origin: "local",
		schemaVersion: 1,
		createdAt: ago(f.ago + 30),
		updatedAt: ago(f.ago),
		section: f.settled ? "settled" : "active",
		lastActivityAt: ago(f.ago),
		lastVisitedAt: f.seen ? ago(f.ago - 1) : null,
		settledAt: f.settled ? ago(f.ago - 1) : null,
		unseen: !f.seen,
		latestText: f.say || null,
		projectName: null,
		titleSetBy: "agent",
		serviceName: null,
		waitingAsk: null,
		limit: f.limit ?? null,
		paused: f.state.paused ? { reason: "ceiling", since: ago(f.ago) } : null,
		tree: inTree
			? {
					rootId: uuid(root),
					parentId: f.parent ? uuid(f.parent) : null,
					role: null,
					depth,
				}
			: null,
		state: f.state,
		pinnedAt: f.pinned ? ago(1) : null,
		archivedAt: null,
		...(f.pr
			? { pr: f.pr }
			: f.state.status === "working"
				? { pr: { number: 400 + f.n, tone: "failing", count: 2 } }
				: f.state.status === "limited"
					? { pr: { number: 400 + f.n, tone: "draft" } }
					: {}),
	} as ThreadRow;
}

function units(): ThreadUnit[] {
	const rows = FX.map(row);
	const byRoot = new Map<string, ThreadRow[]>();
	for (const r of rows) {
		const key = r.tree?.rootId ?? r.id;
		byRoot.set(key, [...(byRoot.get(key) ?? []), r]);
	}
	return Array.from(byRoot.values()).map((threads: ThreadRow[]) => ({
		section: threads.some((t) => t.section === "settled")
			? "settled"
			: "active",
		incident: null,
		threads,
	}));
}

const ask = (
	n: number,
	kind: "permission" | "question",
	title: string,
	command?: string,
): RowAskEntry => ({
	ended: false,
	accessLevel: "supervised",
	ask: {
		askId: uuid(900 + n),
		threadId: uuid(n),
		kind,
		requiresHost: false,
		source: { kind: "agent" },
		title,
		openedAt: ago(4),
		...(kind === "permission"
			? {
					permission: {
						toolKind: "execute",
						command,
						pattern: "kubectl rollout *",
						identity: "x",
						options: [],
					},
				}
			: {
					questions: [
						{
							id: "q",
							prompt: title,
							multiSelect: false,
							allowOther: false,
							options: [
								{ id: "a", label: "The pool commit" },
								{ id: "b", label: "The retry commit" },
							],
						},
					],
				}),
	} as PendingAsk,
});

const ASKS = new Map<string, RowAskEntry[]>([
	[
		uuid(2),
		[
			ask(
				2,
				"permission",
				"Run kubectl",
				"kubectl rollout restart deploy/checkout -n prod",
			),
		],
	],
	[uuid(6), [ask(6, "question", "Which commit changed maxIdle?")]],
	[uuid(12), [ask(12, "question", "Run it with the race detector on?")]],
	[
		uuid(21),
		[
			ask(
				21,
				"permission",
				"Run vault",
				"vault kv put secret/staging/api key=@new-key.txt",
			),
		],
	],
]);

const MODEL = threadList(units(), undefined, 7);

/** The thread list, statuses, a row's ask and the thread menu (#1101 categories 1, 2, 8, 20). */
export const listGallery: GallerySection[] = [
	{
		id: "thread-statuses",
		title: "Thread statuses: word, shape and colour",
		render: () => (
			<ul className="flex flex-wrap gap-4" data-testid="gallery-statuses">
				{(Object.keys(STATUS_WORD) as ThreadStatus[]).map((s) => (
					<li key={s} className="flex items-center gap-1.5 text-body">
						<StatusMark status={s} />
						{STATUS_WORD[s]}
					</li>
				))}
			</ul>
		),
	},
	{
		id: "thread-list-collapsed",
		title: "Thread list, 40 threads, roots collapsed",
		render: () => (
			<div
				className="w-[300px] bg-surface-1 py-2"
				data-testid="gallery-list-collapsed"
			>
				<ThreadTreeView
					model={MODEL}
					asks={ASKS}
					now={NOW}
					currentId={null}
					onSettle={() => {}}
				/>
			</div>
		),
	},
	{
		id: "thread-list-expanded",
		title: "Thread list, every root expanded, Settled open",
		render: () => (
			<div
				className="w-[300px] bg-surface-1 py-2"
				data-testid="gallery-list-expanded"
			>
				<ThreadTreeView
					model={MODEL}
					asks={ASKS}
					now={NOW}
					currentId={uuid(3)}
					onSettle={() => {}}
					expandAll
				/>
			</div>
		),
	},
	{
		id: "thread-menu",
		title: "Row menu: Rename, Pin, Archive, Settle",
		render: () => (
			<div
				className="flex h-[220px] justify-end"
				data-testid="gallery-thread-menu"
			>
				<ThreadMenu thread={row(FX[2] as Fx)} where="row" onSettle={() => {}} />
			</div>
		),
	},
	{
		id: "thread-header-menu",
		title: "Header menu: Rename, Settle, Archive",
		render: () => (
			<div className="flex h-[200px] justify-end">
				<ThreadMenu thread={row(FX[2] as Fx)} onSettle={() => {}} defaultOpen />
			</div>
		),
	},
	{
		id: "thread-result-menu",
		title: "A palette result's actions (Alt+Enter)",
		render: () => (
			<div className="flex h-[300px] justify-start">
				<SurfaceMore id="thread.result" ctx={RESULT_CTX} open align="start" />
			</div>
		),
	},
];

const noop = () => {};
/** A standalone, unpinned thread that can settle. */
const RESULT_CTX: ThreadCtx = {
	rename: noop,
	nameAgain: noop,
	togglePin: noop,
	toggleArchive: noop,
	settle: noop,
	open: noop,
	openWithPanel: noop,
	copyTranscript: noop,
	copyLink: noop,
	facts: { is: { settleable: true, standalone: true } },
};
