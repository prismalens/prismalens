// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import {
	FileText,
	GitBranch,
	Paperclip,
	Play,
	Plus,
	Repeat,
	Square,
	X,
} from "lucide-react";
import {
	type ClipboardEvent,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	AccessChip,
	EffortChip,
	effortLevels,
	ModelChip,
} from "@/components/agent/AgentPicker";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai/prompt-input";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { attachRefusal } from "@/lib/attachments";
import { composerKeyAction } from "@/lib/composer-keys";
import {
	envelopeOf,
	type SendEnvelope,
	type SendReceipt,
	type SendResult,
} from "@/lib/composer-send";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

/** What the box holds now, for a page that reads it without sending (a handoff). */
export interface ComposerSend {
	text: string;
	files: File[];
}

/** A send's answer: the box clears only on `sent` (lib/composer-send.ts). */
export type ComposerReply = SendResult | SendReceipt;

/** Chosen beside the text by a lane (quotes, references, the saved draft); merged into each send. */
export type EnvelopeExtras = Partial<
	Pick<SendEnvelope, "quotes" | "references" | "draftScope" | "draftRev">
>;

/** What the one action button does: Send, Stop while the agent works, Resume a cut-off run. */
export type ComposerState = "ready" | "live" | "interrupted";

export interface ComposerChoice {
	harness: HarnessStatus | undefined;
	model: string;
	effort: string | null;
	accessLevel: AccessLevel;
}

/** A `/` menu entry: an app action, never an agent command (#1020). */
export interface SlashCommand {
	id: string;
	label: string;
	/** One quiet line: what it does and where the result goes. */
	detail?: string;
	run: () => void;
}

/** What Send does when the box can do more than one thing, shown above the box. */
export interface ComposerMode {
	id: string;
	label: string;
	/** Back to the box's first way to send; absent when this is it. */
	onClear?: () => void;
}

/** One thing the box's Send can do: Ask, Investigate, Note, Continue Run 2, Message. */
export interface ComposerAction {
	id: string;
	label: string;
	/** One line: what happens and where the result goes. */
	detail: string;
	/** Send does nothing on an empty box. */
	needsText: boolean;
}

/**
 * A box with several actions shows the current one above it and offers the rest
 * under `/` (#1020); with one action, the placeholder says what Send does.
 */
export function actionProps(
	actions: ComposerAction[],
	value: string,
	onAction: (id: string) => void,
): Pick<ComposerProps, "mode" | "slash" | "emptySend" | "sendLabel"> {
	const current = actions.find((a) => a.id === value) ?? actions[0];
	const first = actions[0];
	if (!current || !first) return {};
	const base = {
		emptySend: !current.needsText,
		sendLabel: current.label,
	};
	if (actions.length < 2) return base;
	return {
		...base,
		mode: {
			id: current.id,
			label: current.label,
			...(current.id !== first.id ? { onClear: () => onAction(first.id) } : {}),
		},
		slash: actions
			.filter((a) => a.id !== current.id)
			.map((a) => ({
				id: a.id,
				label: a.label,
				detail: a.detail,
				run: () => onAction(a.id),
			})),
	};
}

export interface ComposerProps {
	state: ComposerState;
	onSend: (
		envelope: SendEnvelope,
		now: boolean,
	) => Promise<ComposerReply> | ComposerReply;
	/** Merged into every envelope this box sends. */
	extras?: EnvelopeExtras;
	/** The page's footer slot, under the box. */
	footer?: ReactNode;
	onStop?: () => void;
	stopping?: boolean;
	onResume?: () => void;
	resuming?: boolean;
	placeholder: string;
	choice: ComposerChoice;
	onChoice: (next: Partial<ComposerChoice> & { harnessId?: HarnessId }) => void;
	/** A follow-up keeps the run's agent and level: the chips show them, read-only. */
	locked?: boolean;
	/** The branch a new thread starts from, above the box; a follow-up's is in the status box. */
	branch?: string | null;
	/** The agent's asks, docked on the box. */
	dock?: ReactNode;
	/** Why nothing can be sent now. */
	blockedReason?: string | null;
	autoFocus?: boolean;
	/** A row above the box: a new thread's subject and Incident toggle. */
	top?: ReactNode;
	/** What `/` offers; the text typed after it narrows the list. */
	slash?: SlashCommand[];
	/** What Send does now, when the box can do more than one thing. */
	mode?: ComposerMode;
	/** The text, when the page keeps it (a draft survives a remount). */
	text?: string;
	onText?: (text: string) => void;
	/** Files a prefilled draft starts with, and each change to them. */
	initialFiles?: File[];
	onFilesChange?: (files: File[]) => void;
	/** Kept current with what is in the box. */
	boxRef?: MutableRefObject<ComposerSend | null>;
	/** Access is shown read-only with this reason; the agent chips stay live. */
	accessHint?: string;
	/** The message goes to no agent (a note): no agent chips. */
	agentless?: boolean;
	/** Send works on an empty box (an investigation's brief is optional). */
	emptySend?: boolean;
	sendLabel?: string;
	/** The run cannot take a message: one way on instead of the box, with the server's reason. */
	ended?: { onNewRun: () => void; onRecheck?: () => void; reason?: string };
	/** A line under the box that leaves it usable. */
	notice?: string;
	/** Send waits, e.g. on a handoff preview. */
	holdSend?: boolean;
	pending?: boolean;
	/** A message the run ended before taking, offered as a note. */
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	/** Lines above the box: where the result goes. */
	above?: ReactNode;
	/** A new conversation's box floats in the middle of the page. */
	floating?: boolean;
	/** The box takes no files (a schedule's saved text): no attach, no pasted files. */
	noFiles?: boolean;
	/** Beside Send: save this text as a schedule instead (#1020). */
	onRepeat?: (text: string) => void;
	/** Each change focuses the box with the caret at the end, e.g. after a quote fills it. */
	focusSignal?: number;
}

interface Draft {
	key: string;
	file: File;
	preview?: string;
}

const without = (id: string) => (h: ReadonlySet<string>) => {
	const next = new Set(h);
	next.delete(id);
	return next;
};

const release = (drafts: Draft[]) => {
	for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
};

const draftOf = (file: File): Draft => ({
	key: `${file.name}-${crypto.randomUUID()}`,
	file,
	...(file.type.startsWith("image/")
		? { preview: URL.createObjectURL(file) }
		: {}),
});

const TEXT_TYPES = "text/*,.log,.json,.csv,.md,.txt,.yaml,.yml";

/**
 * The one composer (#1020): above the box what the thread is about, inside it how the
 * agent runs (attach, model, effort, access, Send / Stop / Resume), under it only a
 * blocked reason or an error.
 */
export function Composer({
	state,
	onSend,
	extras,
	footer,
	onStop,
	stopping,
	onResume,
	resuming,
	placeholder,
	choice,
	onChoice,
	locked,
	branch,
	dock,
	blockedReason,
	autoFocus,
	top,
	slash,
	mode,
	text: keptText,
	onText,
	initialFiles,
	onFilesChange,
	boxRef,
	accessHint,
	agentless,
	emptySend,
	sendLabel = "Send",
	ended,
	notice,
	holdSend,
	pending,
	undeliverable,
	onSaveAsNote,
	above,
	floating,
	noFiles,
	onRepeat,
	focusSignal,
}: ComposerProps) {
	const [ownText, setOwnText] = useState("");
	const text = keptText ?? ownText;
	const setText = onText ?? setOwnText;
	const [drafts, setDrafts] = useState<Draft[]>(() =>
		(initialFiles ?? []).map(draftOf),
	);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const live = state === "live";
	const blocked = !!blockedReason;
	const hasText = !!text.trim();
	// A deferred draft stays locked while it is unchanged; editing it makes a new send.
	const draftId = JSON.stringify([text.trim(), drafts.map((d) => d.key)]);
	const busy = sending || held.has(draftId) || !!pending;
	const canSend = !busy && !blocked && !holdSend && (hasText || !!emptySend);
	const slashQuery = /^\/(\w*)$/.exec(text)?.[1]?.toLowerCase();
	const commands =
		slash && slashQuery !== undefined
			? slash.filter((c) => c.id.startsWith(slashQuery))
			: [];
	const runCommand = (c: SlashCommand) => {
		setText("");
		c.run();
		ref.current?.focus();
	};
	const { harness } = choice;
	const agent = {
		label: harness?.label ?? "The agent",
		images:
			harness?.checked?.outcome === "answers-acp"
				? harness.checked.images
				: null,
	};

	useEffect(() => {
		if (autoFocus) ref.current?.focus();
	}, [autoFocus]);
	useEffect(() => {
		const box = ref.current;
		if (!focusSignal || !box) return;
		box.focus();
		box.setSelectionRange(box.value.length, box.value.length);
	}, [focusSignal]);
	const shown = useRef(drafts);
	shown.current = drafts;
	const textNow = useRef(text);
	textNow.current = text;
	useEffect(() => {
		if (boxRef) boxRef.current = { text, files: drafts.map((d) => d.file) };
	}, [boxRef, text, drafts]);
	const filesChanged = useRef(onFilesChange);
	filesChanged.current = onFilesChange;
	useEffect(() => {
		filesChanged.current?.(drafts.map((d) => d.file));
	}, [drafts]);
	useEffect(() => () => release(shown.current), []);

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

	const clear = (sentText: string, sentKeys: Set<string>) => {
		// A deferred send that lands later clears the text and files it carried, no others.
		if (textNow.current.trim() === sentText) setText("");
		release(shown.current.filter((d) => sentKeys.has(d.key)));
		setDrafts((d) => d.filter((x) => !sentKeys.has(x.key)));
		setRefusal(null);
	};
	const submit = async (now: boolean) => {
		if (!canSend) return;
		setSending(true);
		const sentText = text.trim();
		const sent = drafts;
		const sentKeys = new Set(sent.map((d) => d.key));
		const sentId = JSON.stringify([sentText, sent.map((d) => d.key)]);
		try {
			const reply = await onSend(
				{
					...envelopeOf(
						sentText,
						sent.map((d) => d.file),
					),
					...extras,
				},
				now,
			);
			const receipt = typeof reply === "string" ? { result: reply } : reply;
			if (receipt.result === "sent") clear(sentText, sentKeys);
			else if (receipt.result === "deferred") {
				setHeld((h) => new Set(h).add(sentId));
				void receipt.settled?.then(
					(r) => {
						setHeld(without(sentId));
						if (r === "sent") clear(sentText, sentKeys);
					},
					(e: unknown) => {
						setHeld(without(sentId));
						setRefusal(getErrorMessage(e));
					},
				);
			}
		} catch (e) {
			setRefusal(getErrorMessage(e));
		} finally {
			setSending(false);
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		const first = commands[0];
		if (
			first &&
			e.key === "Enter" &&
			!e.shiftKey &&
			!e.nativeEvent.isComposing
		) {
			e.preventDefault();
			runCommand(first);
			return;
		}
		const key = composerKeyAction(
			{
				key: e.key,
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				altKey: e.altKey,
				isComposing: e.nativeEvent.isComposing,
			},
			live ? "live" : state === "interrupted" ? "resume" : "draft",
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
		if (!files.length || noFiles) return;
		e.preventDefault();
		add(files);
	};

	const action =
		live && !hasText && onStop ? (
			<Hint label="Stop" keys={["Esc"]} side="top">
				<PromptInputButton
					aria-label="Stop"
					disabled={stopping}
					onClick={onStop}
					className="w-8 rounded-full bg-text-1 text-canvas hover:bg-text-2"
					data-testid="composer-stop"
				>
					<Square className="size-3 fill-current" />
				</PromptInputButton>
			</Hint>
		) : state === "interrupted" && !hasText && onResume ? (
			<Hint label="Resume" side="top">
				<PromptInputButton
					aria-label="Resume"
					disabled={resuming}
					onClick={onResume}
					className="w-8 rounded-full bg-text-1 text-canvas hover:bg-text-2"
					data-testid="composer-resume"
				>
					<Play className="size-3 fill-current" />
				</PromptInputButton>
			</Hint>
		) : (
			<>
				{onRepeat && (
					<Hint label="Repeat…" side="top">
						<PromptInputButton
							aria-label="Repeat…"
							disabled={!hasText || busy}
							onClick={() => onRepeat(text.trim())}
							className="w-8 text-text-3"
							data-testid="composer-repeat"
						>
							<Repeat className="size-3.5" />
						</PromptInputButton>
					</Hint>
				)}
				<Hint label={sendLabel} keys={["Enter"]} side="top">
					<span className="inline-flex">
						<PromptInputSubmit
							status={busy ? "submitted" : undefined}
							disabled={!canSend}
							aria-label={sendLabel}
							data-testid="composer-send"
						/>
					</span>
				</Hint>
			</>
		);

	if (ended)
		return (
			<div className="flex flex-col gap-1" data-testid="thread-composer">
				{above}
				<div
					className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5 text-text-2"
					data-testid="composer-no-session"
				>
					<span className="min-w-0 flex-1">
						{ended.reason ??
							"This run kept no agent session, so it can't continue. Start a new run."}
					</span>
					{ended.onRecheck && (
						<Button
							variant="secondary"
							onClick={ended.onRecheck}
							data-testid="composer-recheck"
						>
							Investigate again
						</Button>
					)}
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

	const hasEffort = effortLevels(harness).length > 0;
	const clipHint =
		agent.images === true
			? "Attach a screenshot or a log"
			: agent.images === false
				? `${agent.label} can't take images. Text files only.`
				: "Images: not checked yet. Text files only.";
	const docked = !!dock || drafts.length > 0;
	return (
		<div className="flex flex-col gap-1" data-testid="thread-composer">
			{above}
			{(top || branch || mode) && (
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					{top}
					{mode && (
						<span
							className="inline-flex h-7 items-center gap-1 rounded-control bg-surface-3 pr-1 pl-2 text-meta font-medium text-text-1"
							data-testid="composer-mode"
							data-mode={mode.id}
						>
							{mode.label}
							{mode.onClear && (
								<button
									type="button"
									aria-label={`Clear ${mode.label}`}
									onClick={mode.onClear}
									className="rounded-[4px] p-0.5 text-text-3 hover:bg-surface-4 hover:text-text-1"
									data-testid="composer-mode-clear"
								>
									<X className="size-3" />
								</button>
							)}
						</span>
					)}
					{branch && (
						<span
							className="inline-flex h-7 min-w-0 items-center gap-1 px-1.5 text-meta text-text-3"
							data-testid="composer-branch"
						>
							<GitBranch className="size-3.5 shrink-0" aria-hidden />
							<span className="truncate">{branch}</span>
						</span>
					)}
				</div>
			)}
			{commands.length > 0 && (
				<ul
					aria-label="Commands"
					className="flex flex-col gap-px rounded-[10px] bg-surface-2 p-1"
					data-testid="composer-slash"
				>
					{commands.map((c, i) => (
						<li key={c.id}>
							<button
								type="button"
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => runCommand(c)}
								className={cn(
									"flex h-8 w-full items-center gap-2 rounded-control px-2.5 text-left text-body text-text-1 hover:bg-surface-3",
									i === 0 && "bg-surface-3",
								)}
								data-testid={`composer-slash-${c.id}`}
							>
								<span className="font-mono text-meta text-text-3">/{c.id}</span>
								<span className="shrink-0">{c.label}</span>
								{c.detail && (
									<span className="min-w-0 truncate text-meta text-text-3">
										{c.detail}
									</span>
								)}
							</button>
						</li>
					))}
				</ul>
			)}
			<div
				className={cn(
					"overflow-hidden rounded-[10px] bg-surface-2 focus-within:ring-2 focus-within:ring-accent/60",
					floating && "shadow-float",
				)}
			>
				{docked && (
					<div
						className="flex flex-col gap-2.5 bg-surface-3 px-3 pt-2.5 pb-2"
						data-testid="composer-dock"
					>
						{dock}
						{drafts.length > 0 && (
							<ul
								className="flex flex-wrap gap-1.5"
								data-testid="composer-files"
							>
								{drafts.map((d) => (
									<li
										key={d.key}
										className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-control bg-surface-4 pr-1 pl-2 text-meta text-text-1"
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
											<FileText className="size-3.5 shrink-0 text-text-3" />
										)}
										<span className="truncate">{d.file.name}</span>
										<button
											type="button"
											aria-label={`Remove ${d.file.name}`}
											onClick={() => {
												release([d]);
												setDrafts((all) => all.filter((x) => x !== d));
											}}
											className="rounded-[4px] p-0.5 text-text-3 hover:bg-surface-3 hover:text-text-1"
										>
											<X className="size-3" />
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
				)}
				<PromptInput
					data-live={live ? "" : undefined}
					className="[&>[data-slot=input-group]]:bg-transparent"
					onSubmit={() => void submit(false)}
					onDragOver={(e) => e.preventDefault()}
					onDrop={(e) => {
						if (!e.dataTransfer.files.length) return;
						e.preventDefault();
						add(Array.from(e.dataTransfer.files));
					}}
				>
					<PromptInputBody>
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
					<PromptInputFooter className="-ml-1.5">
						{/* One row on a phone: chips keep full labels and scroll sideways, Send stays put (#1020). */}
						<PromptInputTools
							className="min-w-0 flex-1 gap-0.5 max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&>*]:shrink-0 sm:flex-wrap sm:gap-y-1"
							data-testid="composer-chips"
							data-scroll-x
						>
							{!noFiles && (
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
							)}
							<input
								ref={picker}
								type="file"
								multiple
								hidden
								accept={
									agent.images === true
										? `image/png,image/jpeg,image/webp,image/gif,${TEXT_TYPES}`
										: TEXT_TYPES
								}
								onChange={(e) => {
									if (e.target.files) add(Array.from(e.target.files));
									e.target.value = "";
								}}
								data-testid="composer-file-input"
							/>
							{!agentless && (
								<ModelChip
									harness={harness}
									model={choice.model}
									disabled={locked || blocked}
									onPick={(h, m) =>
										onChoice({ harnessId: h.id as HarnessId, model: m })
									}
								/>
							)}
							{!agentless && hasEffort && (
								<EffortChip
									harness={harness}
									model={choice.model}
									effort={choice.effort}
									disabled={locked || blocked}
									onEffort={(effort) => onChoice({ effort })}
									onModel={(model) => onChoice({ model })}
								/>
							)}
							{!agentless && (
								<AccessChip
									harness={harness}
									level={choice.accessLevel}
									onLevel={(accessLevel) => onChoice({ accessLevel })}
									lockedHint={
										accessHint ??
										(locked ? "Kept from the first message" : undefined)
									}
									disabled={blocked}
								/>
							)}
						</PromptInputTools>
						<div className="ml-auto flex shrink-0 items-center gap-0.5">
							{action}
						</div>
					</PromptInputFooter>
				</PromptInput>
			</div>
			{(blocked || refusal || notice) && (
				<p
					className={cn(
						"px-3 text-meta",
						refusal ? "text-danger" : "text-text-2",
					)}
					data-testid={refusal ? "composer-refusal" : "composer-blocked"}
				>
					{refusal ?? (blocked ? blockedReason : notice)}
				</p>
			)}
			{footer}
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
