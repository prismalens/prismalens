// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Tool rows, child threads and context (#1101 cat 9-11): their states from fixtures. */
import type { CanonicalEvent } from "@prismalens/contracts";
import { Transcript } from "@/components/investigation/Transcript";
import { TurnEnd, TurnVerdict } from "@/components/investigation/TurnEnd";
import {
	ChildFinishedCard,
	ChildRow,
	ThreadMessageCard,
} from "@/components/investigation/transcript/ChildCards";
import { CompactionDivider } from "@/components/investigation/transcript/CompactionDivider";
import { TranscriptNode } from "@/components/investigation/transcript/registry";
import type { RunStep } from "@/components/run/run-steps";
import { StepCard } from "@/components/run/StepCard";
import { SubagentNode } from "@/components/thread/SubagentNode";
import {
	ContextMeter,
	ContextTable,
} from "@/components/thread/session/ContextMeter";
import { contextBreakdown } from "@/lib/context-breakdown";
import type { TranscriptItem } from "@/lib/investigation-events";
import type { SubagentView } from "@/lib/subagents";
import { turnSummary } from "@/lib/turn-summary";
import type { GallerySection } from "./gallery";

const AT = "2026-11-05T12:00:00Z";
const base = {
	runId: "11111111-1111-4111-8111-111111111111",
	branchId: "run",
	path: [],
	ts: AT,
};

const step = (n: number, p: Partial<RunStep> = {}): RunStep => ({
	n,
	callId: `c${n}`,
	title: `rg -n "index" services/api`,
	command: `rg -n "index" services/api`,
	kind: "command",
	node: "command",
	verb: "Ran",
	ok: true,
	unfinished: false,
	output: "services/api/list.ts:42: dropIndex('orders_created_at')",
	at: AT,
	took: 0.4,
	input: null,
	...p,
});

/** A turn's last test run, as the verdict reads it (#1110). */
const testRun = (ok: boolean, output: string) =>
	step(9, { command: "pnpm vitest run", run: "pnpm vitest run", ok, output });
const CLEAN_FILES = [
	{ path: "services/api/src/orders/list.ts", add: 12, del: 4 },
	{ path: "services/api/src/orders/list.test.ts", add: 18, del: 0 },
	{ path: "pnpm-lock.yaml", add: 140, del: 96 },
];
const RISKY_FILES = [
	{
		path: "services/api/src/orders/list.ts",
		add: 12,
		del: 4,
		status: "modified",
	},
	{ path: ".github/workflows/ci.yml", add: 1, del: 3, status: "modified" },
	{ path: "services/api/vitest.config.ts", add: 1, del: 1, status: "modified" },
	{
		path: "services/api/src/orders/list.slow.test.ts",
		add: 0,
		del: 64,
		status: "deleted",
	},
	{
		path: "services/api/migrations/0042_orders_index.sql",
		add: 6,
		del: 0,
		status: "added",
	},
];
const BIG_FILES = [
	"apps/web/src/cart.tsx",
	"apps/admin/src/orders.tsx",
	"services/api/src/orders/list.ts",
	"services/billing/src/invoice.ts",
	"libs/ui/src/table.tsx",
	"docs/orders.md",
	"infra/terraform/db.tf",
].map((path, i) => ({ path, add: 180 + i * 20, del: 40 }));

const PL_STEP = step(4, {
	title: "Watching PR #1088",
	command: "pl_pr_watch",
	node: "knowledge",
	gateway: true,
	pl: { name: "pl_pr_watch", args: "prId: 1088 · until: checks" },
	outcome: "Watching until its checks finish",
	output: "Watching until its checks finish (12 hours at most).",
	input: '{"prId":"1088","until":"checks"}',
});

const STEPS: RunStep[] = Array.from({ length: 12 }, (_, i) =>
	step(i + 1, { title: `Step ${i + 1}`, command: `git log -n ${i + 1}` }),
);

const GROUP: TranscriptItem[] = [
	{
		kind: "tools",
		key: "long",
		count: 12,
		summary: "ran 12 commands",
		failed: 0,
		running: 0,
		rows: [],
		callIds: STEPS.map((s) => s.callId),
	},
];

const SUMMARY = turnSummary(
	[
		step(1, {
			node: "edit",
			edit: { path: "services/api/list.ts", add: 12, del: 3 },
		}),
		step(2, {
			node: "edit",
			edit: { path: "services/api/index.ts", add: 1, del: 1 },
		}),
		step(3),
		step(4),
		{ ...PL_STEP },
	],
	["pl_thread_start", "pl_thread_start"],
);

const STARTED_NODE = {
	id: "child-1",
	number: 2,
	title: "Check the orders index",
	role: "db",
	parentId: "root",
	depth: 1,
	state: "running" as const,
	unread: 2,
	lastStep: "Bash: psql -c '\\d orders'",
	link: "/threads/child-1",
};

const message = (
	direction: "sent" | "received",
): Extract<CanonicalEvent, { kind: "thread_message" }> => ({
	kind: "thread_message",
	...base,
	seq: direction === "sent" ? 3 : 4,
	direction,
	peerId: "child-1",
	peerRole: "db",
	peerLink: "/threads/child-1",
	type: direction === "sent" ? "handoff" : "reply",
	mode: "queue",
	text:
		direction === "sent"
			? "Check whether orders_created_at still exists on the primary."
			: "The index is gone on the primary since 11:42. The list query now scans 4.1M rows; p99 went from 80 ms to 1.9 s.\nRecreating it concurrently takes about 6 minutes.",
});

const FINISHED: Extract<CanonicalEvent, { kind: "child_finished" }> = {
	kind: "child_finished",
	...base,
	seq: 5,
	childId: "child-1",
	link: "/threads/child-1",
	role: "db",
	outcome: "answered",
	excerpt:
		"orders_created_at was dropped by d37d888. Recreate it with CREATE INDEX CONCURRENTLY.",
};

const compaction = (
	phase: "completed" | "failed",
): Extract<CanonicalEvent, { kind: "compaction" }> => ({
	kind: "compaction",
	...base,
	seq: 9,
	phase,
	method: "agent_command",
	...(phase === "completed" ? { before: 171_000, after: 11_900 } : {}),
	instructions: "keep the index findings",
});

const EVENTS: CanonicalEvent[] = [
	{
		kind: "operator_message",
		...base,
		seq: 1,
		mode: "now",
		delivered: true,
		text: "CheckoutLatencyHigh fired: p99 1.9 s on /orders. ".repeat(40),
		attachments: [
			{
				id: "22222222-2222-4222-8222-222222222222",
				name: "grafana.png",
				mimeType: "image/png",
				size: 220_000,
			},
		],
	} as CanonicalEvent,
	{
		kind: "harness_tool_call",
		...base,
		seq: 2,
		server: "prismalens",
		name: "pl_incident_get",
		at: AT,
		turn: "first",
		output: "x".repeat(60_000),
	},
];

const SUBAGENT: SubagentView = {
	sessionId: "sub-1",
	parent: [],
	title: "Check the orders index",
	task: null,
	state: "running",
	canCancel: true,
	step: "rg -n orders_idx db/",
	startedAt: "2026-11-12T10:00:00Z",
	textCapped: false,
};

/** Reads and a search around one failed command: the failure stays out of the fold. */
const MIXED: RunStep[] = [
	...["services/api/list.ts", "services/api/index.ts", "db/schema.sql"].map(
		(path, i) =>
			step(20 + i, {
				node: "read",
				kind: "file",
				verb: "Read",
				subject: path,
				command: path,
				took: 0.1,
			}),
	),
	step(23, {
		ok: false,
		verb: "Failed",
		subject: "psql -c '\\d orders'",
		command: "psql -c '\\d orders'",
		output: "psql: error: connection refused (5432)\nexit code 2",
		took: 3.2,
	}),
	step(24, {
		node: "search",
		kind: "file",
		verb: "Searched",
		subject: "orders_created_at",
		took: 0.6,
	}),
	step(25, {
		ok: null,
		verb: "Running",
		subject: "git log -n 5 -- db/",
		command: "git log -n 5 -- db/",
		output: null,
		took: null,
	}),
];

const retry = (
	attempt: number,
	phase: "waiting" | "succeeded",
): Extract<CanonicalEvent, { kind: "provider_retry" }> => ({
	kind: "provider_retry",
	...base,
	seq: 30 + attempt,
	mode: "rate_limited",
	attempt,
	maxAttempts: 5,
	phase,
	at: "2026-11-05T12:01:30Z",
});

const RHYTHM: TranscriptItem[] = [
	{ kind: "thought", key: "th", seconds: 24 },
	{
		kind: "tools",
		key: "mixed",
		count: MIXED.length,
		summary: "read 3 files, searched 1 pattern, ran 2 commands",
		failed: 1,
		running: 1,
		rows: [],
		callIds: MIXED.map((s) => s.callId),
	},
	{ kind: "node", key: "r", event: retry(3, "waiting") },
];

const BREAKDOWN = contextBreakdown(EVENTS, { used: 164_000, size: 200_000 });

export const transcriptGallery: GallerySection[] = [
	{
		id: "pl-row",
		title: "PrismaLens tool row, folded and open",
		render: () => (
			<ol className="flex list-none flex-col gap-2 p-0">
				<StepCard step={PL_STEP} open={false} onToggle={() => {}} />
				<StepCard step={PL_STEP} open onToggle={() => {}} />
				<StepCard
					step={step(5, {
						ok: false,
						verb: "Failed",
						output: "Error: connection refused (5432)\n  at connect",
					})}
					open={false}
					onToggle={() => {}}
				/>
			</ol>
		),
	},
	{
		id: "tool-rhythm",
		title: "Thought, a folded group with a failure, retries",
		render: () => (
			<div className="flex flex-col gap-4">
				<div className="h-[220px] rounded-pool bg-canvas">
					<Transcript
						items={RHYTHM}
						incidentId={null}
						agent="The agent"
						steps={{
							all: MIXED,
							open: new Set(),
							onToggle: () => {},
							highlight: null,
							flagged: new Set(),
						}}
					/>
				</div>
				<ol className="flex list-none flex-col p-0">
					{MIXED.slice(2).map((s) => (
						<StepCard key={s.n} step={s} open={false} onToggle={() => {}} />
					))}
				</ol>
				<ul className="list-none p-0">
					<TranscriptNode event={retry(4, "succeeded")} incidentId={null} />
				</ul>
			</div>
		),
	},
	{
		id: "subagent-node",
		title: "A sub-agent's node, working and finished",
		render: () => (
			<ol className="flex list-none flex-col gap-2 p-0">
				<SubagentNode agent={SUBAGENT} onOpen={() => {}} />
				<SubagentNode agent={{ ...SUBAGENT, state: "completed" }} />
			</ol>
		),
	},
	{
		id: "turn-end",
		title: "Turn summary and changed-files card",
		render: () =>
			SUMMARY && (
				<ol className="flex list-none flex-col gap-2 p-0">
					<TurnEnd summary={SUMMARY} onOpenDiff={() => {}} />
				</ol>
			),
	},
	{
		id: "turn-verdict",
		title: "A turn's verdict: tests, risk flags, too big to judge",
		render: () => (
			<div className="flex max-w-[760px] flex-col gap-4">
				<div data-testid="gallery-verdict-clean">
					<TurnVerdict
						summary={{ text: "" }}
						files={CLEAN_FILES}
						steps={[
							testRun(
								true,
								"Test Files  4 passed (4)\n      Tests  38 passed (38)",
							),
						]}
						onOpenDiff={() => {}}
					/>
				</div>
				<div data-testid="gallery-verdict-risky">
					<TurnVerdict
						summary={{ text: "" }}
						files={RISKY_FILES}
						steps={[testRun(false, "Tests  2 failed | 36 passed (38)")]}
						onOpenDiff={() => {}}
					/>
				</div>
				<div data-testid="gallery-verdict-big">
					<TurnVerdict
						summary={{ text: "" }}
						files={BIG_FILES}
						onOpenDiff={() => {}}
					/>
				</div>
			</div>
		),
	},
	{
		id: "long-group",
		title: "A long group: ends shown, middle folded, a flagged step kept",
		render: () => (
			<div className="h-[520px] rounded-pool bg-canvas">
				<Transcript
					items={GROUP}
					incidentId={null}
					agent="The agent"
					steps={{
						all: STEPS,
						open: new Set([12]),
						onToggle: () => {},
						highlight: null,
						flagged: new Set([6]),
					}}
				/>
			</div>
		),
	},
	{
		id: "child-cards",
		title: "A child row, messages both ways, and the finish",
		render: () => (
			<div className="flex flex-col gap-2">
				<ChildRow
					node={STARTED_NODE}
					fallbackTitle="Check the orders index"
					threadRole="db"
				/>
				<ThreadMessageCard event={message("sent")} />
				<ThreadMessageCard event={message("received")} />
				<ChildFinishedCard event={FINISHED} />
			</div>
		),
	},
	{
		id: "context",
		title: "Context meter warning before compaction, and /context",
		render: () => (
			<div className="flex flex-col gap-3">
				<div className="flex gap-4">
					<ContextMeter usage={{ used: 152_000, size: 200_000 }} autoAt={85} />
					<ContextMeter usage={{ used: 174_000, size: 200_000 }} autoAt={85} />
					<ContextMeter usage={null} agent="Gemini CLI" />
				</div>
				<div className="w-80 rounded-surface bg-surface-1 p-3">
					<ContextTable breakdown={BREAKDOWN} />
				</div>
			</div>
		),
	},
	{
		id: "compaction",
		title: "Compaction dividers",
		render: () => (
			<div className="flex flex-col gap-2">
				<CompactionDivider event={compaction("completed")} incidentId={null} />
				<CompactionDivider event={compaction("failed")} incidentId={null} />
			</div>
		),
	},
];
