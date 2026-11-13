// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	type AttentionEvent,
	type AttentionKind,
	type AttentionThread,
	type AwayView,
	DEFAULT_NOTIFY_PREFS,
	type PendingAsk,
} from "@prismalens/contracts";
import { EventListView } from "@/components/attention/EventList";
import {
	AwayDigestCard,
	AwayFold,
	AwayList,
	digestLines,
} from "@/components/home/AwayView";
import { HomeNeeds } from "@/components/home/HomeHandover";
import { unseenLabel } from "@/components/investigation/unseen.surface";
import { UnseenDivider } from "@/components/investigation/WindowedTranscript";
import { NotifyChoicesView } from "@/components/settings/NotifyChoices";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import {
	type AutoDecision,
	DecidedList,
} from "@/components/thread/composer/AskDock";
import {
	Toast,
	ToastDescription,
	ToastProvider,
	ToastTitle,
	ToastViewport,
} from "@/components/ui/toast";
import type { PermissionState } from "@/lib/attention/permission";
import type { GallerySection } from "./gallery";
import { LIST_FIXTURE } from "./gallery.list";

const NOW = Date.parse("2026-11-12T06:15:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(700 + n).padStart(12, "0")}`;

const thread = (
	n: number,
	title: string,
	more: Partial<AttentionThread> = {},
): AttentionThread => ({
	id: uuid(n),
	title,
	kind: "chat",
	startedBy: null,
	incident: null,
	cause: null,
	nextCommand: null,
	answer: null,
	error: null,
	endReason: null,
	status: "done",
	follow: null,
	...more,
});

const event = (
	n: number,
	kind: AttentionKind,
	t: AttentionThread,
	hoursAgo: number,
	more: Partial<AttentionEvent> = {},
): AttentionEvent => ({
	id: `e${n}`,
	threadId: t.id,
	kind,
	detail: null,
	resetsAt: null,
	at: at(hoursAgo),
	readAt: null,
	notify: true,
	silenced: false,
	thread: t,
	...more,
});

const INCIDENT = thread(1, "Checkout 502s after deploy", {
	kind: "investigation",
	incident: { id: uuid(90), number: 41, severity: "high" },
	cause: "v2.14.1 cut the checkout DB pool from 50 to 5 connections.",
	nextCommand: "kubectl set env deploy/checkout -n prod DB_POOL_SIZE=50",
});
const RESTART = thread(2, "Restart the checkout pods", {
	startedBy: { id: uuid(1), title: INCIDENT.title },
	status: "approval",
});
const BISECT = thread(3, "Bisect the deploy", {
	startedBy: { id: uuid(1), title: INCIDENT.title },
	answer: "Found it: 3f2a1c9 changes DB_POOL_SIZE from 50 to 5.",
});
const RETRY = thread(4, "Refactor the retry helper", {
	answer: "Done: retries now back off with jitter, and all 212 tests pass.",
});
const SDK = thread(5, "Upgrade the payment SDK", { status: "limited" });
const FLAKY = thread(6, "Nightly flaky test triage", { status: "blocked" });
const CRON = thread(7, "Migrate the cron jobs", {
	status: "failed",
	answer: "The new scheduler refused the 03:00 job: its timezone is missing.",
});

const EVENTS: AttentionEvent[] = [
	event(1, "needs_you", RESTART, 4, { detail: "Run kubectl" }),
	event(2, "finished", INCIDENT, 5),
	event(3, "finished", BISECT, 6, { notify: false }),
	event(4, "failed", CRON, 2),
	event(5, "blocked", FLAKY, 3, { detail: "key_rejected" }),
	event(6, "limited", SDK, 4, {
		detail: "usage_limit",
		resetsAt: new Date(NOW + 47 * 60_000).toISOString(),
	}),
	event(7, "finished", RETRY, 8, { readAt: at(1) }),
];

const AWAY: AwayView = {
	since: at(9),
	long: false,
	groups: [
		{
			root: INCIDENT,
			threads: [
				{ thread: INCIDENT, events: [EVENTS[1] as AttentionEvent] },
				{ thread: RESTART, events: [EVENTS[0] as AttentionEvent] },
				{ thread: BISECT, events: [EVENTS[2] as AttentionEvent] },
			],
		},
		{
			root: CRON,
			threads: [{ thread: CRON, events: [EVENTS[3] as AttentionEvent] }],
		},
		{
			root: FLAKY,
			threads: [{ thread: FLAKY, events: [EVENTS[4] as AttentionEvent] }],
		},
		{
			root: SDK,
			threads: [{ thread: SDK, events: [EVENTS[5] as AttentionEvent] }],
		},
		{
			root: RETRY,
			threads: [{ thread: RETRY, events: [EVENTS[6] as AttentionEvent] }],
		},
	],
};

const RESTART_ASK: RowAskEntry = {
	ended: false,
	accessLevel: "supervised",
	ask: {
		askId: uuid(50),
		threadId: RESTART.id,
		kind: "permission",
		requiresHost: false,
		source: { kind: "agent" },
		title: "Run kubectl",
		openedAt: at(4),
		permission: {
			toolKind: "execute",
			command: "kubectl rollout restart deploy/checkout -n prod",
			pattern: "kubectl rollout *",
			identity: "x",
			options: [],
		},
	} as PendingAsk,
};

const PERMISSIONS: PermissionState[] = [
	"default",
	"granted",
	"denied",
	"insecure",
	"unsupported",
];

const noop = () => {};

const DECIDED: AutoDecision[] = [
	{
		key: "d1",
		at: "2026-11-12T10:42:00Z",
		title: "pnpm test --filter api",
		toolKind: "execute",
		outcome: "approved",
		why: "mode",
	},
	{
		key: "d2",
		at: "2026-11-12T10:41:00Z",
		title: "Switch to plan mode",
		toolKind: "switch_mode",
		outcome: "blocked",
		why: "mode-kept",
	},
	{
		key: "d3",
		at: "2026-11-12T10:39:00Z",
		title: "Edit src/pool.ts",
		toolKind: "edit",
		outcome: "approved",
		why: "mode",
	},
	{
		key: "d4",
		at: "2026-11-12T10:37:00Z",
		title: "curl -s https://status.example.com",
		toolKind: "fetch",
		outcome: "approved",
		why: "mode",
	},
];

export const attentionGallery: GallerySection[] = [
	{
		id: "composer-decided",
		title: "Decided for you: folded, then open",
		render: () => (
			<div className="grid max-w-[760px] gap-3">
				<DecidedList decided={DECIDED} />
				<DecidedList decided={DECIDED} open />
			</div>
		),
	},
	{
		id: "home-handover",
		title: "Home's handover: what needs you, then what changed",
		render: () => (
			<div
				className="flex max-w-[680px] flex-col gap-6"
				data-testid="gallery-home-handover"
			>
				<HomeNeeds
					needs={LIST_FIXTURE.model.needs}
					count={LIST_FIXTURE.model.needsCount}
					asks={LIST_FIXTURE.asks}
					now={LIST_FIXTURE.now}
				/>
				<AwayDigestCard
					since={AWAY.since}
					lines={digestLines(AWAY)}
					now={NOW}
				/>
			</div>
		),
	},
	{
		id: "home-needs-fixes",
		title: "Needs you by urgency, each card with its status's registered fix",
		render: () => {
			// One card per status and cause, so every fix in `needs.card` is drawn.
			const seen = new Set<string>();
			const one = LIST_FIXTURE.model.needs.filter((n) => {
				const key = `${n.info.status}:${n.info.mode ?? n.thread.limit?.mode ?? ""}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			return (
				<div
					className="flex max-w-[680px] flex-col gap-3"
					data-testid="gallery-home-needs-fixes"
				>
					<HomeNeeds
						needs={one}
						count={one.length}
						asks={LIST_FIXTURE.asks}
						now={LIST_FIXTURE.now}
					/>
				</div>
			);
		},
	},
	{
		id: "away-fold",
		title: "Home's away view, folded",
		render: () => (
			<div className="max-w-[640px]" data-testid="gallery-away-fold">
				<AwayFold data={AWAY} now={NOW} onOpen={noop} />
			</div>
		),
	},
	{
		id: "away-list",
		title: "Home after a short time away: changes by thread, under each root",
		render: () => (
			<div className="max-w-[640px]" data-testid="gallery-away-list">
				<AwayList data={AWAY} asks={[]} now={NOW} onMarkAll={noop} />
			</div>
		),
	},
	{
		id: "away-cards",
		title:
			"Home after a night away: a card per thread, the ask answerable inside",
		render: () => (
			<div className="max-w-[640px]" data-testid="gallery-away-cards">
				<AwayList
					data={{ ...AWAY, long: true }}
					asks={[RESTART_ASK]}
					now={NOW}
					onMarkAll={noop}
				/>
			</div>
		),
	},
	{
		id: "unseen-divider",
		title: "A thread opened at its first unseen event",
		render: () => (
			<div
				className="flex max-w-[640px] flex-col gap-3 text-body"
				data-testid="gallery-unseen-divider"
			>
				<p className="text-text-2">Starting with the call sites in billing.</p>
				<UnseenDivider label={unseenLabel(2, "20:41")} />
				<p>Moved 14 call sites to the new helper.</p>
				<p>Done: retries now back off with jitter, and all 212 tests pass.</p>
			</div>
		),
	},
	{
		id: "event-list",
		title: "The event list, Unread",
		render: () => (
			<div
				className="w-full max-w-[360px] rounded-surface bg-surface-1"
				data-testid="gallery-event-list"
			>
				<EventListView
					filter="unread"
					onFilter={noop}
					events={EVENTS.filter((e) => !e.readAt)}
					loading={false}
					unread={6}
					onMarkAll={noop}
					onOpenEvent={noop}
					now={NOW}
				/>
			</div>
		),
	},
	{
		id: "attention-toast",
		title: "A toast for another thread's event",
		render: () => (
			<div className="relative h-56 max-w-full overflow-hidden [contain:paint]">
				{/* Paint containment keeps the fixed toast list inside this stage, as the screen holds it. */}
				<ToastProvider>
					<Toast open variant="neutral" duration={Number.POSITIVE_INFINITY}>
						<div className="flex min-w-0 flex-col">
							<ToastTitle>Needs you: Restart the checkout pods</ToastTitle>
							<ToastDescription>Run kubectl</ToastDescription>
						</div>
					</Toast>
					<Toast open variant="default" duration={Number.POSITIVE_INFINITY}>
						<div className="flex min-w-0 flex-col">
							<ToastTitle>
								High · Finished: Checkout 502s after deploy
							</ToastTitle>
							<ToastDescription>
								Likely cause: v2.14.1 cut the checkout DB pool from 50 to 5.
							</ToastDescription>
						</div>
					</Toast>
					{/* No hotkey and its own name: the app's viewport keeps F8 and "Notifications". */}
					<ToastViewport
						className="relative w-[420px]"
						data-testid="gallery-attention-toast"
						label="Example toasts"
						hotkey={[]}
					/>
				</ToastProvider>
			</div>
		),
	},
	...PERMISSIONS.map((p) => ({
		id: `notify-${p}`,
		title: `Notifications, browser permission: $p`,
		render: () => (
			<div className="max-w-[720px]" data-testid={`gallery-notify-$p`}>
				<NotifyChoicesView
					prefs={DEFAULT_NOTIFY_PREFS}
					onChange={noop}
					permission={p}
					onAllow={noop}
				/>
			</div>
		),
	})),
];
