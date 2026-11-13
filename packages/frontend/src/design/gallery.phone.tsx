// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PendingAsk } from "@prismalens/contracts";
import type { ReactNode } from "react";
import type { CardAnswer, CardAnswers } from "@/components/home/PhoneAnswer";
import { PhoneHomeView } from "@/components/home/PhoneHome";
import { Mark } from "@/components/kit/Mark";
import { statusWord } from "@/components/kit/Status";
import { ConnectionWordView } from "@/components/shell/ConnectionWord";
import type { RowAskEntry } from "@/components/shell/RowAsk";
import { AskDock } from "@/components/thread/composer/AskDock";
import { connectionWord } from "@/lib/connection-word";
import type { HomeItem } from "@/lib/phone-home";
import type { GallerySection } from "./gallery";

const NOW = Date.parse("2026-11-12T15:15:00Z");
const clock = () => "2:02 PM";
const THREAD = "00000000-0000-4000-8000-000000000001";

/** A 390 px frame: the width the phone states hold at (#1101 category 5). */
function Phone({ children }: { children: ReactNode }) {
	return (
		<div className="w-[390px] max-w-full overflow-hidden rounded-[10px] bg-canvas">
			{children}
		</div>
	);
}

function Strip({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-12 items-center gap-1 bg-canvas px-2">
			<span className="flex size-12 items-center justify-center text-meta text-text-3">
				Menu
			</span>
			{children}
			<Mark id="ask" state="approval" word="3 waiting for you">
				<span className="text-meta font-medium text-text-1">3</span>
			</Mark>
			<span className="flex size-12 items-center justify-center text-meta text-text-3">
				New
			</span>
		</div>
	);
}

const WORDS = [
	connectionWord({ connected: true, lostAt: 0 }, NOW, true, clock),
	connectionWord({ connected: false, lostAt: NOW - 12_000 }, NOW, true, clock),
	connectionWord({ connected: false, lostAt: NOW - 600_000 }, NOW, true, clock),
];

const item = (
	n: number,
	status: HomeItem["status"],
	title: string,
	line: string | null,
	min: number,
	needs: boolean,
): HomeItem => ({
	id: `t-${n}`,
	title,
	status,
	word: statusWord(status),
	line,
	context: n % 2 ? "checkout-api" : null,
	at: NOW - min * 60_000,
	needs,
	link: { to: "/threads/$id", params: { id: THREAD } },
});

const NEEDS: HomeItem[] = [
	item(
		1,
		"approval",
		"502s on checkout",
		"Run kubectl rollout restart",
		2,
		true,
	),
	item(
		2,
		"question",
		"Slow search after deploy",
		"Which environment?",
		9,
		true,
	),
	item(3, "limited", "Nightly dependency check", "Resets at 3:40 PM", 25, true),
	item(4, "blocked", "Watch PR #331", "Automatic updates paused", 40, true),
	item(5, "failed", "Cache hit rate drop", "Agent not signed in", 70, true),
];
const REST: HomeItem[] = [
	item(
		6,
		"working",
		"Disk pressure on db-2",
		"Reading the slow query log",
		1,
		false,
	),
	item(7, "waiting", "Release notes", "Watching PR #340 checks", 15, false),
	item(
		8,
		"done",
		"Memory leak in worker",
		"Answer: a retained listener",
		300,
		false,
	),
];

const ask = (over: Partial<PendingAsk>): PendingAsk => ({
	askId: `ask-${over.title ?? "q"}`,
	threadId: THREAD,
	kind: "question",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Which environment should I check?",
	openedAt: "2026-11-12T15:10:00.000Z",
	...over,
});

const QUESTION = ask({
	questions: [
		{
			id: "env",
			prompt: "Which environment should I check?",
			multiSelect: false,
			allowOther: true,
			options: [
				{ id: "prod", label: "Production" },
				{ id: "staging", label: "Staging" },
			],
		},
	],
});
const APPROVAL = ask({
	kind: "permission",
	title: "Run kubectl rollout restart deploy/api",
	detail: "kubectl rollout restart deploy/api",
	permission: {
		toolKind: "execute",
		options: [
			{ optionId: "a", name: "Allow", kind: "allow_once" },
			{ optionId: "d", name: "Deny", kind: "reject_once" },
		],
	},
});
const TOOL = ask({ ...APPROVAL, askId: "ask-tool", requiresHost: true });

function Card({ children }: { children: ReactNode }) {
	return (
		<Phone>
			<div className="m-3 rounded-[10px] bg-surface-3 px-3 pt-2.5 pb-2">
				{children}
			</div>
		</Phone>
	);
}

/** Approve from the card: one row per answer phase, each on its own approval. */
const CARD_ROWS: HomeItem[] = [
	item(
		11,
		"approval",
		"502s on checkout",
		"Run kubectl rollout restart",
		2,
		true,
	),
	item(12, "approval", "Disk pressure on db-2", "Delete /var/log/old", 4, true),
	item(13, "approval", "Release notes", "Tag v0.6.0", 6, true),
	item(14, "approval", "Cache hit rate drop", "Restart redis-0", 8, true),
].map((i) => ({ ...i, id: `card-${i.id}` }));
const entryOf = (i: HomeItem): RowAskEntry => ({
	ask: {
		...APPROVAL,
		askId: `ask-${i.id}`,
		threadId: i.id,
		title: i.line ?? "",
	},
	ended: false,
	accessLevel: null,
});
const CARD_ASKS = new Map(CARD_ROWS.map((i) => [i.id, [entryOf(i)]]));
const sent = (i: HomeItem, over: Omit<CardAnswer, "entry">): CardAnswer => ({
	entry: entryOf(i),
	...over,
});
const [, SENDING, DELIVERED, FAILED] = CARD_ROWS as [
	HomeItem,
	HomeItem,
	HomeItem,
	HomeItem,
];
const CARD_ANSWERS: CardAnswers = {
	onHost: true,
	send: () => {},
	byThread: {
		[SENDING.id]: sent(SENDING, { decision: "approve", phase: "sending" }),
		[DELIVERED.id]: sent(DELIVERED, {
			decision: "approve",
			phase: "delivered",
		}),
		[FAILED.id]: sent(FAILED, {
			decision: "deny",
			phase: "failed",
			error: "The host did not answer",
		}),
	},
};

/** The phone's states (#1101 category 5): header word, Home, and the ask card. */
export const phoneGallery: GallerySection[] = [
	{
		id: "phone-connection",
		title: "Phone header connection word",
		render: () => (
			<div className="grid grid-cols-[minmax(0,1fr)] gap-3">
				{WORDS.map((w) => (
					<Phone key={w.state}>
						<Strip>
							<ConnectionWordView word={w} />
						</Strip>
						{w.reason && (
							<p className="bg-surface-1 px-4 py-1.5 text-meta text-text-2">
								{w.reason}
							</p>
						)}
					</Phone>
				))}
			</div>
		),
	},
	{
		id: "phone-home",
		title: "Phone Home, needs you first",
		render: () => (
			<div className="grid grid-cols-[minmax(0,1fr)] gap-3">
				<Phone>
					<div className="h-[720px]">
						<PhoneHomeView
							loading={false}
							needs={NEEDS}
							rest={REST}
							more={12}
							now={NOW}
						/>
					</div>
				</Phone>
				<Phone>
					<div className="h-[260px]">
						<PhoneHomeView
							loading={false}
							needs={[]}
							rest={REST.slice(0, 2)}
							more={0}
							now={NOW}
						/>
					</div>
				</Phone>
			</div>
		),
	},
	{
		id: "phone-card-answer",
		title: "Phone Home, approve from the card",
		render: () => (
			<Phone>
				<div className="h-[620px]">
					<PhoneHomeView
						loading={false}
						needs={CARD_ROWS}
						rest={[]}
						more={0}
						now={NOW}
						asks={CARD_ASKS}
						answers={CARD_ANSWERS}
					/>
				</div>
			</Phone>
		),
	},
	{
		id: "phone-ask",
		title: "Phone ask card",
		render: () => (
			<div className="grid grid-cols-[minmax(0,1fr)] gap-3">
				<Card>
					<AskDock asks={[QUESTION]} threadId={THREAD} agent="Codex" onHost />
				</Card>
				<Card>
					<AskDock asks={[APPROVAL]} threadId={THREAD} agent="Codex" onHost />
				</Card>
				<Card>
					<AskDock
						asks={[APPROVAL]}
						threadId={THREAD}
						agent="Codex"
						onHost={false}
						hostOnlyRun
					/>
				</Card>
				<Card>
					<AskDock
						asks={[TOOL]}
						threadId={THREAD}
						agent="Codex"
						onHost={false}
					/>
				</Card>
			</div>
		),
	},
];
