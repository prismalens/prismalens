// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	countdown,
	limitLine,
	limitState,
	type ThreadLimit,
} from "./session-words";

/** Seconds tick only while something counts down; reduced motion still shows the final text. */
function useNow(active: boolean, initial: number): number {
	const [now, setNow] = useState(initial);
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [active]);
	return now;
}

/**
 * A thread stopped on its agent's usage limit. Every word comes from the
 * limit's fields; there is no "Resume now", since no route lifts a limit early.
 */
export function LimitDock({
	limit,
	draft,
	onDontResume,
	onSendAtReset,
	onResumeAtReset,
	onRemoveQueued,
	onSend,
	pending = false,
	now: fixedNow,
	clock,
}: {
	limit: ThreadLimit;
	/** The composer's draft; "Send this draft when it resets" takes it. */
	draft?: string;
	onDontResume: () => void;
	onSendAtReset: (message: string) => void;
	/** Turns auto-resume back on with no message; offered while it is off. */
	onResumeAtReset?: () => void;
	/** Drops the queued draft and leaves auto-resume as it is. */
	onRemoveQueued?: () => void;
	onSend?: () => void;
	pending?: boolean;
	/** A fixed clock, for tests and the gallery. */
	now?: number;
	clock?: (at: string) => string;
}) {
	const state = limitState(limit);
	const target =
		state === "resuming" ? (limit.nextAttemptAt ?? limit.resetsAt) : null;
	const now = useNow(
		!!target && fixedNow === undefined,
		fixedNow ?? Date.now(),
	);
	const left = target ? countdown(target, now) : null;
	const message = draft?.trim() ?? "";
	return (
		<section
			aria-label="Usage limit"
			className="grid gap-2 rounded-surface bg-surface-2 px-3 py-2.5"
			data-testid="limit-dock"
			data-state={state}
		>
			<p className="flex flex-wrap items-baseline gap-x-2 text-body text-text-1">
				<span data-testid="limit-dock-line">{limitLine(limit, clock)}</span>
				{left && (
					<span
						className="text-meta text-text-3 tabular-nums"
						data-testid="limit-dock-countdown"
					>
						{left}
					</span>
				)}
			</p>
			{limit.message && (
				<p className="flex items-baseline gap-2 text-meta text-text-3">
					<span className="truncate" data-testid="limit-dock-queued">
						Sends at the reset: {limit.message}
					</span>
					{onRemoveQueued && (
						<Button
							size="sm"
							variant="text"
							disabled={pending}
							onClick={onRemoveQueued}
							data-testid="limit-dock-remove-queued"
						>
							Remove
						</Button>
					)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{state === "gaveUp" ? (
					onSend && (
						<Button
							size="sm"
							disabled={pending}
							onClick={onSend}
							data-testid="limit-dock-send"
						>
							Send
						</Button>
					)
				) : (
					<>
						{message && (
							<Button
								size="sm"
								variant="secondary"
								disabled={pending}
								onClick={() => onSendAtReset(message)}
								data-testid="limit-dock-send-at-reset"
							>
								Send this draft when it resets
							</Button>
						)}
						{!limit.autoResume && onResumeAtReset && (
							<Button
								size="sm"
								variant="secondary"
								disabled={pending}
								onClick={onResumeAtReset}
								data-testid="limit-dock-resume-at-reset"
							>
								Resume at reset
							</Button>
						)}
						{limit.autoResume && (
							<Button
								size="sm"
								variant="text"
								disabled={pending}
								onClick={onDontResume}
								data-testid="limit-dock-dont-resume"
							>
								Don't resume
							</Button>
						)}
					</>
				)}
			</div>
		</section>
	);
}

/** The `auto-resume` bodies the dock's controls send. */
export const autoResumeBody = {
	dontResume: () => ({ on: false }) as const,
	sendAtReset: (message: string) => ({ on: true, message }) as const,
	resumeAtReset: () => ({ on: true }) as const,
	removeQueued: (on: boolean) => ({ on, message: null }) as const,
};
