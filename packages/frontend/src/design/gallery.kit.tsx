// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Archive,
	BookOpen,
	Check,
	FilePen,
	FileSearch,
	MoreHorizontal,
	Pencil,
	Pin,
	SquareTerminal,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { AgentMark } from "@/components/agent/AgentMark";
import { PrismaLensMark } from "@/components/icons/prismalens-mark";
import { messageCtx } from "@/components/investigation/message.actions";
import { Aside, type AsideEntry } from "@/components/kit/Aside";
import { DetailsCard, DetailsDock } from "@/components/kit/DetailsCard";
import { detailsRows } from "@/components/kit/details-registry";
import { Help } from "@/components/kit/Help";
import { ListCard, ListGrid } from "@/components/kit/ListCard";
import { ContextMenu, Menu, type MenuEntry } from "@/components/kit/Menu";
import { Picker, type PickerOption } from "@/components/kit/Picker";
import { KitPopover } from "@/components/kit/Popover";
import { effortIcon, modeIcon } from "@/components/kit/picker-icons";
import { Rail, type RailBreak, type RailItem } from "@/components/kit/Rail";
import { ResponseActions } from "@/components/kit/ResponseActions";
import { Status, type StatusKind, statusKinds } from "@/components/kit/Status";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { TabPanel, Tabs } from "@/components/kit/Tabs";
import { type ToolCall, ToolGroup, ToolLine } from "@/components/kit/ToolLine";
import { DetailsActions } from "@/components/thread/panel/DetailsActions";
import {
	DetailsStarted,
	startedSpan,
} from "@/components/thread/panel/DetailsStarted";
import type { DetailsCtx } from "@/components/thread/panel/details.actions";
import type { GitAction } from "@/components/thread/panel/git-action";
import { Button } from "@/components/ui/button";
import type { GallerySection } from "./gallery";

const noop = () => undefined;

/** One shot target: the design matrix screenshots each `data-kit-state` box. */
function Stage({
	id,
	caption,
	className,
	children,
}: {
	id: string;
	caption: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2" data-kit-state={id}>
			<span className="text-meta text-text-3">{caption}</span>
			<div className={className}>{children}</div>
		</div>
	);
}

const ROW_MENU: MenuEntry[] = [
	{ id: "rename", label: "Rename", icon: Pencil, onSelect: noop },
	{ id: "pin", label: "Pin", icon: Pin, onSelect: noop },
	{ id: "archive", label: "Archive", icon: Archive, onSelect: noop },
	{ id: "sep", separator: true },
	{ id: "settle", label: "Settle", icon: Check, onSelect: noop },
];
const HEADER_MENU: MenuEntry[] = [
	{ id: "rename", label: "Rename", icon: Pencil, onSelect: noop },
	{ id: "settle", label: "Settle", icon: Check, onSelect: noop },
	{ id: "sep", separator: true },
	{ id: "archive", label: "Archive", icon: Archive, onSelect: noop },
];

/** Spreads props so Radix's trigger reaches the DOM node (React 19 passes `ref` as a prop). */
const MoreButton = (props: ComponentProps<"button">) => (
	<button
		type="button"
		data-testid="kit-menu-trigger"
		className="flex size-7 items-center justify-center rounded-control text-text-2 outline-none hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3"
		{...props}
	>
		<MoreHorizontal className="size-3.5" />
	</button>
);

/** Every status, read from the registry so a new kind shows here too. */
const KINDS: readonly StatusKind[] = statusKinds.members;

function Cards() {
	return (
		<>
			<Stage
				id="status-kinds"
				caption="Every status: its own icon, tinted; the word neutral"
				className="flex flex-wrap gap-x-5 gap-y-2 text-body"
			>
				{KINDS.map((k) => (
					<Status key={k} kind={k} />
				))}
			</Stage>
			<Stage id="list-cards" caption="Cards in a reflowing grid">
				<ListGrid label="Schedules">
					<ListCard
						title="Watch checkout"
						status="done"
						statusWord="Nothing wrong found"
						meta="Weekdays 09:00"
						onOpen={noop}
						menu={ROW_MENU}
					/>
					<ListCard
						title="Daily digest"
						status="limited"
						statusWord="Usage limit"
						meta="Resumes 10:15"
						onOpen={noop}
						menu={ROW_MENU}
					/>
					<ListCard
						title="Restart the checkout pods"
						status="approval"
						meta="kubectl rollout restart deploy/checkout"
						onOpen={noop}
						selected
					/>
					<ListCard
						title="Migrate the cron jobs"
						status="failed"
						meta="The scheduler refused the 03:00 job"
						onOpen={noop}
					/>
					<ListCard
						title="Bisect the deploy"
						status="done"
						meta="Since 09:12"
						detail="Found it: 3f2a1c9 changes DB_POOL_SIZE from 50 to 5, which the checkout pods read at start."
						onOpen={noop}
					/>
					<ListCard
						title="Pull alerts from Alertmanager"
						status="idle"
						meta="When PrismaLens starts"
						onOpen={noop}
					/>
				</ListGrid>
			</Stage>
		</>
	);
}

function Menus() {
	return (
		<div className="grid gap-6 md:grid-cols-2">
			<Stage
				id="menu-open"
				caption="Header ⋯ menu"
				className="flex h-[200px] justify-end"
			>
				<Menu
					label="Thread actions"
					entries={HEADER_MENU}
					trigger={<MoreButton aria-label="Thread actions" />}
				/>
			</Stage>
			<Stage
				id="menu-context"
				caption="Right-click a row for the same menu"
				className="h-[200px]"
			>
				<ContextMenu label="Row actions" entries={ROW_MENU}>
					<div
						className="flex h-9 items-center gap-2 rounded-control bg-surface-1 px-3 text-body"
						data-testid="kit-context-target"
					>
						Restart the checkout pods
					</div>
				</ContextMenu>
			</Stage>
			<ObjectMenuStage />
		</div>
	);
}

const SAMPLE = {
	command: "kubectl get pods",
	facts: { is: { running: true } },
	log: noop,
};

function ObjectMenuStage() {
	const [open, setOpen] = useState(true);
	return (
		<Stage
			id="menu-object"
			caption="One registered surface: right-click and ⋯ list the same actions"
			className="flex h-[200px] items-start gap-2"
		>
			<Surface id="sample.row" ctx={SAMPLE}>
				<div
					tabIndex={-1}
					className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control bg-surface-1 px-3 font-mono text-mono"
					data-testid="kit-surface-target"
				>
					kubectl get pods
				</div>
			</Surface>
			<SurfaceMore
				id="sample.row"
				ctx={SAMPLE}
				open={open}
				onOpenChange={setOpen}
			/>
		</Stage>
	);
}

function Popovers() {
	return (
		<div className="flex flex-col gap-6">
			<Stage
				id="popover-card"
				caption="An ask beside its row, card family (320)"
				className="h-[190px]"
			>
				<KitPopover
					family="card"
					side="right"
					label="Approval needed"
					trigger={
						<button
							type="button"
							data-testid="kit-popover-trigger"
							className="flex h-9 w-[160px] items-center rounded-control bg-surface-3 px-3 text-body"
						>
							Restart the pods
						</button>
					}
				>
					<div className="flex flex-col gap-2 p-2">
						<Status kind="approval" className="text-body" />
						<code className="block truncate">
							kubectl rollout restart deploy/checkout -n prod
						</code>
						<div className="flex justify-end gap-1">
							<Button variant="text" size="sm">
								Deny
							</Button>
							<Button variant="primary" size="sm">
								Approve
							</Button>
						</div>
					</div>
				</KitPopover>
			</Stage>
		</div>
	);
}

const MODEL_OPTIONS: PickerOption[] = [
	...["Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Fable 5.2"].map((m) => ({
		id: `claude-${m}`,
		name: m,
		mark: <AgentMark id="claude-code" className="size-3.5" />,
		group: "Claude Code",
	})),
	...["GPT-6.1 Sol", "GPT-6.1 mini"].map((m) => ({
		id: `codex-${m}`,
		name: m,
		mark: <AgentMark id="codex" className="size-3.5" />,
		group: "Codex",
	})),
	...["DeepSeek V4.1 Flash", "Qwen 4 Coder", "Kimi K3"].map((m) => ({
		id: `opencode-${m}`,
		name: m,
		mark: <AgentMark id="opencode" className="size-3.5" />,
		group: "OpenCode",
	})),
];
const EFFORT_OPTIONS: PickerOption[] = ["low", "medium", "high", "max"].map(
	(id) => ({
		id,
		name: id.charAt(0).toUpperCase() + id.slice(1),
		icon: effortIcon(id),
	}),
);
/** The agent's own modes, as ACP reports them (pattern sheet §5). */
const MODE_OPTIONS: PickerOption[] = [
	{
		id: "default",
		name: "Default",
		description: "Asks before edits and commands",
	},
	{
		id: "acceptEdits",
		name: "Accept edits",
		description: "Edits run; commands ask",
	},
	{ id: "plan", name: "Plan", description: "Reads only, then proposes" },
	{
		id: "bypassPermissions",
		name: "Bypass permissions",
		description: "Nothing asks",
	},
].map((o) => ({ ...o, icon: modeIcon(o.id) }));

function PickerStage({
	id,
	caption,
	tall,
	children,
}: {
	id: string;
	caption: string;
	tall?: boolean;
	children: ReactNode;
}) {
	return (
		<Stage
			id={id}
			caption={caption}
			className={
				tall
					? "flex h-[460px] items-end rounded-pool bg-surface-1 p-2"
					: "flex h-[240px] items-end rounded-pool bg-surface-1 p-2"
			}
		>
			{children}
		</Stage>
	);
}

function Pickers() {
	const [model, setModel] = useState("claude-Opus 5.5");
	const [effort, setEffort] = useState("high");
	const [mode, setMode] = useState("default");
	return (
		<div className="flex flex-col gap-6">
			<Stage
				id="picker-row"
				caption="The composer's row, closed; the last one locked"
				className="flex flex-wrap items-center gap-1 rounded-pool bg-surface-1 p-2"
			>
				<Picker
					label="Model"
					options={MODEL_OPTIONS}
					value={model}
					onChange={setModel}
				/>
				<Picker
					label="Effort"
					options={EFFORT_OPTIONS}
					value={effort}
					onChange={setEffort}
				/>
				<Picker
					label="Permission"
					options={MODE_OPTIONS}
					value={mode}
					onChange={setMode}
				/>
				<Picker
					label="Permission"
					options={MODE_OPTIONS}
					value="plan"
					onChange={noop}
					locked="Set when the run started"
					testId="kit-picker-locked"
				/>
			</Stage>
			<div className="grid items-end gap-6 md:grid-cols-3">
				<PickerStage id="picker-model" caption="Model, with search" tall>
					<Picker
						label="Model"
						options={MODEL_OPTIONS}
						value={model}
						onChange={setModel}
						testId="kit-picker-model"
					/>
				</PickerStage>
				<PickerStage id="picker-effort" caption="Effort">
					<Picker
						label="Effort"
						options={EFFORT_OPTIONS}
						value={effort}
						onChange={setEffort}
						testId="kit-picker-effort"
					/>
				</PickerStage>
				<PickerStage id="picker-mode" caption="The agent's own modes">
					<Picker
						label="Permission"
						options={MODE_OPTIONS}
						value={mode}
						onChange={setMode}
						testId="kit-picker-mode"
					/>
				</PickerStage>
			</div>
		</div>
	);
}

const detailsCtx = (
	primary: GitAction | null,
	host: DetailsCtx["host"] = "github",
): DetailsCtx => ({
	branch: "fix/orders-index",
	host,
	pr: { number: 412, repo: "shop/orders" },
	ask: noop,
	openPr: noop,
	openFolder: noop,
	openTerminal: noop,
	facts: {
		is: {
			...(primary ? { [primary]: true } : {}),
			folder: true,
			terminal: true,
		},
	},
});

const MIN = 60_000;
const STARTED = (
	[
		["Check the orders index", "failed", "codex", 0],
		["Bisect the deploy", "running", "claude-code", 2],
		["Read the pool settings", "queued", "claude-code", 0],
		["Draft the rollback", "running", "claude-code", 0],
		["Read the migration", "answered", "opencode", 0],
		["Scan recent alerts", "stopped", "claude-code", 0],
	] as const
).map(([title, state, harness, unread], i) => ({
	id: `c${i + 1}`,
	title,
	link: `/threads/c${i + 1}`,
	state,
	harness,
	unread,
}));
const STARTED_LIST = {
	node: <DetailsStarted started={STARTED} onFilter={noop} onMore={noop} />,
	span: startedSpan(STARTED.length),
};

const THREAD_ROWS = detailsRows({
	kind: "thread",
	machine: "DESKTOP-B5 · Windows",
	agent: { id: "claude-code", name: "Claude Code", model: "Opus 5.5" },
	branch: "fix/orders-index",
	sync: { ahead: 2, behind: 1 },
	changes: { added: 49, removed: 4 },
	pr: {
		number: 412,
		word: "Failing",
		tone: "failing",
		checks: "7/9",
		title: "Fix the slow orders query",
		branches: { head: "pl/orders-index", base: "main" },
		review: { state: "changes_requested", word: "Changes requested" },
		merge: { state: "conflicts", word: "Merge conflict" },
	},
	actions: <DetailsActions ctx={detailsCtx("fixChecks")} primary="fixChecks" />,
	startedBy: { title: "Checkout 502s after deploy", via: "agent" },
	started: STARTED_LIST,
	watching: "Watching checks",
	schedule: "Every weekday 09:00",
	context: 62,
	open: { diff: noop, pr: noop, startedBy: noop },
});
const INCIDENT_ROWS = detailsRows({
	kind: "incident",
	severity: { word: "High", tone: "sev-high" },
	cause:
		"v2.14.1 cut the checkout DB pool from 50 to 5 connections, so requests queue past the gateway timeout.",
	next: "kubectl set env deploy/checkout DB_POOL_SIZE=50",
	alert: { name: "CheckoutLatencyHigh", firing: true },
	pr: {
		number: 418,
		word: "Passing",
		tone: "passing",
		checks: "9/9",
		title: "Restore the orders index",
		review: { state: "approved", word: "Approved" },
		merge: { state: "clean", word: "Can merge" },
	},
	open: { alert: noop, pr: noop },
});

const FAKE_TRANSCRIPT = (
	<div className="flex flex-col gap-3 px-2 pt-2 text-body text-text-1">
		<p>The orders list query lost its index in the last migration.</p>
		<p className="text-text-2">
			I restored it and opened #412; unit tests fail on one timing assertion.
		</p>
	</div>
);

function ClosableDock() {
	const [docked, setDocked] = useState(true);
	return (
		<DetailsDock rows={THREAD_ROWS} docked={docked} onDockedChange={setDocked}>
			{FAKE_TRANSCRIPT}
		</DetailsDock>
	);
}

function Details() {
	return (
		<div className="flex flex-col gap-6">
			<div className="grid gap-6 md:grid-cols-3">
				<Stage
					id="details-full"
					caption="Chat thread, full"
					className="w-full min-w-0 max-w-[280px]"
				>
					<Surface id="thread.details" ctx={detailsCtx("fixChecks")}>
						<div>
							<DetailsCard rows={THREAD_ROWS} density="full" />
						</div>
					</Surface>
				</Stage>
				<Stage
					id="details-compact"
					caption="Compact"
					className="w-full min-w-0 max-w-[280px]"
				>
					<DetailsCard rows={THREAD_ROWS} density="compact" />
				</Stage>
				<Stage
					id="details-essential"
					caption="Essential"
					className="w-full min-w-0 max-w-[280px]"
				>
					<DetailsCard rows={THREAD_ROWS} density="essential" />
				</Stage>
			</div>
			<div
				className="grid gap-6 md:grid-cols-3"
				data-kit-state="details-actions"
			>
				{(
					[
						["push", "github"],
						["createPr", "gitlab"],
						["fixChecks", "github"],
						["resolveConflicts", "github"],
						["markReady", "github"],
						["viewPr", "gitlab"],
					] as const
				).map(([a, host]) => (
					<Stage
						key={a}
						id={`details-actions-${a}`}
						caption={`Primary: ${a}`}
						className="w-full min-w-0 max-w-[280px]"
					>
						<DetailsActions ctx={detailsCtx(a, host)} primary={a} />
					</Stage>
				))}
			</div>
			<Stage
				id="details-started"
				caption="Threads it started: start order, a status mark each, five then N more"
				className="w-full min-w-0 max-w-[280px]"
			>
				<DetailsStarted started={STARTED} onFilter={noop} onMore={noop} />
			</Stage>
			<Stage
				id="details-incident"
				caption="Incident thread"
				className="w-[280px]"
			>
				<DetailsCard rows={INCIDENT_ROWS} />
			</Stage>
			<Stage
				id="details-docked"
				caption="Docked beside a 900 px area"
				className="h-[300px] w-[900px] max-w-full overflow-hidden rounded-pool bg-canvas"
			>
				<ClosableDock />
			</Stage>
			<Stage
				id="details-narrow"
				caption="A narrow area: the card is a button"
				className="h-[160px] w-[520px] max-w-full overflow-hidden rounded-pool bg-canvas"
			>
				<DetailsDock rows={THREAD_ROWS}>{FAKE_TRANSCRIPT}</DetailsDock>
			</Stage>
		</div>
	);
}

const CALLS: ToolCall[] = [
	{
		id: "r1",
		icon: BookOpen,
		verb: "Read",
		subject: "src/orders/query.ts",
		mono: true,
	},
	{
		id: "r2",
		icon: SquareTerminal,
		verb: "Ran",
		subject: "kubectl logs checkout-241-0 --tail=200",
		mono: true,
		output:
			'2026-11-12T08:00:00Z level=error svc=checkout msg="pool exhausted"\n2026-11-12T08:01:00Z level=info svc=checkout msg="retry 1"',
	},
	{ id: "r3", icon: FileSearch, verb: "Searched", subject: "DB_POOL_SIZE" },
	{
		id: "r4",
		icon: FilePen,
		verb: "Edited",
		subject: "deploy/checkout.yaml",
		mono: true,
	},
];

function Tools() {
	return (
		<div className="flex max-w-[640px] flex-col gap-6">
			<Stage id="tool-lines" caption="Lines, collapsed">
				<ToolLine call={CALLS[0]} />
				<ToolLine call={CALLS[1]} />
				<ToolLine
					call={{
						id: "pl",
						mark: <PrismaLensMark className="size-3.5" />,
						verb: "Opened",
						subject: "PR #412",
					}}
				/>
				<ToolLine
					call={{
						id: "run",
						verb: "Running",
						subject: "pnpm test --filter orders",
						mono: true,
						running: true,
					}}
				/>
				<ToolLine
					call={{
						id: "fail",
						icon: SquareTerminal,
						verb: "Ran",
						subject: "pnpm test",
						mono: true,
						failed: "exit 1: 1 test failed",
						output: "FAIL src/orders/query.test.ts > lists a customer's orders",
					}}
				/>
			</Stage>
			<Stage
				id="help"
				caption="Help is opt-in: a ? that opens one line"
				className="flex items-center gap-1.5 text-body"
			>
				Notify me with
				<Help
					about="Notify me with"
					text="Applies on every device you open PrismaLens on."
				/>
			</Stage>
			<Stage
				id="response-actions"
				caption="After a response: Copy, Copy as text and Fork, quiet"
				className="flex flex-col gap-1"
			>
				<p className="text-body text-text-1">
					The pool sizing is the likely cause; v2.14.1 set it to 5.
				</p>
				<ResponseActions
					text="The pool sizing is the likely cause."
					onFork={noop}
				/>
			</Stage>
			<Stage
				id="message-menu"
				caption="Right-click a message: the same three"
				className="flex h-[120px] justify-start"
			>
				<SurfaceMore
					id="message"
					ctx={messageCtx("", noop)}
					open
					align="start"
				/>
			</Stage>
			<Stage id="tool-line-open" caption="A line, opened">
				<ToolLine call={CALLS[1]} defaultOpen />
			</Stage>
			<Stage id="tool-group" caption="Consecutive actions, folded and opened">
				<ToolGroup
					summary="ran 1 command, read 1 file, searched 1 pattern, edited 1 file"
					calls={CALLS}
				/>
				<ToolGroup
					summary="ran 1 command, read 1 file, searched 1 pattern, edited 1 file"
					calls={CALLS}
					defaultOpen
				/>
			</Stage>
		</div>
	);
}

const RAIL_BREAK_TEXT: Record<RailBreak, [string, string]> = {
	limit: ["Usage limit, resets 10:15", "09:40 · Quota reached"],
	failure: ["Error", "11:02 · Run failed: exit 137"],
	restart: ["Interrupted by restart", "12:20"],
	compaction: ["Context compacted", "13:05"],
};
const RAIL_BREAK_AT: Record<number, RailBreak> = {
	3: "limit",
	6: "compaction",
	9: "failure",
	30: "restart",
	44: "failure",
};

/** A turn per index, with a break dash between some turns, as `railItems` builds them. */
function railDemo(count: number): RailItem[] {
	return Array.from({ length: count }, (_, i): RailItem[] => {
		const turn: RailItem = {
			id: `t${i}`,
			kind: "turn",
			title: `Turn ${i + 1}: check why the pool runs out of connections`,
			body:
				i === count - 1
					? undefined
					: "The pool sizing is the likely cause. Ten workers share four connections, so requests queue behind the slow report query.",
			state: i === count - 1 ? "working" : undefined,
		};
		const brk = RAIL_BREAK_AT[i];
		if (!brk) return [turn];
		const [title, body] = RAIL_BREAK_TEXT[brk];
		return [turn, { id: `b${i}`, kind: brk, title, body }];
	}).flat();
}
const RAIL_SHORT = railDemo(10);
const RAIL_LONG = railDemo(1250);

function RailStage({
	id,
	caption,
	items,
	current,
	peek,
	hits,
}: {
	id: string;
	caption: string;
	items: RailItem[];
	current: string;
	peek?: string;
	hits?: string[];
}) {
	const [at, setAt] = useState(current);
	return (
		<Stage
			id={id}
			caption={caption}
			className="flex h-[200px] items-center gap-3 rounded-pool bg-canvas p-2"
		>
			<Rail items={items} current={at} hits={hits} peek={peek} onJump={setAt} />
		</Stage>
	);
}

function RailDemo() {
	return (
		<div className="flex flex-col gap-4">
			<RailStage
				id="rail"
				caption="Rail at rest: one dash per turn, breaks in their colour, current brighter"
				items={RAIL_SHORT}
				current="t6"
			/>
			<RailStage
				id="rail-hover-turn"
				caption="Hover a turn: its message, then the agent's last words"
				items={RAIL_SHORT}
				current="t6"
				peek="t4"
			/>
			<RailStage
				id="rail-hover-break"
				caption="Hover a break: what happened and when"
				items={RAIL_SHORT}
				current="t6"
				peek="b3"
			/>
			<RailStage
				id="rail-working"
				caption="A turn with no reply yet shows its state"
				items={RAIL_SHORT}
				current="t9"
				peek="t9"
			/>
			<RailStage
				id="rail-long"
				caption="1,250 turns: a window of 15 around you, ends fading"
				items={RAIL_LONG}
				current="t612"
			/>
			<RailStage
				id="rail-find"
				caption="Find open: turns with a hit are bright"
				items={RAIL_SHORT}
				current="t6"
				hits={["t2", "t8"]}
			/>
		</div>
	);
}

function TabsDemo() {
	const [tab, setTab] = useState("checks");
	return (
		<Stage id="tabs" caption="Tabs, as the PR view uses them">
			<Tabs
				label="Pull request"
				value={tab}
				onValueChange={setTab}
				items={[
					{ value: "checks", label: "Checks", count: 2 },
					{ value: "reviews", label: "Reviews", count: 1 },
					{ value: "files", label: "Files", count: 12 },
				]}
			>
				<TabPanel value="checks">
					<p className="text-body text-text-2">unit tests, e2e</p>
				</TabPanel>
				<TabPanel value="reviews">
					<p className="text-body text-text-2">
						packages/api/src/orders/query.ts:31
					</p>
				</TabPanel>
				<TabPanel value="files">
					<p className="text-body text-text-2">12 files</p>
				</TabPanel>
			</Tabs>
		</Stage>
	);
}

const ASIDES: AsideEntry[] = [
	{
		id: "a1",
		question: "What does DB_POOL_SIZE default to?",
		state: "done",
		answer: <p>50, set in config/checkout.yaml; v2.14.1 overrides it to 5.</p>,
	},
	{
		id: "a2",
		question: "Why did the canary pass?",
		state: "done",
		answer: (
			<p>
				The canary takes 2% of traffic, which never fills five connections. The
				pool only runs dry above about 40 requests per second.
			</p>
		),
	},
	{ id: "a3", question: "Which region is next?", state: "answering" },
];

function ComposerStub() {
	return (
		<div className="flex h-16 items-start rounded-pool bg-surface-2 p-3 text-body text-text-3">
			Reply
		</div>
	);
}

function Asides() {
	const [i, setI] = useState(1);
	return (
		<div className="grid gap-6 md:grid-cols-2">
			<Stage id="aside-done" caption="An answer, with earlier asides">
				<div className="flex flex-col gap-2">
					<Aside
						entries={ASIDES}
						index={i}
						onIndex={setI}
						onClose={noop}
						onKeep={noop}
					/>
					<ComposerStub />
				</div>
			</Stage>
			<div className="flex flex-col gap-6">
				<Stage id="aside-answering" caption="Answering">
					<div className="flex flex-col gap-2">
						<Aside
							entries={[ASIDES[2]]}
							index={0}
							onIndex={noop}
							onClose={noop}
							onKeep={noop}
						/>
						<ComposerStub />
					</div>
				</Stage>
				<Stage id="aside-failed" caption="Failed">
					<Aside
						entries={[
							{
								id: "f",
								question: "Which region is next?",
								state: "failed",
								error: "The agent is not signed in",
							},
						]}
						index={0}
						onIndex={noop}
						onClose={noop}
						onKeep={noop}
						onRetry={noop}
					/>
				</Stage>
			</div>
		</div>
	);
}

/** The Wave 2 kit (pattern sheet, #1101), shot by the design matrix's kit test. */
export const kitGallery: GallerySection[] = [
	{ id: "kit-cards", title: "Kit: list cards", render: () => <Cards /> },
	{ id: "kit-menus", title: "Kit: menus", render: () => <Menus /> },
	{
		id: "kit-popovers",
		title: "Kit: popover families",
		render: () => <Popovers />,
	},
	{
		id: "kit-pickers",
		title: "Kit: composer pickers",
		render: () => <Pickers />,
	},
	{ id: "kit-details", title: "Kit: details card", render: () => <Details /> },
	{ id: "kit-tools", title: "Kit: tool lines", render: () => <Tools /> },
	{ id: "kit-rail", title: "Kit: rail", render: () => <RailDemo /> },
	{ id: "kit-tabs", title: "Kit: tabs", render: () => <TabsDemo /> },
	{ id: "kit-aside", title: "Kit: side question", render: () => <Asides /> },
];
