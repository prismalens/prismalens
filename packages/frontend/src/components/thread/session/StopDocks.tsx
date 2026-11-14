// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { actionById } from "@/components/kit/registry";
import { Strip, StripAction } from "@/components/kit/Strip";
import { useNow } from "@/hooks/use-now";
import { useRunScheduleNow } from "@/lib/api/hooks/use-schedules-orpc";
import {
	reconnectAsOf,
	reconnectNow,
	useStreamStatus,
} from "@/lib/api/live-refresh";
import { failureSentence } from "@/lib/failure-sentence";
import { failureWords, signInCommand } from "@/lib/failure-words";
import { formatClock } from "@/lib/format-time";
import { stopCause } from "@/lib/stop-causes";
import { SignInButton } from "./SignInButton";

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
				status="interrupted"
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
 * No disk space for the thread's worktree (#1101 git.worktree-disk): Blocked, with the
 * cause's registered fix, Free space, which opens the workspaces and their sizes.
 */
export function DiskDock({ onFreeSpace }: { onFreeSpace: () => void }) {
	const cause = stopCause("disk_full");
	// The cause's registered fix, so the dock and Home's card offer the same action.
	const fix = cause.fix ? actionById(cause.fix) : undefined;
	const label = typeof fix?.label === "string" ? fix.label : "Free space";
	const Icon =
		fix && typeof fix.icon !== "function" ? (fix.icon as LucideIcon) : null;
	return (
		<div className="contents" data-testid="disk-dock">
			<Strip
				status="blocked"
				head={cause.head}
				label={cause.name}
				title={cause.next}
				actions={
					<StripAction onClick={onFreeSpace} testId="disk-dock-free-space">
						{Icon && <Icon className="size-3" aria-hidden />}
						{label}
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
	signIn,
}: {
	/** One line; the agent's own words are left out when its last message says them. */
	cause?: string | null;
	onRetry?: () => void;
	retryHint?: string;
	pending?: boolean;
	/** A signed-out agent's sign-in command: Sign in opens the terminal to run it (#1101 cat 23). */
	signIn?: string | null;
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
					<>
						{signIn && (
							<SignInButton
								command={signIn}
								trigger={(onClick) => (
									<StripAction
										onClick={onClick}
										title={`Run ${signIn}, then Retry`}
										testId="failed-dock-sign-in"
									>
										Sign in
									</StripAction>
								)}
							/>
						)}
						{onRetry && (
							<StripAction
								disabled={pending}
								onClick={onRetry}
								title={retryHint}
								testId="failed-dock-retry"
							>
								Retry
							</StripAction>
						)}
					</>
				}
			/>
		</div>
	);
}

/**
 * A failed scheduled run that kept no workspace: Retry runs its schedule again and
 * opens the new run. Its own component, so only such a run loads the schedule hooks.
 */
export function ScheduledFailedDock({
	cause,
	scheduleId,
}: {
	cause?: string | null;
	scheduleId: string;
}) {
	const navigate = useNavigate();
	const run = useRunScheduleNow();
	return (
		<FailedDock
			cause={cause}
			retryHint="Run the schedule again"
			pending={run.isPending}
			onRetry={() =>
				run.mutate(
					{ id: scheduleId },
					{
						onSuccess: (tick) =>
							tick.run &&
							void navigate({
								to: "/schedules/$id/runs/$runId",
								params: { id: scheduleId, runId: tick.run.id },
							}),
					},
				)
			}
		/>
	);
}

/** The agent's sign-in command when signing in is what fixes this error; null otherwise. */
export function signInOf(
	error: string | null | undefined,
	hint: string | undefined,
): string | null {
	return error && failureWords(error).signIn ? signInCommand(hint) : null;
}

/** The failed dock's one line, always: the strip carries the cause even when the transcript also says it (#1101). */
export function failedCause(
	agent: string,
	error: string | null | undefined,
	hint: string | undefined,
): string | null {
	const s = failureSentence(agent, error, hint);
	if (!s.words) return s.detail && s.next ? `${s.said} ${s.next}` : s.said;
	return s.words;
}
