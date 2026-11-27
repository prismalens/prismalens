// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReactNode } from "react";
import { MessageResponse } from "@/components/ai/message";
import { errorDetailBlock } from "@/components/investigation/transcript.blocks";
import { Block } from "@/components/kit/Block";
import { BlockThread } from "@/components/kit/blocks";
import { SurfaceMore } from "@/components/kit/Surface";
import { ToolLine } from "@/components/kit/ToolLine";
import { ArtifactCard } from "@/components/run/ArtifactCard";
import { evidenceBlock } from "@/components/run/report.blocks";
import { commandBlock, logTailBlock } from "@/components/run/step.blocks";

const TABLE_MD = [
	"| Pod | Restarts | Last exit |",
	"| --- | --- | --- |",
	"| checkout-7f9c | 14 | OOMKilled |",
	"| checkout-2b1d | 3 | Error |",
].join("\n");
const LONG_DIFF_MD = [
	"```diff",
	...Array.from({ length: 45 }, (_, i) => `+line ${i + 1}`),
	"```",
].join("\n");

import {
	RewindRowsProvider,
	rewindNodes,
} from "@/components/investigation/transcript/nodes.rewind";
import {
	diffHunkBlock,
	fileExcerptBlock,
} from "@/components/thread/diff/file.blocks";
import { checkExcerptBlock } from "@/components/thread/panel/pr.blocks";
import {
	REWIND_SMALL_PRINT,
	RestoreFacts,
	RewindEditFacts,
} from "@/components/thread/RewindDialog";
import { ContextTable } from "@/components/thread/session/ContextMeter";
import { CommandChip } from "@/components/ui/command-chip";
import type { GallerySection } from "./gallery";

const noop = () => undefined;

/** One shot target; the still shows the chrome a hover or focus reveals. */
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
			<div className="flex min-w-0 flex-col gap-1 [&_[data-testid=block-chrome]]:opacity-100">
				{children}
			</div>
		</div>
	);
}

const PRE =
	"m-0 pr-16 font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]";

const FILE = `export const pool = createPool({
	max: 20,
	idleTimeoutMs: 30_000,
});`;

/** Every block kind in `*.blocks.ts`, drawn by the kit `Block` (#1101). */
function Blocks() {
	return (
		<BlockThread.Provider value="00000000-0000-4000-8000-000000000001">
			<div className="grid max-w-[720px] gap-6">
				<Stage id="block-command" caption="A command: Send to terminal, Copy">
					<Block
						spec={commandBlock}
						data={{
							command: "kubectl get pods -n checkout",
							shell: true,
						}}
					>
						<pre className={PRE}>$ kubectl get pods -n checkout</pre>
					</Block>
				</Stage>
				<Stage id="block-tool-output" caption="Tool input and output">
					<ToolLine
						call={{
							id: "c1",
							verb: "Ran",
							subject: "kubectl get pods",
							mono: true,
							output:
								"NAME                 READY   STATUS\ncheckout-api-7d9f   1/1     Running",
						}}
						defaultOpen
					/>
				</Stage>
				<Stage id="block-log-tail" caption="A failed call's stderr">
					<Block
						spec={logTailBlock}
						data={{ text: "Error: connect ECONNREFUSED 10.0.3.4:5432" }}
					>
						<pre className="m-0 pr-16 font-mono text-mono whitespace-pre-wrap text-danger">
							Error: connect ECONNREFUSED 10.0.3.4:5432
						</pre>
					</Block>
				</Stage>
				<Stage id="block-check-excerpt" caption="A failing check's log">
					<Block
						spec={checkExcerptBlock}
						data={{
							name: "ci / test",
							lines: ["FAIL src/pool.test.ts", "  expected 20, got 5"],
						}}
					>
						<pre className={PRE}>
							{"FAIL src/pool.test.ts\n  expected 20, got 5"}
						</pre>
					</Block>
				</Stage>
				<Stage id="block-file-excerpt" caption="A file, lines 2 to 3 selected">
					<Block
						spec={fileExcerptBlock}
						data={{ path: "src/pool.ts", contents: FILE, line: 2, end: 3 }}
					>
						<pre className={PRE}>
							{FILE.split("\n").map((l, i) => (
								<span key={l} data-line={i + 1} className="block">
									{l}
								</span>
							))}
						</pre>
					</Block>
				</Stage>
				<Stage id="block-diff-hunk" caption="A change: Copy new text">
					<Block
						spec={diffHunkBlock}
						data={{ path: "src/pool.ts", text: "\tmax: 20,", line: 2, end: 2 }}
						reveal="always"
					>
						{(chrome) => (
							<div className="flex items-center justify-end gap-1 px-2 py-1 text-meta">
								{chrome}
								<span className="rounded-control bg-surface-3 px-2 py-0.5">
									Revert this change
								</span>
							</div>
						)}
					</Block>
				</Stage>
				<Stage id="block-code" caption="A code block in a message">
					<MessageResponse>
						{"```bash\nkubectl rollout restart deploy/checkout-api\n```"}
					</MessageResponse>
				</Stage>
				<Stage
					id="block-table"
					caption="A table in a message: scrolls, copies as Markdown"
				>
					<MessageResponse>{TABLE_MD}</MessageResponse>
				</Stage>
				<Stage
					id="block-diff-row"
					caption="A long diff in a message becomes a row"
				>
					<MessageResponse>{LONG_DIFF_MD}</MessageResponse>
				</Stage>
				<Stage id="block-evidence" caption="Report evidence">
					<Block
						spec={evidenceBlock}
						data={{ text: "pg_stat_activity: 5 of 5 connections busy" }}
					>
						<span className="block pr-8 font-mono text-mono">
							pg_stat_activity: 5 of 5 connections busy
						</span>
					</Block>
				</Stage>
				<Stage id="block-next-command" caption="A next-step command">
					<CommandChip command="kubectl rollout undo deploy/checkout-api" />
				</Stage>
				<Stage id="block-artifact" caption="A published page: Copy source">
					<ul className="m-0 list-none p-0">
						<ArtifactCard
							artifact={{
								id: "a1",
								title: "Pool usage",
								html: "<h1>Pool usage</h1><p>5 of 5 busy</p>",
								at: "2026-11-13T09:40:00Z",
							}}
						/>
					</ul>
				</Stage>
				<Stage id="block-context" caption="The context breakdown">
					<ContextTable
						breakdown={{
							used: 120_000,
							size: 200_000,
							rows: [
								{ category: "tools", tokens: 80_000, percent: 40 },
								{ category: "replies", tokens: 40_000, percent: 20 },
							],
							free: 80_000,
							largest: [
								{ label: "kubectl logs", category: "tools", tokens: 30_000 },
							],
							trim: null,
						}}
					/>
				</Stage>
				<Stage id="block-error-detail" caption="The agent's error">
					<Block
						spec={errorDetailBlock}
						data={{ text: "API Error: 529 overloaded_error" }}
					>
						<p className="pr-8 text-meta text-text-3">
							API Error: 529 overloaded_error
						</p>
					</Block>
				</Stage>
				<Stage id="block-menu" caption="Right-click a block">
					<div className="flex h-[150px] justify-start">
						<SurfaceMore
							id="block"
							ctx={{
								copyLabel: "Copy command",
								copy: noop,
								run: noop,
								addToComposer: noop,
								facts: { is: { runnable: true, quotable: true } },
							}}
							open
							align="start"
						/>
					</div>
				</Stage>
			</div>
		</BlockThread.Provider>
	);
}

const RUN = "00000000-0000-4000-8000-000000000001";
const REWIND = "00000000-0000-4000-8000-000000000002";
const OP = "00000000-0000-4000-8000-000000000003";
const base = {
	runId: RUN,
	branchId: "rewinds",
	path: [],
	ts: "2026-11-20T10:00:00Z",
};
const okRepo = {
	repo: "checkout-api",
	state: "ok" as const,
	head: "a1",
	tree: "b2",
	revert: [{ path: "src/pool.ts", status: "modified" as const }],
	duringTurn: [] as string[],
	kept: [{ path: "README.md", why: "yours" as const }],
	commits: 0,
};
const previewOf = (
	repos: Parameters<typeof RewindEditFacts>[0]["preview"]["repos"],
	via: "fork" | "replay" = "fork",
) => ({
	seq: 4,
	messageOrdinal: 9,
	revision: 30,
	block: null,
	turns: 2,
	repos,
	stays: ["the PR comment it posted"],
	session: {
		via,
		why: via === "replay" ? "the turn before ended in a tool call" : null,
	},
});

/** The edit confirm's body as the dialog shows it, without the overlay. */
function DialogStill({
	title,
	button,
	children,
}: {
	title: string;
	button: string;
	children: ReactNode;
}) {
	return (
		<div
			className="flex max-w-lg flex-col gap-3 rounded-surface bg-surface-3 p-4 text-body text-text-2"
			data-testid="rewind-confirm"
		>
			<span className="text-title text-text-1">{title}</span>
			{children}
			<div className="space-y-1 text-meta text-text-3">
				{REWIND_SMALL_PRINT.map((l) => (
					<p key={l}>{l}</p>
				))}
			</div>
			<span className="self-end text-meta text-text-1">Cancel · {button}</span>
		</div>
	);
}

function Rewind() {
	const { Node: Fold } = rewindNodes.thread_rewound;
	const { Node: Interrupted } = rewindNodes.rewind_interrupted;
	return (
		<RewindRowsProvider
			value={{
				threadId: RUN,
				undoable: REWIND,
				undone: new Set(),
				restored: new Set(),
				open: noop,
			}}
		>
			<div className="flex flex-col gap-8">
				<Stage id="rewind-confirm-plain" caption="Edit: plain">
					<DialogStill title="Edit and run again?" button="Rewind and send">
						<RewindEditFacts
							preview={previewOf([okRepo])}
							include={false}
							setInclude={noop}
						/>
					</DialogStill>
				</Stage>
				<Stage
					id="rewind-confirm-during"
					caption="Edit: files changed during a turn"
				>
					<DialogStill title="Edit and run again?" button="Rewind and send">
						<RewindEditFacts
							preview={previewOf([
								{ ...okRepo, duringTurn: ["dist/pool.js"], commits: 2 },
							])}
							include={false}
							setInclude={noop}
						/>
					</DialogStill>
				</Stage>
				<Stage
					id="rewind-confirm-conversation"
					caption="Edit: conversation only"
				>
					<DialogStill
						title="Edit and run again?"
						button="Rewind conversation and send"
					>
						<RewindEditFacts
							preview={previewOf(
								[
									{
										repo: "checkout-api",
										state: "unavailable",
										reason: "borrowed",
									},
								],
								"replay",
							)}
							include={false}
							setInclude={noop}
						/>
					</DialogStill>
				</Stage>
				<Stage id="rewind-confirm-undo" caption="Undo an edit">
					<DialogStill title="Undo this edit?" button="Undo edit">
						<ul>
							<li>
								Brings back the 2 turns the edit folded, and sets the files back
								to how they were before it.
							</li>
							<li>The edited message and what followed it fold instead.</li>
							<li>Files you changed since stay.</li>
						</ul>
					</DialogStill>
				</Stage>
				<Stage id="rewind-fold" caption="The fold row">
					<div>
						<Fold
							incidentId={null}
							event={{
								...base,
								seq: 1,
								kind: "thread_rewound",
								rewindId: REWIND,
								fromSeq: 4,
								turns: 2,
								messageOrdinal: 9,
								throughOrdinal: 30,
								journals: {},
								reverted: [{ repo: "checkout-api", path: "src/pool.ts" }],
								kept: [],
								priorSessions: { acpSessionId: null, agentSessions: null },
								session: "fork",
								by: { kind: "you" },
							}}
						/>
					</div>
				</Stage>
				<Stage id="rewind-interrupted" caption="An interrupted rewind">
					<Interrupted
						incidentId={null}
						event={{
							...base,
							seq: 2,
							kind: "rewind_interrupted",
							op: OP,
							repo: "checkout-api",
							opKind: "rewind",
							rewindId: REWIND,
							backup: "c3",
							receipt: null,
							written: [{ repo: "checkout-api", path: "src/pool.ts" }],
						}}
					/>
				</Stage>
				<Stage id="rewind-restore" caption="Restore from the backup">
					<DialogStill title="Restore from the backup?" button="Restore">
						<RestoreFacts
							threadId={RUN}
							preview={{
								op: OP,
								repo: "checkout-api",
								block: null,
								overwrite: ["src/pool.ts"],
								created: ["src/pool.test.ts"],
								damaged: [],
								head: "a1",
								tree: "b2",
								backup: "c3",
								now: "d4",
							}}
							include={new Set()}
							setInclude={noop}
						/>
					</DialogStill>
				</Stage>
			</div>
		</RewindRowsProvider>
	);
}

export const blocksGallery: GallerySection[] = [
	{ id: "kit-blocks", title: "Kit: special blocks", render: () => <Blocks /> },
	{ id: "rewind", title: "Edit and rewind", render: () => <Rewind /> },
];
