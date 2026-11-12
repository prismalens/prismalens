// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadSession } from "@prismalens/contracts";
import { InboundRowView } from "@/components/investigation/transcript/InboundRow";
import { LimitDock } from "@/components/thread/session/LimitDock";
import {
	ConnectionDock,
	InterruptedDock,
} from "@/components/thread/session/StopDocks";
import type { InboundRow } from "@/lib/inbound-rows";
import type { GallerySection } from "./gallery";

type Stop = NonNullable<ThreadSession["limit"]>;

const NOW = Date.parse("2026-11-12T15:15:00Z");
const at = (min: number) => new Date(NOW + min * 60_000).toISOString();
const clock = (iso: string) => iso.slice(11, 16);
const noop = () => {};
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

const LIMIT_FAILURE = { mode: "usage_limit", window: "session" } as const;
const inbound = (
	n: number,
	state: InboundRow["state"],
	text: string,
	extra: Partial<InboundRow> = {},
): InboundRow => ({
	messageId: `m${n}`,
	source: "child",
	state,
	arrivedAt: new Date(NOW - (5 - n) * 60_000).toISOString(),
	from: { name: `Check ${n}`, link: "#" },
	text,
	line: "Waiting: OpenCode reached its session limit",
	retries: [],
	...extra,
});
/** Three child reports under a usage limit: the reason is the stop line's, said once (sheet §10). */
const LIMIT_INBOUND: InboundRow[] = [
	inbound(
		1,
		"waiting",
		"[FROM checkout-tests #1] result: **2 tests** flake in `C:\\Users\\me\\ws\\worktrees\\pl-1\\test\\cart.spec.ts`",
		{ failure: LIMIT_FAILURE },
	),
	inbound(2, "waiting", "/threads/0b1 ## Done\n- no flake in payments", {
		failure: LIMIT_FAILURE,
	}),
	inbound(3, "delivered", "All three checks pass after the retry.", {
		line: "Delivered",
	}),
	inbound(4, "failed", "Report the flaky tests", {
		line: "Not delivered: the thread has ended",
	}),
];

/** UI 3's states in the gallery (#1024, #1101). Only UI 3 edits this file. */
export const appGallery: GallerySection[] = [
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
							now={NOW}
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
				<div
					className="flex flex-col gap-1"
					data-testid="gallery-limit-inbound"
				>
					<span className="text-meta text-text-3">
						Incoming messages during a limit
					</span>
					<ul className="flex flex-col gap-1">
						{LIMIT_INBOUND.map((r) => (
							<InboundRowView key={r.messageId} row={r} />
						))}
					</ul>
				</div>
				<div className="flex flex-col gap-1">
					<span className="text-meta text-text-3">Connection lost</span>
					<ConnectionDock fixedAsOf={NOW} />
				</div>
			</div>
		),
	},
];
