// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	ChipAttrs,
	ComposerInline,
	PendingAsk,
	ReferenceHit,
	ReferenceSearchResult,
} from "@prismalens/contracts";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import type { ReactNode } from "react";
import { AskDock } from "@/components/thread/composer/AskDock";
import { ComposerMenu } from "@/components/thread/composer/ComposerMenu";
import { ConflictLine } from "@/components/thread/composer/chips";
import {
	ChipContext,
	type ChipFile,
	ChipView,
} from "@/components/thread/composer/editor/ChipView";
import { composerExtensions } from "@/components/thread/composer/editor/extensions";
import type { GallerySection } from "./gallery";

const THREAD = "00000000-0000-4000-8000-000000000001";
const noop = () => {};

const file = (name: string, type: string, size: number) =>
	new File([new Uint8Array(Math.min(size, 16))], name, { type });

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

const chip = (attrs: ChipAttrs): ComposerInline => ({ type: "chip", attrs });
const word = (text: string): ComposerInline => ({ type: "text", text });

const INLINE: ComposerInline[] = [
	word("compare "),
	chip({
		chip: "ref",
		ref: { kind: "thread", id: THREAD, label: "Pool exhaustion on api" },
	}),
	word(" with "),
	chip({
		chip: "ref",
		ref: {
			kind: "pull_request",
			id: "pr-1",
			label: "#123 · Raise the pool size",
		},
		url: "https://example.com/pr/123",
		tone: "Open",
	}),
	word(" and "),
	chip({
		chip: "file",
		key: "img",
		name: "grafana.png",
		type: "image/png",
		size: 812_000,
	}),
];

const FILES: ComposerInline[] = [
	chip({
		chip: "file",
		key: "paste",
		name: "pasted-text.txt",
		type: "text/plain",
		size: PASTE.length,
		pasted: PASTE,
	}),
	word(" "),
	chip({
		chip: "file",
		key: "dump",
		name: "core.dump",
		type: "application/octet-stream",
		size: 31_000_000,
		refusal: "Over 25 MB",
	}),
	word(" "),
	chip({
		chip: "quote",
		quote: {
			source: { threadId: THREAD, kind: "transcript" },
			text: "The pool hit its cap at 10:02",
		},
		cut: true,
	}),
];

const GALLERY_FILES: ReadonlyMap<string, ChipFile> = new Map([
	["img", { file: file("grafana.png", "image/png", 16), preview: PIXEL }],
]);

/** A real composer line: the editor with chips inline; `chosenAt` puts a chip in the selected state. */
function ChipLine({
	parts,
	chosenAt,
}: {
	parts: ComposerInline[];
	chosenAt?: number;
}) {
	const editor = useEditor({
		extensions: composerExtensions({
			chipView: ReactNodeViewRenderer(ChipView, { as: "span" }),
			placeholder: () => "",
		}),
		content: { type: "doc", content: [{ type: "paragraph", content: parts }] },
		immediatelyRender: false,
		editorProps: {
			attributes: {
				class: "composer-editor text-body leading-6 text-text-1",
				"aria-label": "Composer example",
			},
		},
		onCreate: ({ editor: ed }) => {
			if (chosenAt === undefined) return;
			ed.view.dispatch(
				ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, chosenAt)),
			);
		},
	});
	return (
		<ChipContext.Provider
			value={{
				files: GALLERY_FILES,
				pasteAsText: noop,
				pasteRefusal: () => null,
			}}
		>
			<EditorContent editor={editor} />
		</ChipContext.Provider>
	);
}

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
/** Raw MCP tool ids the agent names its asks by: the dock reads them as words (#1105). */
const MCP_OTHER = ask({
	kind: "permission",
	title: "mcp__github__create_issue",
	permission: {
		toolKind: "other",
		options: [
			{ optionId: "a", name: "Allow", kind: "allow_once" },
			{ optionId: "d", name: "Deny", kind: "reject_once" },
		],
		identity: "h2",
	},
});
const MCP_OURS = ask({
	kind: "permission",
	title: "mcp__prismalens__pl_cron_create",
	permission: {
		toolKind: "other",
		options: [
			{ optionId: "a", name: "Allow", kind: "allow_once" },
			{ optionId: "d", name: "Deny", kind: "reject_once" },
		],
		identity: "h3",
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
	source: { kind: "tool", tool: "pl_secret_request", requestId: "r" },
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
		title: "Composer chips, inline",
		render: () => (
			<div className="grid max-w-[760px] gap-3">
				<Box>
					<ChipLine parts={INLINE} />
				</Box>
				<Box>
					<ChipLine parts={INLINE} chosenAt={9} />
				</Box>
				<Box>
					<ChipLine parts={FILES} />
				</Box>
				<Box>
					<ChipLine
						parts={[
							chip({
								chip: "command",
								name: "review",
								source: "agent",
								group: "Codex",
								inputHint: "[commit|branch|pr]",
							}),
						]}
					/>
				</Box>
			</div>
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
				{[
					QUESTION,
					APPROVAL,
					MCP_OTHER,
					MCP_OURS,
					PLAN,
					INPUT,
					SECRET,
					HOST,
				].map((a) => (
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
