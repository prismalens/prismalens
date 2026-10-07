// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { FileText, Paperclip, Plus, Square, X } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
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
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { attachRefusal } from "@/lib/attachments";
import {
	type ComposerMode,
	composerKeyAction,
	talksToSession,
} from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";

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
	mode: ComposerMode;
	/** The three chips: agent and model, effort and window, permission mode. */
	chips: ReactNode;
	/** Draft: gathers, then starts the agent. */
	onInvestigate: (send: ComposerSend) => Promise<void> | void;
	/** Draft: asks without gathering. */
	onAsk: (send: ComposerSend) => Promise<void> | void;
	/** Enter in a draft investigates (the incident has alerts) rather than asks. */
	enterInvestigates: boolean;
	/** Live or resumable: Enter queues for the next pause, Send now interrupts. */
	onMessage?: (
		send: ComposerSend,
		mode: "queue" | "now",
	) => Promise<void> | void;
	onStop?: () => void;
	stopping?: boolean;
	/** No session to continue: the one way on. */
	onNewRun?: () => void;
	/** The draft's text, kept by the page across tabs. */
	text: string;
	setText: (text: string) => void;
	agent: { label: string; images: boolean | null };
	waiting?: number;
	isPending?: boolean;
	/** Why a draft cannot start: chips and actions are withheld with it. */
	blockedReason?: string;
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	autoFocus?: boolean;
	/** The status line under the box. */
	status?: ReactNode;
}

const release = (drafts: Draft[]) => {
	for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
};

const PLACEHOLDER: Record<ComposerMode, string> = {
	draft: "Brief the agent, or just ask",
	live: "Message the agent",
	continue: "Continue this run",
	resume: "Continue this run",
	ended: "",
};

/** The box (#673): the same three chips in every state but a run with no session. */
export function ComposerBox({
	mode,
	chips,
	onInvestigate,
	onAsk,
	enterInvestigates,
	onMessage,
	onStop,
	stopping,
	onNewRun,
	text,
	setText,
	agent,
	waiting = 0,
	isPending,
	blockedReason,
	undeliverable,
	onSaveAsNote,
	autoFocus,
	status,
}: ComposerBoxProps) {
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const talking = talksToSession(mode);
	const live = mode === "live";
	const blocked = mode === "draft" && !!blockedReason;
	const hasText = !!text.trim();
	const busy = sending || !!isPending;

	const shown = useRef(drafts);
	shown.current = drafts;
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
			next.push({
				key: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
				file,
				...(file.type.startsWith("image/")
					? { preview: URL.createObjectURL(file) }
					: {}),
			});
		}
		setRefusal(why);
		if (next.length) setDrafts((d) => [...d, ...next]);
	};

	const submit = async (send: "investigate" | "ask" | "queue" | "now") => {
		const value = text.trim();
		const files = drafts.map((d) => d.file);
		if (busy) return;
		if (send === "investigate" && blocked) return;
		if (send === "ask" && (blocked || !value)) return;
		if ((send === "queue" || send === "now") && (!value || !onMessage)) return;
		setSending(true);
		try {
			if (send === "investigate") await onInvestigate({ text: value, files });
			else if (send === "ask") await onAsk({ text: value, files });
			else await onMessage?.({ text: value, files }, send);
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
		const action = composerKeyAction(
			{
				key: e.key,
				shiftKey: e.shiftKey,
				ctrlKey: e.ctrlKey,
				metaKey: e.metaKey,
				altKey: e.altKey,
				isComposing: e.nativeEvent.isComposing,
			},
			mode,
			live && !stopping,
		);
		if (!action) return;
		e.preventDefault();
		e.stopPropagation();
		if (action === "stop") onStop?.();
		else if (action === "blur") ref.current?.blur();
		else if (action === "investigate")
			void submit(enterInvestigates ? "investigate" : "ask");
		else void submit(action);
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

	if (mode === "ended")
		return (
			<div className="space-y-1.5" data-testid="composer-box">
				<div
					className="flex items-center gap-3 rounded-pool bg-surface-1 px-3 py-2.5 text-body text-text-2"
					data-testid="composer-no-session"
				>
					<span className="min-w-0 flex-1">
						This run can't continue. Start a new run.
					</span>
					<Button
						variant="secondary"
						onClick={onNewRun}
						data-testid="composer-new-run"
					>
						<Plus />
						New run
					</Button>
				</div>
				{status}
			</div>
		);

	const clipHint =
		agent.images === true
			? "Attach a screenshot or a log"
			: agent.images === false
				? `${agent.label} can't take images. Text files only.`
				: "Images: not checked yet. Text files only.";

	return (
		<div className="space-y-1.5" data-testid="composer-box">
			<PromptInput
				data-mode={mode}
				onSubmit={() =>
					void submit(
						talking ? "queue" : enterInvestigates ? "investigate" : "ask",
					)
				}
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
						placeholder={PLACEHOLDER[mode]}
						aria-label={PLACEHOLDER[mode]}
						data-testid="composer-input"
					/>
				</PromptInputBody>
				<PromptInputFooter className="max-sm:flex-wrap">
					<div className="relative flex min-w-0 flex-1 max-sm:basis-full max-sm:after:pointer-events-none max-sm:after:absolute max-sm:after:inset-y-0 max-sm:after:right-0 max-sm:after:w-4 max-sm:after:bg-[linear-gradient(90deg,transparent,var(--surface-1))]">
						<PromptInputTools
							className="max-sm:overflow-x-auto max-sm:[scrollbar-width:none]"
							data-testid="composer-chips"
						>
							{chips}
						</PromptInputTools>
					</div>
					<div className="ml-auto flex shrink-0 items-center gap-1">
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
						{mode === "draft" && (
							<>
								<Hint
									label="Gathers the alert, code and telemetry, then starts the agent"
									keys={enterInvestigates ? ["Enter"] : undefined}
									side="top"
								>
									<span className="inline-flex">
										<Button
											variant="primary"
											className="h-8 px-3 disabled:pointer-events-auto disabled:bg-surface-3 disabled:text-text-2 disabled:opacity-100"
											disabled={blocked || busy}
											onClick={() => void submit("investigate")}
											data-testid="composer-investigate"
										>
											{busy ? "Starting" : "Investigate"}
										</Button>
									</span>
								</Hint>
								<Hint
									label="Ask without gathering"
									keys={enterInvestigates ? undefined : ["Enter"]}
									side="top"
								>
									<span className="inline-flex">
										<PromptInputSubmit
											variant="secondary"
											type="button"
											disabled={blocked || busy || !hasText}
											onClick={() => void submit("ask")}
											data-testid="composer-ask"
										/>
									</span>
								</Hint>
							</>
						)}
						{live && (
							<Hint
								label="Interrupt and send"
								keys={["Ctrl", "Enter"]}
								side="top"
							>
								<span className="inline-flex">
									<PromptInputButton
										disabled={busy || !hasText}
										onClick={() => void submit("now")}
										data-testid="composer-send-now"
									>
										Send now
									</PromptInputButton>
								</span>
							</Hint>
						)}
						{talking && (
							<Hint
								label={
									live ? "Send when the agent pauses" : "Continue this run"
								}
								keys={["Enter"]}
								side="top"
							>
								<span className="inline-flex">
									<PromptInputSubmit
										disabled={!hasText || busy}
										data-testid="composer-send"
									/>
								</span>
							</Hint>
						)}
						{live && (
							<Hint label="Stop the agent" keys={["Esc"]} side="top">
								<span className="inline-flex">
									<PromptInputButton
										disabled={stopping}
										onClick={() => onStop?.()}
										className="gap-1.5 hover:text-danger"
										data-testid="composer-stop"
									>
										<Square className="size-3.5 fill-current" />
										{stopping ? "Stopping" : "Stop"}
									</PromptInputButton>
								</span>
							</Hint>
						)}
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
			{status}
		</div>
	);
}
