// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Strip, StripAction } from "@/components/kit";
import { useNow } from "@/hooks/use-now";
import {
	reconnectAsOf,
	reconnectNow,
	useStreamStatus,
} from "@/lib/api/live-refresh";
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
