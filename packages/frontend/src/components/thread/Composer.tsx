// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AccessLevel, HarnessId } from "@prismalens/config/harness";
import type { HarnessStatus } from "@prismalens/contracts";
import { FileText, GitBranch, Paperclip, Play, Square, X } from "lucide-react";
import {
	type ClipboardEvent,
	type KeyboardEvent,
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
import { attachRefusal } from "@/lib/attachments";
import { composerKeyAction } from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

export interface ComposerSend {
	text: string;
	files: File[];
}

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
	run: () => void;
}

export interface ComposerProps {
	state: ComposerState;
	onSend: (send: ComposerSend, now: boolean) => Promise<void> | void;
	onStop?: () => void;
	stopping?: boolean;
	onResume?: () => void;
	resuming?: boolean;
	placeholder: string;
	choice: ComposerChoice;
	onChoice: (next: Partial<ComposerChoice> & { harnessId?: HarnessId }) => void;
	/** A follow-up keeps the run's agent and level: the chips show them, read-only. */
	locked?: boolean;
	/** The branch the run works on, or the one a new thread starts from. */
	branch: string | null;
	/** The agent's asks, docked on the box. */
	dock?: ReactNode;
	/** Why nothing can be sent now. */
	blockedReason?: string | null;
	autoFocus?: boolean;
	/** A row above the box: a new thread's subject and Incident toggle. */
	top?: ReactNode;
	/** What `/` offers; the text typed after it narrows the list. */
	slash?: SlashCommand[];
}

interface Draft {
	key: string;
	file: File;
}

/**
 * The one composer (#1020): text, then attach; agent, model and effort; Send, Stop
 * or Resume. Branch and access sit under the box.
 */
export function Composer({
	state,
	onSend,
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
}: ComposerProps) {
	const [text, setText] = useState("");
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const live = state === "live";
	const blocked = !!blockedReason;
	const hasText = !!text.trim();
	const canSend = !sending && !blocked && hasText;
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
			next.push({ key: `${file.name}-${crypto.randomUUID()}`, file });
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
			setDrafts([]);
			setRefusal(null);
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
			live ? "live" : "resume",
			live && !stopping,
		);
		if (!key) return;
		e.preventDefault();
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

	const action =
		live && !hasText ? (
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
			<Hint label="Send" keys={["Enter"]} side="top">
				<span className="inline-flex">
					<PromptInputSubmit
						status={sending ? "submitted" : undefined}
						disabled={!canSend}
						aria-label="Send"
						data-testid="composer-send"
					/>
				</span>
			</Hint>
		);

	const hasEffort = effortLevels(harness).length > 0;
	return (
		<div className="flex flex-col gap-1" data-testid="thread-composer">
			{top}
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
								<span>{c.label}</span>
							</button>
						</li>
					))}
				</ul>
			)}
			<div className="overflow-hidden rounded-[10px] bg-surface-2">
				{(dock || drafts.length > 0) && (
					<div className="flex flex-col gap-2.5 bg-surface-3 px-3 pt-2.5 pb-2">
						{dock}
						{drafts.length > 0 && (
							<ul className="flex flex-wrap gap-1.5">
								{drafts.map((d) => (
									<li
										key={d.key}
										className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-control bg-surface-4 pr-1 pl-2 text-meta text-text-1"
										data-testid="composer-file"
									>
										<FileText className="size-3.5 shrink-0 text-text-3" />
										<span className="truncate">{d.file.name}</span>
										<button
											type="button"
											aria-label={`Remove ${d.file.name}`}
											onClick={() =>
												setDrafts((all) => all.filter((x) => x !== d))
											}
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
					<PromptInputFooter className="-ml-1.5 max-sm:flex-wrap">
						<PromptInputTools className="min-w-0 flex-1 flex-wrap gap-0.5 gap-y-1">
							<Hint label="Attach a file" side="top">
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
								onChange={(e) => {
									if (e.target.files) add(Array.from(e.target.files));
									e.target.value = "";
								}}
								data-testid="composer-file-input"
							/>
							<ModelChip
								harness={harness}
								model={choice.model}
								disabled={locked || blocked}
								onPick={(h, m) =>
									onChoice({ harnessId: h.id as HarnessId, model: m })
								}
							/>
							{hasEffort && (
								<EffortChip
									harness={harness}
									model={choice.model}
									effort={choice.effort}
									disabled={locked || blocked}
									onEffort={(effort) => onChoice({ effort })}
									onModel={(model) => onChoice({ model })}
								/>
							)}
						</PromptInputTools>
						<div className="ml-auto flex shrink-0 items-center">{action}</div>
					</PromptInputFooter>
				</PromptInput>
			</div>
			<div
				className="flex flex-wrap items-center gap-3 px-1.5 text-meta text-text-3"
				data-testid="composer-under"
			>
				{branch && (
					<span
						className="inline-flex min-w-0 items-center gap-1"
						data-testid="composer-branch"
					>
						<GitBranch className="size-3.5 shrink-0" aria-hidden />
						<span className="truncate">{branch}</span>
					</span>
				)}
				<AccessChip
					harness={harness}
					level={choice.accessLevel}
					onLevel={(accessLevel) => onChoice({ accessLevel })}
					lockedHint={locked ? "Kept from the first message" : undefined}
					disabled={blocked}
				/>
			</div>
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
		</div>
	);
}
