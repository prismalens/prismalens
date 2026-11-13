// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ChipAttrs } from "@prismalens/contracts";
import { closeHistory } from "@tiptap/pm/history";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
	AtSign,
	FileText,
	Hash,
	Link2,
	Quote as QuoteIcon,
	SquareSlash,
	UnfoldVertical,
	X,
} from "lucide-react";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { runAction } from "@/components/kit/registry";
import { Surface } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import { sizeWord } from "@/lib/evidence-files";
import { bindingOf } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { scrollToQuote } from "../quote";
import type { ChipCtx } from "./chip.actions";
import { chipAttrs, DISCRETE } from "./extensions";

/** The bytes behind a file chip, kept beside the document by its key. */
export interface ChipFile {
	file: File;
	preview?: string;
	/** Browser storage refused its bytes: lost on reload until sent. */
	unsaved?: boolean;
}

export interface ChipContextValue {
	files: ReadonlyMap<string, ChipFile>;
	/** A folded paste back into the box as text, in the chip's place. */
	pasteAsText: (key: string) => void;
	/** Why expanding would not fit the draft's cap. */
	pasteRefusal: (pasted: string) => string | null;
}

export const ChipContext = createContext<ChipContextValue>({
	files: new Map(),
	pasteAsText: () => {},
	pasteRefusal: () => null,
});

/** Enter on a selected chip opens its detail (#1101 category 7 row 14). */
export const CHIP_OPEN_EVENT = "pl-chip-open";
/** The `chip.expand` key on a selected folded paste (#1101). */
export const CHIP_EXPAND_EVENT = "pl-chip-expand";

const lines = (t: string) => t.split("\n").length;

const typeOf = (name: string, type: string) =>
	(name.includes(".") ? name.split(".").pop() : type.split("/").pop())
		?.toUpperCase()
		.slice(0, 6) ?? "FILE";

const HASH = new Set(["pull_request", "issue", "thread", "incident"]);

function label(a: ChipAttrs): string {
	switch (a.chip) {
		case "command":
			return `/${a.name}`;
		case "ref":
			return a.ref.label;
		case "quote": {
			const q = a.quote;
			// A diff line comment reads as where it sits and what it says (#1101 category 16).
			if (q.source.kind === "diff" && q.comment)
				return `${(q.source.path ?? "").split(":").pop()}${q.source.line ? `:${q.source.line}` : ""} · ${q.comment}`;
			return q.text.split("\n")[0]?.slice(0, 80) ?? "";
		}
		case "file":
			return a.pasted
				? `Pasted text, ${lines(a.pasted)} ${lines(a.pasted) === 1 ? "line" : "lines"}`
				: a.name;
	}
}

function testId(a: ChipAttrs): string {
	if (a.chip === "ref") return a.url ? "composer-link" : "composer-ref";
	if (a.chip === "command") return "composer-command";
	if (a.chip === "quote") return "composer-quote";
	return "composer-file";
}

function icon(a: ChipAttrs, preview?: string): ReactNode {
	const cls = "size-3.5 shrink-0 text-text-3";
	if (a.chip === "command") return <SquareSlash className={cls} aria-hidden />;
	if (a.chip === "quote") return <QuoteIcon className={cls} aria-hidden />;
	if (a.chip === "file")
		return preview ? (
			<img
				src={preview}
				alt=""
				className="size-5 rounded-[4px] object-cover"
				data-testid="composer-thumb"
			/>
		) : (
			<FileText className={cls} aria-hidden />
		);
	if (a.url) return <Link2 className={cls} aria-hidden />;
	return HASH.has(a.ref.kind) ? (
		<Hash className={cls} aria-hidden />
	) : (
		<AtSign className={cls} aria-hidden />
	);
}

/** A chip inside the editor's text: a file, paste, quote, reference or command (#1101). */
export function ChipView({ node, selected, editor, getPos }: NodeViewProps) {
	const ctx = useContext(ChipContext);
	const a = chipAttrs(node.attrs);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	const expandNow = useRef(() => {});
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const onOpen = () => setOpen(true);
		const onExpand = () => expandNow.current();
		el.addEventListener(CHIP_OPEN_EVENT, onOpen);
		el.addEventListener(CHIP_EXPAND_EVENT, onExpand);
		return () => {
			el.removeEventListener(CHIP_OPEN_EVENT, onOpen);
			el.removeEventListener(CHIP_EXPAND_EVENT, onExpand);
		};
	}, []);
	if (!a) return <NodeViewWrapper as="span" />;
	const file = a.chip === "file" ? ctx.files.get(a.key) : undefined;
	// A file chip whose bytes stayed on another device or another box says so.
	const missing =
		a.chip === "file" && !a.pasted && !a.refusal && !file
			? "Not on this device"
			: null;
	const refusal = (a.chip === "file" && a.refusal) || missing;
	const name = label(a);
	const remove = () => {
		const pos = getPos();
		if (typeof pos !== "number") return;
		const tr = closeHistory(editor.state.tr);
		tr.setMeta(DISCRETE, true).delete(pos, pos + node.nodeSize);
		editor.view.dispatch(tr);
		editor.commands.focus();
	};
	const pasteRefusal =
		a.chip === "file" && a.pasted ? ctx.pasteRefusal(a.pasted) : null;
	const folded = a.chip === "file" && !!a.pasted;
	const chipCtx: ChipCtx = {
		open: () => setOpen(true),
		remove,
		expand: () => {
			setOpen(false);
			if (a.chip === "file") ctx.pasteAsText(a.key);
		},
		facts: { is: { folded, overLimit: !!pasteRefusal } },
	};
	const expand = () => runAction("chip.expand", chipCtx);
	expandNow.current = expand;
	return (
		<NodeViewWrapper
			as="span"
			ref={ref}
			className="composer-chip"
			data-testid={testId(a)}
			data-selected={selected ? "" : undefined}
			data-ref={a.chip === "ref" ? `${a.ref.kind}:${a.ref.id}` : undefined}
			data-source={a.chip === "command" ? a.source : undefined}
			data-refused={refusal ? "" : undefined}
			data-drag-handle=""
		>
			<Surface id="attachment.chip" ctx={chipCtx}>
				<span
					className={cn(
						"mx-px inline-flex h-6 max-w-64 items-center gap-1 rounded-control bg-surface-4 pr-0.5 pl-1.5 align-middle text-meta text-text-1",
						refusal && "bg-surface-3",
						selected && "ring-2 ring-accent/60",
					)}
				>
					<Popover open={open} onOpenChange={setOpen}>
						<PopoverAnchor asChild>
							<button
								type="button"
								tabIndex={-1}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => setOpen((o) => !o)}
								aria-expanded={open}
								aria-label={`${name}: details`}
								className="inline-flex min-w-0 items-center gap-1 hover:underline"
								data-testid={
									a.chip === "file" && a.pasted
										? "composer-paste-chip"
										: "composer-chip-open"
								}
							>
								{icon(a, file?.preview)}
								<span
									className={cn(
										"truncate",
										a.chip === "command" && "font-mono",
									)}
								>
									{name}
								</span>
							</button>
						</PopoverAnchor>
						{a.chip === "command" && (
							<span className="shrink-0 text-text-2">{a.group}</span>
						)}
						{a.chip === "ref" && a.tone && (
							<span
								className="shrink-0 text-text-2"
								data-testid="composer-link-state"
							>
								{a.tone}
							</span>
						)}
						{a.chip === "quote" && a.cut && (
							<span
								className="shrink-0 text-text-2"
								data-testid="composer-quote-cut"
							>
								cut to 4,000 characters
							</span>
						)}
						{a.chip === "file" && !a.pasted && !refusal && (
							<span className="shrink-0 text-text-2">
								{typeOf(a.name, a.type)}, {sizeWord(a.size)}
							</span>
						)}
						{refusal && (
							<span
								className="shrink-0 text-danger"
								data-testid="composer-file-refusal"
							>
								{refusal}
							</span>
						)}
						{file?.unsaved && !refusal && (
							<span className="shrink-0 text-text-2">Not saved yet</span>
						)}
						{folded && (
							<Hint
								label={pasteRefusal ?? "Expand into the box"}
								keys={[bindingOf("chip.expand")]}
								side="top"
							>
								<button
									type="button"
									tabIndex={-1}
									aria-label="Expand into the box"
									aria-disabled={pasteRefusal ? true : undefined}
									onMouseDown={(e) => e.preventDefault()}
									onClick={expand}
									className={cn(
										"grid size-5 shrink-0 place-items-center rounded-[4px] text-text-3 hover:bg-surface-3 hover:text-text-1 max-sm:-my-3 max-sm:size-11",
										pasteRefusal && "opacity-50",
									)}
									data-testid="composer-chip-expand"
								>
									<UnfoldVertical className="size-3" aria-hidden />
								</button>
							</Hint>
						)}
						<button
							type="button"
							tabIndex={-1}
							aria-label={`Remove ${name}`}
							onMouseDown={(e) => e.preventDefault()}
							onClick={remove}
							className="grid size-5 shrink-0 place-items-center rounded-[4px] text-text-3 hover:bg-surface-3 hover:text-text-1 max-sm:-my-3 max-sm:size-11"
							data-testid="composer-chip-remove"
						>
							<X className="size-3" />
						</button>
						<PopoverContent
							side="top"
							align="start"
							sideOffset={6}
							className="flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 p-2"
							data-testid="composer-chip-detail"
							onCloseAutoFocus={(e) => {
								e.preventDefault();
								editor.commands.focus();
							}}
						>
							<Detail
								a={a}
								file={file}
								pasteRefusal={pasteRefusal}
								onPasteAsText={expand}
							/>
						</PopoverContent>
					</Popover>
				</span>
			</Surface>
		</NodeViewWrapper>
	);
}

function Detail({
	a,
	file,
	pasteRefusal,
	onPasteAsText,
}: {
	a: ChipAttrs;
	file: ChipFile | undefined;
	pasteRefusal: string | null;
	onPasteAsText: () => void;
}) {
	if (a.chip === "file" && a.pasted)
		return (
			<>
				<pre
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard.
					tabIndex={0}
					className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-meta text-text-1"
				>
					{a.pasted}
				</pre>
				<div className="flex items-center gap-2">
					<Button
						variant="text"
						size="sm"
						disabled={!!pasteRefusal}
						onClick={onPasteAsText}
						data-testid="composer-paste-as-text"
					>
						Expand into the box
					</Button>
					{pasteRefusal && (
						<span className="text-meta text-danger">{pasteRefusal}</span>
					)}
				</div>
			</>
		);
	if (a.chip === "file")
		return (
			<>
				{file?.preview && (
					<img
						src={file.preview}
						alt={a.name}
						className="max-h-60 rounded-control object-contain"
					/>
				)}
				<p className="text-meta text-text-2">
					{a.name}, {sizeWord(a.size)}
					{a.refusal ? `. ${a.refusal}` : ""}
				</p>
			</>
		);
	if (a.chip === "quote")
		return (
			<>
				<p className="max-h-48 overflow-auto whitespace-pre-wrap text-meta text-text-1">
					{a.quote.text}
				</p>
				<Button
					variant="text"
					size="sm"
					onClick={() => scrollToQuote(a.quote)}
					className="self-start"
				>
					Show source
				</Button>
			</>
		);
	if (a.chip === "command")
		return (
			<p className="text-meta text-text-2">
				<span className="font-mono text-text-1">/{a.name}</span> goes to{" "}
				{a.group}
				{a.inputHint ? `. Takes ${a.inputHint}` : ""}
			</p>
		);
	return (
		<p className="text-meta text-text-2">
			<span className="text-text-1">{a.ref.label}</span>
			{a.url ? `. ${a.url}` : ""}
		</p>
	);
}
