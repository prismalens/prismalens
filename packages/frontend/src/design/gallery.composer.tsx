// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PendingAsk,
	ReferenceHit,
	ReferenceSearchResult,
} from "@prismalens/contracts";
import type { ReactNode } from "react";
import { AskDock } from "@/components/thread/composer/AskDock";
import { ComposerMenu } from "@/components/thread/composer/ComposerMenu";
import {
	CommandChip,
	ConflictLine,
	FileChip,
	QuoteChipView,
	RefChip,
} from "@/components/thread/composer/chips";
import type { GallerySection } from "./gallery";

const THREAD = "00000000-0000-4000-8000-000000000001";
const noop = () => {};

const file = (name: string, type: string, size: number) =>
	new File([new Uint8Array(Math.min(size, 16))], name, { type });
const sized = (f: File, size: number) =>
	Object.defineProperty(f, "size", { value: size }) as File;

const PIXEL =
	"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='%23888'/></svg>";

const PASTE = Array.from(
	{ length: 312 },
	(_, i) =>
		`2026-11-11T10:${String(i % 60).padStart(2, "0")}:00Z ERROR pool exhausted`,
).join("\n");

function Box({ children }: { children: ReactNode }) {
	return (
		<div className="max-w-[760px] rounded-[10px] bg-surface-3 px-3 pt-2.5 pb-2">
			{children}
		</div>
	);
}

const hit = (
	label: string,
	group: string,
	extra: Partial<ReferenceHit> = {},
): ReferenceHit => ({
	ref: { kind: "command", id: label.slice(1), label },
	group,
	why: "match",
	score: 1,
	...extra,
});

const MENU: ReferenceSearchResult = {
	hits: [
		hit("/compact", "PrismaLens", {
			source: "app",
			detail: "Compact the conversation",
		}),
		hit("/new", "PrismaLens", { source: "app", detail: "Start a new thread" }),
		hit("/review", "Codex", {
			source: "agent",
			detail: "Review the current changes",
			inputHint: "focus",
		}),
		hit("/init", "Codex", {
			source: "agent",
			detail: "Write an agents file (from the last run)",
		}),
	],
	truncated: false,
	unavailable: [
		{ source: "GitLab", message: "No token for gitlab.example.com" },
	],
};

const ask = (over: Partial<PendingAsk>): PendingAsk => ({
	askId: crypto.randomUUID(),
	threadId: THREAD,
	kind: "question",
	requiresHost: false,
	source: { kind: "agent" },
	title: "Which environment should I check?",
	openedAt: "2026-11-11T10:00:00.000Z",
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
		identity: "h1",
	},
});
const PLAN = ask({
	kind: "permission",
	title: "Plan ready",
	permission: {
		toolKind: "switch_mode",
		variant: "plan",
		options: [{ optionId: "a", name: "Approve", kind: "allow_once" }],
	},
});
const INPUT = ask({
	kind: "input",
	title: "Where should the report go?",
	input: {
		schema: {
			type: "object",
			properties: {
				channel: { type: "string", title: "Channel" },
				urgent: { type: "boolean", title: "Urgent" },
			},
		},
	},
});
const SECRET = ask({
	kind: "secret",
	source: { kind: "tool", tool: "secret_request", requestId: "r" },
	title: "GRAFANA_TOKEN: to read the dashboards",
});
const HOST = ask({
	...APPROVAL,
	askId: crypto.randomUUID(),
	requiresHost: true,
});

/** UI 1's states in the gallery (#1024). Only UI 1 edits this file. */
export const composerGallery: GallerySection[] = [
	{
		id: "composer-chips",
		title: "Composer chips",
		render: () => (
			<Box>
				<ul className="flex flex-wrap gap-1.5">
					<FileChip
						item={{
							key: "i",
							file: file("grafana.png", "image/png", 812_000),
							preview: PIXEL,
						}}
						open={false}
						onToggle={noop}
						onRemove={noop}
						onPasteAsText={noop}
						pasteRefusal={null}
					/>
					<FileChip
						item={{
							key: "f",
							file: sized(
								file("heap.hprof", "application/octet-stream", 16),
								9_400_000,
							),
						}}
						open={false}
						onToggle={noop}
						onRemove={noop}
						onPasteAsText={noop}
						pasteRefusal={null}
					/>
					<FileChip
						item={{
							key: "r",
							file: sized(
								file("core.dump", "application/octet-stream", 16),
								31_000_000,
							),
							refusal: "Over 25 MB",
						}}
						open={false}
						onToggle={noop}
						onRemove={noop}
						onPasteAsText={noop}
						pasteRefusal={null}
					/>
					<QuoteChipView
						item={{
							key: "q",
							quote: {
								source: { threadId: THREAD, kind: "transcript" },
								text: "The pool hit its cap at 10:02",
							},
							cut: true,
						}}
						onRemove={noop}
					/>
					<RefChip
						item={{
							key: "l",
							ref: {
								kind: "pull_request",
								id: "pr-1",
								label: "#123 · Raise the pool size",
							},
							url: "https://example.com/pr/123",
							tone: "Open",
						}}
						onRemove={noop}
					/>
					<CommandChip
						item={{ name: "review", source: "agent", group: "Codex" }}
						onRemove={noop}
					/>
				</ul>
				<ul className="mt-2 flex flex-wrap gap-1.5">
					<FileChip
						item={{
							key: "p",
							file: file("pasted-text.txt", "text/plain", PASTE.length),
							pasted: PASTE,
						}}
						open
						onToggle={noop}
						onRemove={noop}
						onPasteAsText={noop}
						pasteRefusal={null}
					/>
				</ul>
			</Box>
		),
	},
	{
		id: "composer-menu",
		title: "Composer menu",
		render: () => (
			<div className="grid max-w-[760px] gap-3">
				<ComposerMenu
					trigger="/"
					query=""
					result={MENU}
					loading={false}
					failed={null}
					active={0}
					onActive={noop}
					onPick={noop}
				/>
				<ComposerMenu
					trigger="@"
					query="zzz"
					result={{ hits: [], truncated: false, unavailable: [] }}
					loading={false}
					failed={null}
					active={0}
					onActive={noop}
					onPick={noop}
				/>
				<ComposerMenu
					trigger="@"
					query="pr"
					result={undefined}
					loading
					failed={null}
					active={0}
					onActive={noop}
					onPick={noop}
				/>
				<ComposerMenu
					trigger="#"
					query="12"
					result={undefined}
					loading={false}
					failed="Network error"
					active={0}
					onActive={noop}
					onPick={noop}
				/>
			</div>
		),
	},
	{
		id: "composer-asks",
		title: "Asks at the box",
		render: () => (
			<div className="grid max-w-[760px] gap-3">
				{[QUESTION, APPROVAL, PLAN, INPUT, SECRET, HOST].map((a) => (
					<Box key={a.askId}>
						<AskDock asks={[a]} threadId={THREAD} agent="Codex" />
					</Box>
				))}
				<Box>
					<AskDock
						asks={[QUESTION, APPROVAL, PLAN]}
						threadId={THREAD}
						agent="Codex"
					/>
				</Box>
			</div>
		),
	},
	{
		id: "composer-conflict",
		title: "Draft changed elsewhere",
		render: () => <ConflictLine onKeepMine={noop} onUseTheirs={noop} />,
	},
];
