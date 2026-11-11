// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import {
	reconnectAsOf,
	reconnectNow,
	useStreamStatus,
} from "@/lib/api/live-refresh";
import { formatClock } from "@/lib/format-time";

/**
 * A run PrismaLens's own stop cut off (#981, #1101 category 23): the cause, why it
 * was not resumed when it was not, and Resume.
 */
export function InterruptedDock({
	notResumed,
	onResume,
	pending = false,
	error,
}: {
	/** Why the start did not resume it by itself, after "Not resumed: ". */
	notResumed?: string | null;
	onResume: () => void;
	pending?: boolean;
	error?: string | null;
}) {
	return (
		<section
			aria-label="Interrupted by restart"
			className="grid gap-2 rounded-surface bg-surface-2 px-3 py-2.5"
			data-testid="interrupted-dock"
		>
			<p className="flex items-baseline gap-2 text-body text-text-1">
				<span
					aria-hidden
					className="h-3 w-[3px] shrink-0 self-center rounded-full bg-warn"
				/>
				Interrupted by restart
			</p>
			<p className="text-meta text-text-2" data-testid="interrupted-dock-next">
				{notResumed
					? `Not resumed: ${notResumed}`
					: "PrismaLens stopped while this run worked. Resume picks up where it stopped."}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					disabled={pending}
					onClick={onResume}
					data-testid="interrupted-dock-resume"
				>
					Resume
				</Button>
				{error && (
					<span className="text-meta text-danger" role="alert">
						{error}
					</span>
				)}
			</div>
		</section>
	);
}

/**
 * The change stream is down (#1101 category 23): a quiet dock above the box, never
 * a modal. The composer keeps its draft; Retry now tries the stream at once.
 */
export function ConnectionDock({ fixedAsOf }: { fixedAsOf?: number } = {}) {
	const status = useStreamStatus();
	const now = useNow(1_000);
	const asOf = fixedAsOf ?? (now === null ? null : reconnectAsOf(status, now));
	if (asOf === null) return null;
	return (
		<section
			aria-label="Connection lost"
			role="status"
			className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-surface bg-surface-2 px-3 py-2 text-meta text-text-2"
			data-testid="connection-dock"
		>
			<span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full bg-warn" />
			<span className="min-w-0 flex-1">
				Connection lost, retrying. Your draft is kept; what you see is as of{" "}
				{formatClock(asOf)}.
			</span>
			<Button
				size="sm"
				variant="text"
				onClick={reconnectNow}
				data-testid="connection-dock-retry"
			>
				Retry now
			</Button>
		</section>
	);
}
