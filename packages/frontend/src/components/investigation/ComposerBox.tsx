// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { PermissionMode } from "@prismalens/config/harness";
import { ACCESS_LABEL } from "@prismalens/contracts";
import { ArrowUp, FileText, Lock, Paperclip, X } from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	type KeyboardEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	AccessMenu,
	AgentModelChip,
	AgentModelPicker,
	EffortMenu,
} from "@/components/agent/AgentPicker";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { attachRefusal } from "@/lib/attachments";
import {
	type ComposerMode,
	composerKeyAction,
	talksToSession,
} from "@/lib/composer-keys";
import { cn } from "@/lib/utils";

/** A file in the box, before and while it uploads. */
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
	/** Brief and new-run modes: start a run with the text as its brief. */
	onInvestigate: (
		send: ComposerSend & { access: PermissionMode },
	) => Promise<void> | void;
	/** Talking modes: Enter queues for the agent's next pause, Send now interrupts. */
	onMessage?: (
		send: ComposerSend,
		mode: "queue" | "now",
	) => Promise<void> | void;
	/** Live mode: end the run (R4.4); Esc in the box does the same. */
	onStop?: () => void;
	stopping?: boolean;
	/** Who a message goes to, for the placeholder: `the main agent`, `branch b1`. */
	target?: string;
	/** The agent and model a run is fixed on; `id` names its mark. */
	fixed?: { agent: string; model: string; id?: string | null };
	/** The access level the run was given; the brief modes choose one. */
	runAccess?: PermissionMode;
	/** The agent the text goes to, and whether its check recorded image support (R4.3). */
	agent: { label: string; images: boolean | null };
	/** Messages queued and not yet delivered. */
	waiting?: number;
	isPending?: boolean;
	/** Why a run cannot start right now; the button is withheld with it. */
	blockedReason?: string;
	/** One line above the field: what continuing does, or why nothing can be continued. */
	note?: string | null;
	/** The 409 path: the run ended before the message reached it. */
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	/** The menus open upward from a docked box. */
	docked?: boolean;
	className?: string;
}

const MAX_HEIGHT_PX = 160;

const release = (drafts: Draft[]) => {
	for (const d of drafts) if (d.preview) URL.revokeObjectURL(d.preview);
};

const PLACEHOLDER: Record<ComposerMode, string> = {
	brief: "Brief the agent (optional)",
	live: "Message the agent",
	continue: "Continue the investigation",
	resume: "Ask a follow-up",
	again: "Brief a new investigation",
};

/**
 * The box (study-v3 §3.4, R4.4): one field with its controls inside. A brief
 * starts a run with the agent, model, effort and access chosen here; a
 * message goes to the run's own session, Enter at its next pause and Send now
 * at once; Stop and Esc end the run; after it ends the text continues a
 * stopped run, follows up a finished one, or briefs a new one.
 */
export function ComposerBox({
	mode,
	onInvestigate,
	onMessage,
	onStop,
	stopping,
	target = "the main agent",
	fixed,
	runAccess,
	agent,
	waiting = 0,
	isPending,
	blockedReason,
	note,
	undeliverable,
	onSaveAsNote,
	docked,
	className,
}: ComposerBoxProps) {
	const [text, setText] = useState("");
	const [drafts, setDrafts] = useState<Draft[]>([]);
	const [refusal, setRefusal] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [access, setAccess] = useState<PermissionMode>("read-only");
	const ref = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const shell = useRef<HTMLDivElement>(null);
	const talking = talksToSession(mode);
	const live = mode === "live";
	const blocked = !talking && !!blockedReason;
	const hasText = !!text.trim();
	const busy = sending || !!isPending;

	// The field grows with wrapped text up to a cap, then scrolls inside.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every edit.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
	}, [text]);

	// A preview lives as long as its draft: revoked on remove, on send and on unmount.
	const shown = useRef(drafts);
	shown.current = drafts;
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
			next.push({
				key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
				file,
				...(file.type.startsWith("image/")
					? { preview: URL.createObjectURL(file) }
					: {}),
			});
		}
		setRefusal(why);
		if (next.length) setDrafts((d) => [...d, ...next]);
	};

	const reset = () => {
		setText("");
		release(drafts);
		setDrafts([]);
		setRefusal(null);
	};

	const submit = async (send: "investigate" | "queue" | "now") => {
		const value = text.trim();
		const files = drafts.map((d) => d.file);
		if (busy) return;
		if (send === "investigate") {
			if (blocked) return;
		} else if (!value || !onMessage) return;
		setSending(true);
		try {
			if (send === "investigate")
				await onInvestigate({ text: value, files, access });
			else await onMessage?.({ text: value, files }, send);
			reset();
		} catch (e) {
			setRefusal(e instanceof Error ? e.message : String(e));
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
		// Esc is the box's: the record's own Esc (the chevron) never sees it.
		e.stopPropagation();
		if (action === "stop") onStop?.();
		else if (action === "blur") ref.current?.blur();
		else void submit(action);
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.clipboardData.files);
		if (!files.length) return;
		e.preventDefault();
		add(files);
	};
	const onDrop = (e: DragEvent<HTMLDivElement>) => {
		if (!e.dataTransfer.files.length) return;
		e.preventDefault();
		add(Array.from(e.dataTransfer.files));
	};

	const clipHint =
		agent.images === true
			? "Attach a screenshot or a log"
			: agent.images === false
				? `${agent.label} can't take images. Text files only.`
				: "Images: not checked yet. Text files only.";

	return (
		<div className={cn("space-y-1.5", className)} data-testid="composer-box">
			<div
				ref={shell}
				className="raised rounded-pool px-3 pt-2.5 pb-2"
				data-mode={mode}
				onDragOver={(e) => e.preventDefault()}
				onDrop={onDrop}
			>
				{note && (
					<p
						className="mb-1.5 text-meta text-text-3 [overflow-wrap:anywhere]"
						data-testid="composer-note"
					>
						{note}
					</p>
				)}
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
				<textarea
					ref={ref}
					rows={1}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					onPaste={onPaste}
					placeholder={
						live && target !== "the main agent"
							? `Message ${target}`
							: PLACEHOLDER[mode]
					}
					aria-label={PLACEHOLDER[mode]}
					data-testid="composer-input"
					className="block min-h-6 w-full resize-none bg-transparent text-body text-text-1 outline-none placeholder:text-text-3"
				/>
				<div className="mt-2 flex min-w-0 items-center gap-1.5">
					{talking ? (
						fixed && (
							<AgentModelChip
								agent={fixed.agent}
								harness={fixed.id}
								model={fixed.model}
								className="shrink max-sm:max-w-[50%]"
							/>
						)
					) : (
						<AgentModelPicker
							side={docked ? "top" : "bottom"}
							anchor={docked ? shell : undefined}
							className="shrink max-sm:max-w-[50%]"
						/>
					)}
					{talking ? (
						<span
							className="inline-flex h-6 shrink-0 items-center px-1.5 text-meta font-medium text-text-2"
							data-testid="access-chip"
						>
							<Lock className="size-3.5 sm:hidden" aria-hidden />
							<span className="max-sm:sr-only">
								{ACCESS_LABEL[runAccess ?? "read-only"]}
							</span>
						</span>
					) : (
						<>
							<AccessMenu
								value={access}
								onChange={setAccess}
								side={docked ? "top" : "bottom"}
							/>
							<span className="hidden sm:contents">
								<EffortMenu side={docked ? "top" : "bottom"} />
							</span>
						</>
					)}
					<Hint label={clipHint} side="top">
						<button
							type="button"
							aria-label="Attach a file"
							onClick={() => picker.current?.click()}
							className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-3 transition-colors duration-(--dur-instant) hover:bg-surface-3 hover:text-text-1"
							data-testid="composer-attach"
						>
							<Paperclip className="size-3.5" />
						</button>
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
					<span className="ml-auto flex shrink-0 items-center gap-1">
						{live && waiting > 0 && (
							<span
								className="px-1 text-meta text-warn tabular-nums"
								data-testid="composer-waiting"
							>
								{waiting} waiting
							</span>
						)}
						{live && hasText && (
							<Hint
								label="Ends the agent's current step"
								keys={["Ctrl", "Enter"]}
								side="top"
							>
								<Button
									variant="text"
									disabled={busy}
									onClick={() => void submit("now")}
									data-testid="composer-send-now"
								>
									Send now
								</Button>
							</Hint>
						)}
						{live && (
							<Hint label="Stop the agent" keys={["Esc"]} side="top">
								<Button
									variant="danger"
									disabled={stopping}
									onClick={() => onStop?.()}
									data-testid="composer-stop"
								>
									{stopping ? "Stopping" : "Stop"}
								</Button>
							</Hint>
						)}
						{talking ? (
							<Hint
								label={
									live ? "Send, at the agent's next pause" : PLACEHOLDER[mode]
								}
								keys={["Enter"]}
								side="top"
							>
								<Button
									size="icon"
									variant={hasText ? "primary" : "secondary"}
									className="rounded-full active:scale-[0.94]"
									aria-label="Send"
									disabled={!hasText || busy}
									onClick={() => void submit("queue")}
									data-testid="composer-send"
								>
									<ArrowUp />
								</Button>
							</Hint>
						) : (
							<Button
								variant="secondary"
								onClick={() => void submit("investigate")}
								disabled={blocked || busy}
								data-testid="composer-investigate"
							>
								{busy
									? "Starting"
									: mode === "again"
										? "Investigate again"
										: "Start investigation"}
							</Button>
						)}
					</span>
				</div>
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
			{undeliverable && (
				<div
					className="flex flex-wrap items-center gap-2 px-3 text-meta text-danger"
					data-testid="composer-undeliverable"
				>
					The investigation ended before your message reached it.
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
