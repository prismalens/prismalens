// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ReferenceRef } from "@prismalens/contracts";
import {
	AtSign,
	FileText,
	Hash,
	Link2,
	Quote as QuoteIcon,
	SquareSlash,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { sizeWord } from "@/lib/evidence-files";
import { cn } from "@/lib/utils";
import { firstLine, type QuoteChip as Quoted, scrollToQuote } from "./quote";

const chip =
	"inline-flex h-8 max-w-64 items-center gap-1.5 rounded-control bg-surface-4 pr-1 pl-2 text-meta text-text-1";

function Remove({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<button
			type="button"
			aria-label={`Remove ${label}`}
			onClick={onRemove}
			className="grid size-6 shrink-0 place-items-center rounded-[4px] text-text-3 hover:bg-surface-3 hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent/60"
		>
			<X className="size-3" />
		</button>
	);
}

/** A file in the box: its thumbnail or type and size, and a refusal in place (#1024). */
export interface FileChipItem {
	key: string;
	file: File;
	preview?: string;
	refusal?: string;
	/** A folded paste's text, until it uploads. */
	pasted?: string;
	/** Browser storage refused its bytes: lost on reload until sent. */
	unsaved?: boolean;
}

const pastedLines = (t: string) => t.split("\n").length;

const typeOf = (f: File) =>
	(f.name.includes(".") ? f.name.split(".").pop() : f.type.split("/").pop())
		?.toUpperCase()
		.slice(0, 6) ?? "FILE";

export function FileChip({
	item,
	open,
	onToggle,
	onRemove,
	onPasteAsText,
	pasteRefusal,
}: {
	item: FileChipItem;
	open: boolean;
	onToggle: () => void;
	onRemove: () => void;
	onPasteAsText: () => void;
	/** Why Paste as text would not fit the draft's cap. */
	pasteRefusal: string | null;
}) {
	const name = item.pasted
		? `Pasted text, ${pastedLines(item.pasted)} ${pastedLines(item.pasted) === 1 ? "line" : "lines"}`
		: item.file.name;
	return (
		<li
			className={cn("flex flex-col gap-1", open && "w-full")}
			data-testid="composer-file"
			data-refused={item.refusal ? "" : undefined}
		>
			<span className={cn(chip, item.refusal && "bg-surface-2")}>
				{item.preview ? (
					<img
						src={item.preview}
						alt=""
						className="size-6 rounded-[4px] object-cover"
						data-testid="composer-thumb"
					/>
				) : (
					<FileText className="size-3.5 shrink-0 text-text-3" aria-hidden />
				)}
				{item.pasted ? (
					<button
						type="button"
						onClick={onToggle}
						aria-expanded={open}
						className="truncate hover:underline"
						data-testid="composer-paste-chip"
					>
						{name}
					</button>
				) : (
					<span className="truncate">{name}</span>
				)}
				{!item.pasted && !item.refusal && (
					<span className="shrink-0 text-text-2">
						{typeOf(item.file)}, {sizeWord(item.file.size)}
					</span>
				)}
				{item.refusal && (
					<span
						className="shrink-0 text-danger"
						data-testid="composer-file-refusal"
					>
						{item.refusal}
					</span>
				)}
				{item.unsaved && !item.refusal && (
					<span className="shrink-0 text-text-2">Not saved yet</span>
				)}
				<Remove label={name} onRemove={onRemove} />
			</span>
			{open && item.pasted && (
				<div className="flex flex-col gap-1 rounded-control bg-surface-4 p-2">
					<pre
						// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region must take focus to scroll by keyboard.
						tabIndex={0}
						className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-meta text-text-1"
					>
						{item.pasted}
					</pre>
					<div className="flex items-center gap-2">
						<Button
							variant="text"
							size="sm"
							disabled={!!pasteRefusal}
							onClick={onPasteAsText}
							data-testid="composer-paste-as-text"
						>
							Paste as text
						</Button>
						{pasteRefusal && (
							<span className="text-meta text-danger">{pasteRefusal}</span>
						)}
					</div>
				</div>
			)}
		</li>
	);
}

export function QuoteChipView({
	item,
	onRemove,
}: {
	item: Quoted;
	onRemove: () => void;
}) {
	const q = item.quote;
	// A diff line comment reads as where it sits and what it says (#1101 category 16).
	const line =
		q.source.kind === "diff" && q.comment
			? `${(q.source.path ?? "").split(":").pop()}${q.source.line ? `:${q.source.line}` : ""} · ${q.comment}`
			: firstLine(q);
	return (
		<li className={chip} data-testid="composer-quote">
			<QuoteIcon className="size-3.5 shrink-0 text-text-3" aria-hidden />
			<button
				type="button"
				onClick={() => scrollToQuote(item.quote)}
				className="truncate hover:underline"
				title={item.quote.text.slice(0, 400)}
			>
				{line}
			</button>
			{item.cut && (
				<span className="shrink-0 text-text-2" data-testid="composer-quote-cut">
					cut to 4,000 characters
				</span>
			)}
			<Remove label="quote" onRemove={onRemove} />
		</li>
	);
}

/** A picked reference, or a pasted link a source recognised. */
export interface RefChipItem {
	key: string;
	ref: ReferenceRef;
	/** A pasted link: Backspace turns the chip back into this text. */
	url?: string;
	tone?: string;
}

const REF_ICON: Partial<Record<ReferenceRef["kind"], ReactNode>> = {
	pull_request: <Hash className="size-3.5 shrink-0 text-text-3" aria-hidden />,
	issue: <Hash className="size-3.5 shrink-0 text-text-3" aria-hidden />,
	thread: <Hash className="size-3.5 shrink-0 text-text-3" aria-hidden />,
	incident: <Hash className="size-3.5 shrink-0 text-text-3" aria-hidden />,
};

export function RefChip({
	item,
	onRemove,
}: {
	item: RefChipItem;
	onRemove: () => void;
}) {
	return (
		<li
			className={chip}
			data-testid={item.url ? "composer-link" : "composer-ref"}
			data-ref={`${item.ref.kind}:${item.ref.id}`}
		>
			{item.url ? (
				<Link2 className="size-3.5 shrink-0 text-text-3" aria-hidden />
			) : (
				(REF_ICON[item.ref.kind] ?? (
					<AtSign className="size-3.5 shrink-0 text-text-3" aria-hidden />
				))
			)}
			<span className="truncate">{item.ref.label}</span>
			{item.tone && (
				<span
					className="shrink-0 text-text-2"
					data-testid="composer-link-state"
				>
					{item.tone}
				</span>
			)}
			<Remove label={item.ref.label} onRemove={onRemove} />
		</li>
	);
}

/** A picked command: `/name`, where it goes, and the agent's hint as the box's ghost text. */
export interface CommandChipItem {
	name: string;
	source: "app" | "agent";
	/** The agent's or app's group, shown on the chip. */
	group: string;
	inputHint?: string;
}

export function CommandChip({
	item,
	onRemove,
}: {
	item: CommandChipItem;
	onRemove: () => void;
}) {
	return (
		<li
			className={chip}
			data-testid="composer-command"
			data-source={item.source}
		>
			<SquareSlash className="size-3.5 shrink-0 text-text-3" aria-hidden />
			<span className="font-mono">/{item.name}</span>
			<span className="shrink-0 text-text-2">{item.group}</span>
			<Remove label={`/${item.name}`} onRemove={onRemove} />
		</li>
	);
}

/** The server's draft moved past this browser's journal (#1024). */
export function ConflictLine({
	onKeepMine,
	onUseTheirs,
}: {
	onKeepMine: () => void;
	onUseTheirs: () => void;
}) {
	return (
		<div
			className="flex flex-wrap items-center gap-2 px-3 text-meta text-text-2"
			data-testid="composer-conflict"
		>
			Changed on another device
			<Button
				variant="text"
				size="sm"
				onClick={onKeepMine}
				data-testid="composer-keep-mine"
			>
				Keep mine
			</Button>
			<Button
				variant="text"
				size="sm"
				onClick={onUseTheirs}
				data-testid="composer-use-theirs"
			>
				Use theirs
			</Button>
		</div>
	);
}
