// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Strip, StripAction } from "@/components/kit";
import { useNow } from "@/hooks/use-now";
import {
	reconnectAsOf,
	reconnectNow,
	useStreamStatus,
} from "@/lib/api/live-refresh";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock } from "@/lib/format-time";

/**
 * A run PrismaLens's own stop cut off (#981, #1101 category 23), as the stop strip:
 * Interrupted, why it was not resumed when it was not, and Resume.
 */
export function InterruptedDock({
	notResumed,
	onResume,
	pending = false,
	error,
}: {
	/** Why the start did not resume it by itself. */
	notResumed?: string | null;
	onResume: () => void;
	pending?: boolean;
	error?: string | null;
}) {
	return (
		<div className="contents" data-testid="interrupted-dock">
			<Strip
				status="waiting"
				head="Interrupted by restart"
				label="Interrupted by restart"
				title={
					notResumed
						? `Not resumed: ${notResumed}`
						: "PrismaLens stopped while this run worked. Resume picks up where it stopped."
				}
				detail={
					error ? (
						<span className="text-danger" role="alert">
							{error}
						</span>
					) : notResumed ? (
						<span data-testid="interrupted-dock-next">Not resumed</span>
					) : null
				}
				actions={
					<StripAction
						disabled={pending}
						onClick={onResume}
						testId="interrupted-dock-resume"
					>
						Resume
					</StripAction>
				}
			/>
		</div>
	);
}

/**
 * The change stream is down (#1101 category 23): the quiet strip, never a modal.
 * The composer keeps its draft; Retry now tries the stream at once.
 */
export function ConnectionDock({ fixedAsOf }: { fixedAsOf?: number } = {}) {
	const status = useStreamStatus();
	const now = useNow(1_000);
	const asOf = fixedAsOf ?? (now === null ? null : reconnectAsOf(status, now));
	if (asOf === null) return null;
	return (
		<div className="contents" data-testid="connection-dock">
			<Strip
				status="waiting"
				head="Reconnecting"
				label="Connection lost"
				live
				title="Your draft is kept."
				detail={`As of ${formatClock(asOf)}`}
				actions={
					<StripAction onClick={reconnectNow} testId="connection-dock-retry">
						Retry now
					</StripAction>
				}
			/>
		</div>
	);
}

/**
 * A failed turn (#1101 sheet §10): the failure mark and its cause on one line,
 * and Retry. The transcript and the box say nothing more about it.
 */
export function FailedDock({
	cause,
	onRetry,
	retryHint,
	pending = false,
}: {
	/** One line; the agent's own words are left out when its last message says them. */
	cause?: string | null;
	onRetry?: () => void;
	retryHint?: string;
	pending?: boolean;
}) {
	return (
		<div className="contents">
			<Strip
				testId="failed-dock"
				status="failed"
				head="Failed"
				label="Turn failed"
				title={cause ?? undefined}
				detail={
					cause ? (
						<span className="line-clamp-1 [overflow-wrap:anywhere]">
							{cause}
						</span>
					) : null
				}
				actions={
					onRetry && (
						<StripAction
							disabled={pending}
							onClick={onRetry}
							title={retryHint}
							testId="failed-dock-retry"
						>
							Retry
						</StripAction>
					)
				}
			/>
		</div>
	);
}

/** The failed dock's one line: null when the agent's last message already says it. */
export function failedCause(
	agent: string,
	error: string | null | undefined,
	hint: string | undefined,
	lastMessage: string | null,
): string | null {
	const s = failureSentence(agent, error, hint);
	if (!s.words) return s.detail && s.next ? `${s.said} ${s.next}` : s.said;
	const said = s.words.replace(/…$/, "");
	return lastMessage?.includes(said) ? null : s.words;
}
