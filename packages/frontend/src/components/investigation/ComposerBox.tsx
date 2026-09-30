// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ArrowUp } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	AgentModelChip,
	AgentModelPicker,
} from "@/components/agent/AgentPicker";
import { Button } from "@/components/ui/button";
import { type ComposerMode, composerKeyAction } from "@/lib/composer-keys";
import { cn } from "@/lib/utils";

export interface ComposerBoxProps {
	mode: ComposerMode;
	/** Brief and new-run modes: start a run with the text as its brief. */
	onInvestigate: (brief: string) => void;
	/** Live mode: Enter queues for the agent's next pause, Ctrl+Enter sends now. */
	onMessage?: (text: string, mode: "queue" | "now") => void;
	/** Who a message goes to, for the placeholder: `the main agent`, `branch b1`. */
	target?: string;
	/** The agent and model a live run is fixed on. */
	fixed?: { agent: string; model: string };
	/** Messages queued and not yet delivered. */
	waiting?: number;
	isPending?: boolean;
	/** Why a run cannot start right now; the button is withheld with it. */
	blockedReason?: string;
	/** The 409 path: the run ended before the message reached it. */
	undeliverable?: string | null;
	onSaveAsNote?: (text: string) => void;
	/** The picker opens upward from a docked box. */
	docked?: boolean;
	className?: string;
}

function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px] text-foreground">
			{children}
		</kbd>
	);
}

const MAX_HEIGHT_PX = 160;

/**
 * The box (#743 §4, §6): one multi-line field with its controls inside. Who
 * reads the text decides the mode: a brief goes to a new run's agent, so the
 * agent and model can be picked; a message goes to the live session, whose
 * agent is fixed; after the run ends the text briefs the next run.
 */
export function ComposerBox({
	mode,
	onInvestigate,
	onMessage,
	target = "the main agent",
	fixed,
	waiting = 0,
	isPending,
	blockedReason,
	undeliverable,
	onSaveAsNote,
	docked,
	className,
}: ComposerBoxProps) {
	const [text, setText] = useState("");
	const [focused, setFocused] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const blocked = mode !== "live" && !!blockedReason;

	// The field grows with wrapped text up to a cap, then scrolls inside.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on every edit.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
	}, [text]);

	const submit = (send: "investigate" | "queue" | "now") => {
		const value = text.trim();
		if (send === "investigate") {
			if (blocked || isPending) return;
			onInvestigate(value);
			setText("");
			return;
		}
		if (!value || !onMessage) return;
		onMessage(value, send);
		setText("");
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
		);
		if (!action) return;
		e.preventDefault();
		submit(action);
	};

	const placeholder =
		mode === "brief"
			? "Add context for the agent (optional)"
			: mode === "again"
				? "Context for a new run (optional)"
				: `Message ${target}`;

	return (
		<div
			className={cn("space-y-1", className)}
			data-testid="composer-box"
			// The hint stays while focus moves to the box's own buttons, so the
			// layout does not shift under a click on Investigate or Send.
			onFocus={() => setFocused(true)}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
					setFocused(false);
				}
			}}
		>
			<div
				className={cn(
					"flex flex-col gap-1 rounded-md border bg-background p-1",
					"focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
				)}
				data-mode={mode}
			>
				<textarea
					ref={ref}
					rows={1}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					aria-label={mode === "live" ? `Message ${target}` : "Brief"}
					data-testid="composer-input"
					className="min-h-7 w-full resize-none bg-transparent px-2 py-1 text-record outline-none placeholder:text-muted-foreground"
				/>
				<div className="flex min-w-0 items-center gap-1">
					{mode === "live" ? (
						fixed && <AgentModelChip agent={fixed.agent} model={fixed.model} />
					) : (
						<AgentModelPicker
							side={docked ? "top" : "bottom"}
							className="shrink"
						/>
					)}
					<span className="ml-auto flex shrink-0 items-center gap-2">
						{mode === "live" && waiting > 0 && (
							<span
								className="text-meta text-stale tabular-nums"
								data-testid="composer-waiting"
							>
								{waiting} waiting
							</span>
						)}
						{mode === "live" ? (
							<Button
								size="icon-sm"
								variant={text.trim() ? "default" : "secondary"}
								aria-label="Send"
								title="Queue for the agent's next pause"
								disabled={!text.trim()}
								onClick={() => submit("queue")}
								data-testid="composer-send"
							>
								<ArrowUp />
							</Button>
						) : (
							<Button
								size="sm"
								onClick={() => submit("investigate")}
								disabled={blocked || isPending}
								title={blocked ? blockedReason : undefined}
								data-testid="composer-investigate"
							>
								{isPending
									? "Starting"
									: mode === "again"
										? "Investigate again"
										: "Investigate"}
							</Button>
						)}
					</span>
				</div>
			</div>
			{blocked ? (
				<p className="px-2 text-meta text-muted-foreground">{blockedReason}</p>
			) : (
				// Always laid out, shown on focus: a line that appeared under a
				// click would move the button away from the pointer.
				<div
					className={cn(
						"flex flex-wrap gap-x-4 gap-y-0.5 px-2 text-meta text-muted-foreground",
						!focused && "invisible",
					)}
					aria-hidden={!focused}
					data-testid="composer-hint"
				>
					{mode === "live" ? (
						<>
							<span className="flex items-center gap-1">
								<Kbd>Enter</Kbd> queue until the agent pauses
							</span>
							<span className="flex items-center gap-1">
								<Kbd>Ctrl Enter</Kbd> send now, stops its current step
							</span>
						</>
					) : (
						<>
							<span className="flex items-center gap-1">
								<Kbd>Enter</Kbd> start the run with this as the brief
							</span>
							<span className="flex items-center gap-1">
								<Kbd>Shift Enter</Kbd> new line
							</span>
							{mode === "again" && (
								<span>
									This run has ended and cannot be asked anything more.
								</span>
							)}
						</>
					)}
				</div>
			)}
			{undeliverable && (
				<div
					className="flex flex-wrap items-center gap-2 px-2 text-meta text-run-failed"
					data-testid="composer-undeliverable"
				>
					The run ended before your message reached it.
					{onSaveAsNote && (
						<Button
							variant="outline"
							size="xs"
							className="text-foreground"
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
