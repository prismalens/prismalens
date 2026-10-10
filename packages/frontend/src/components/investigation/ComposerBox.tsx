// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileText, Paperclip, Plus, X } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai/prompt-input";
import { ActionChip, type ComposerAction } from "@/components/run/ActionChip";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { attachRefusal } from "@/lib/attachments";
import { composerKeyAction } from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

export type { ComposerAction } from "@/components/run/ActionChip";

interface Draft {
	key: string;
	file: File;
	preview?: string;
}

export interface ComposerSend {
	text: string;
	files: File[];
}

export interface ComposerBoxProps {
	/** What Send can do; the first chip picks one (#811). */
	actions: ComposerAction[];
	action: string;
	onAction: (id: string) => void;
	/** Model, effort and access, after the action chip. */
	chips: ReactNode;
	/** `now`: Ctrl+Enter on a live run, which interrupts the agent's step. */
	onSend: (send: ComposerSend, now: boolean) => Promise<void> | void;
	/** A live run: Enter waits for the agent's next pause, Esc stops it. */
	live?: boolean;
	onStop?: () => void;
	stopping?: boolean;
	/** The run kept no session: one way on instead of the box. */
	ended?: { onNewRun: () => void };
	placeholder: string;
	/** Files a prefilled draft starts with. */
	initialFiles?: File[];
	/** Told each change to the files, so a remount starts from them, not the prefill. */
	onFilesChange?: (files: File[]) => void;
	/** Kept current with what is in the box. */
	boxRef?: MutableRefObject<ComposerSend | null>;
	text: string;
	setText: (text: string) => void;
	agent: { label: string; images: boolean | null };
	/** Messages queued for the agent's next pause. */
	waiting?: number;
	isPending?: boolean;
	/** Why nothing can be sent now: chips and Send are withheld with it. */
	blockedReason?: string;
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	autoFocus?: boolean;
	/** Lines above the box: where the result goes, a queued message. */
	above?: ReactNode;
	/** The new conversation's box floats in the middle of the page. */
	floating?: boolean;
}

const release = (drafts: Draft[]) => {
	for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
};

const draftOf = (file: File): Draft => ({
	key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
	file,
	...(file.type.startsWith("image/")
		? { preview: URL.createObjectURL(file) }
		: {}),
});

/**
 * The box (#811): the text, then one chip row: what Send does, model,
 * effort, access; attach and Send at the end. The overview's chat box is the
 * same component with its own actions.
 */
export function ComposerBox({
	actions,
	action,
	onAction,
	chips,
	onSend,
	live = false,
	onStop,
	stopping,
	ended,
	placeholder,
	initialFiles,
	onFilesChange,
	boxRef,
	text,
	setText,
	agent,
	waiting = 0,
	isPending,
	blockedReason,
	undeliverable,
	onSaveAsNote,
	autoFocus,
	above,
	floating,
}: ComposerBoxProps) {
	const [drafts, setDrafts] = useState<Draft[]>(() =>
		(initialFiles ?? []).map(draftOf),
	);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const blocked = !live && !!blockedReason;
	const current = actions.find((a) => a.id === action) ?? actions[0];
	const hasText = !!text.trim();
	const busy = sending || !!isPending;
	const canSend = !busy && !blocked && (hasText || !current?.needsText);

	const shown = useRef(drafts);
	shown.current = drafts;
	useEffect(() => {
		if (boxRef) boxRef.current = { text, files: drafts.map((d) => d.file) };
	}, [boxRef, text, drafts]);
	const filesChanged = useRef(onFilesChange);
	filesChanged.current = onFilesChange;
	useEffect(() => {
		filesChanged.current?.(drafts.map((d) => d.file));
	}, [drafts]);
	useEffect(() => () => release(shown.current), []);
	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);

	const add = (files: File[]) => {
		let count = drafts.length;
		const next: Draft[] = [];
		let why: string | null = null;
		for (const file of files) {
			const no = attachRefusal(file, agent, count);
			if (no) {
				why = no;
				continue;
			}
			count++;
			next.push(draftOf(file));
		}
		setRefusal(why);
		if (next.length) setDrafts((d) => [...d, ...next]);
	};

	const submit = async (now: boolean) => {
		if (!canSend) return;
		setSending(true);
		try {
			await onSend(
				{ text: text.trim(), files: drafts.map((d) => d.file) },
				now,
			);
			setText("");
			release(drafts);
			setDrafts([]);
			setRefusal(null);
		} catch (e) {
			// The server's own reason, from an oRPC refusal's data when it has one (#531).
			setRefusal(getErrorMessage(e));
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		const key = composerKeyAction(
			{
				key: e.key,
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				altKey: e.altKey,
				isComposing: e.nativeEvent.isComposing,
			},
			live ? "live" : "draft",
			live && !stopping,
		);
		if (!key) return;
		e.preventDefault();
		e.stopPropagation();
		if (key === "stop") onStop?.();
		else if (key === "blur") ref.current?.blur();
		else void submit(key === "now");
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.clipboardData.files);
		if (!files.length) return;
		e.preventDefault();
		add(files);
	};
	const onDrop = (e: DragEvent<HTMLFormElement>) => {
		if (!e.dataTransfer.files.length) return;
		e.preventDefault();
		add(Array.from(e.dataTransfer.files));
	};

	if (ended)
		return (
			<div className="flex flex-col gap-1" data-testid="composer-box">
				{above}
				<div
					className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5 text-text-2"
					data-testid="composer-no-session"
				>
					<span className="min-w-0 flex-1">
						This run kept no agent session, so it can't continue. Start a new
						run.
					</span>
					<Button
						variant="secondary"
						onClick={ended.onNewRun}
						data-testid="composer-new-run"
					>
						<Plus />
						New run
					</Button>
				</div>
			</div>
		);

	const clipHint =
		agent.images === true
			? "Attach a screenshot or a log"
			: agent.images === false
				? `${agent.label} can't take images. Text files only.`
				: "Images: not checked yet. Text files only.";

	return (
		<div className="flex flex-col gap-1" data-testid="composer-box">
			{above}
			<PromptInput
				data-live={live ? "" : undefined}
				className={cn(
					"rounded-[10px] bg-surface-2 [&>[data-slot=input-group]]:bg-transparent",
					floating && "shadow-float",
				)}
				onSubmit={() => void submit(false)}
				onDragOver={(e) => e.preventDefault()}
				onDrop={onDrop}
			>
				<PromptInputBody>
					{drafts.length > 0 && (
						<ul
							className="mb-2 flex flex-wrap gap-1.5"
							data-testid="composer-files"
						>
							{drafts.map((d) => (
								<li
									key={d.key}
									className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-control bg-surface-3 pr-1 pl-1 text-meta text-text-1"
									data-testid="composer-file"
								>
									{d.preview ? (
										<img
											src={d.preview}
											alt=""
											className="size-6 rounded-[4px] object-cover"
											data-testid="composer-thumb"
										/>
									) : (
										<FileText className="ml-1 size-3.5 shrink-0 text-text-3" />
									)}
									<span className="truncate">{d.file.name}</span>
									<button
										type="button"
										aria-label={`Remove ${d.file.name}`}
										onClick={() => {
											release([d]);
											setDrafts((all) => all.filter((x) => x !== d));
										}}
										className="rounded-[4px] p-0.5 text-text-3 hover:bg-surface-4 hover:text-text-1"
									>
										<X className="size-3" />
									</button>
								</li>
							))}
						</ul>
					)}
					<PromptInputTextarea
						ref={ref}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={onKeyDown}
						onPaste={onPaste}
						disabled={blocked}
						placeholder={placeholder}
						aria-label={placeholder}
						className="min-h-6"
						data-testid="composer-input"
					/>
				</PromptInputBody>
				<PromptInputFooter className="-ml-1.5 max-sm:flex-wrap">
					{/* Narrow, the chips wrap: a hidden-scrollbar row clipped a chip's label (#673 walk 4, QA-06). */}
					<PromptInputTools
						className="min-w-0 flex-1 flex-wrap gap-0.5 gap-y-1"
						data-testid="composer-chips"
					>
						<ActionChip
							actions={actions}
							value={current?.id ?? ""}
							onChange={onAction}
							disabled={blocked}
						/>
						{chips}
					</PromptInputTools>
					<div className="ml-auto flex shrink-0 items-center gap-0.5">
						{live && waiting > 0 && (
							<span
								className="px-1 text-meta text-warn tabular-nums"
								data-testid="composer-waiting"
							>
								{waiting} waiting
							</span>
						)}
						<Hint label={clipHint} side="top">
							<PromptInputButton
								aria-label="Attach a file"
								disabled={blocked}
								onClick={() => picker.current?.click()}
								className="w-8 text-text-3"
								data-testid="composer-attach"
							>
								<Paperclip className="size-3.5" />
							</PromptInputButton>
						</Hint>
						<input
							ref={picker}
							type="file"
							multiple
							hidden
							accept={
								agent.images === true
									? "image/png,image/jpeg,image/webp,image/gif,text/*,.log,.json,.csv,.md,.txt,.yaml,.yml"
									: "text/*,.log,.json,.csv,.md,.txt,.yaml,.yml"
							}
							onChange={(e) => {
								if (e.target.files) add(Array.from(e.target.files));
								e.target.value = "";
							}}
							data-testid="composer-file-input"
						/>
						<Hint
							label={current ? current.label : "Send"}
							keys={["Enter"]}
							side="top"
						>
							<span className="inline-flex">
								<PromptInputSubmit
									status={busy ? "submitted" : undefined}
									disabled={!canSend}
									aria-label={current ? current.label : "Send"}
									data-testid="composer-send"
								/>
							</span>
						</Hint>
					</div>
				</PromptInputFooter>
			</PromptInput>
			{(blocked || refusal) && (
				<p
					className={cn(
						"px-3 text-meta",
						refusal ? "text-danger" : "text-text-2",
					)}
					data-testid={refusal ? "composer-refusal" : "composer-blocked"}
				>
					{refusal ?? blockedReason}
				</p>
			)}
			{undeliverable && (
				<div
					className="flex flex-wrap items-center gap-2 px-3 text-meta text-danger"
					data-testid="composer-undeliverable"
				>
					The run ended before your message reached it.
					{onSaveAsNote && (
						<Button
							variant="text"
							size="sm"
							onClick={() => onSaveAsNote(undeliverable)}
						>
							Save as note
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
