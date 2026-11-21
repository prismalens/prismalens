// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	PR_SUB_END_WORDS,
	type PrSubscriptionView,
	shortTime,
} from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { Bot, Link2, RefreshCw, User } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Hint } from "@/components/shared/Hint";
import { Empty, Loading, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import {
	usePrSubscriptionActions,
	usePrSubscriptions,
} from "@/lib/api/hooks/use-pr-subscriptions";
import { lazyPart } from "@/lib/lazy";
import { type StopCause, stopCause, stopCauses } from "@/lib/stop-causes";
import { cn } from "@/lib/utils";

const DestructiveConfirm = lazyPart(
	() =>
		import("@/components/shared/DestructiveConfirm").then(
			(m) => m.DestructiveConfirm,
		),
	<Loading rows={2} />,
);

/** Ended rows past this many fold behind "N more". */
const ENDED_SHOWN = 3;
const ICON = "size-3.5 shrink-0 stroke-[1.75]";

const CREATOR = {
	agent: { Icon: Bot, word: "Agent" },
	user: { Icon: User, word: "You" },
	auto: { Icon: Link2, word: "Linked PR" },
} as const;

type Actions = ReturnType<typeof usePrSubscriptionActions>;

function locale(): string | undefined {
	return typeof navigator === "undefined" ? undefined : navigator.language;
}

/** At most five words on screen; the rest is the hint. */
function StateWord({ s }: { s: PrSubscriptionView }) {
	const at = (iso: string | null) =>
		iso ? shortTime(new Date(iso), locale()) : null;
	const r = s.paused?.reason;
	const cause =
		r && (stopCauses.members as readonly string[]).includes(r)
			? stopCause(r as StopCause)
			: null;
	let word: ReactNode;
	let hint: string | null = null;
	let tone = "text-text-2";
	if (s.state === "ended") {
		const why = s.endReason ? PR_SUB_END_WORDS[s.endReason] : null;
		word = why && why.split(" ").length <= 4 ? `Ended: ${why}` : "Ended";
		hint = [why, s.endNote].filter(Boolean).join(". ") || null;
		tone = "text-text-3";
	} else if (s.deliveryFailing) {
		word = "Delivery failing";
		hint = s.deliveryFailing.lastError;
		tone = "text-danger";
	} else if (s.state === "disconnected") {
		word = "Disconnected";
		hint = s.hostError;
		tone = "text-danger";
	} else if (s.paused?.reason === "setting_off") {
		word = (
			<Link
				to="/settings"
				search={{ tab: "sources" }}
				className="hover:text-text-1 hover:underline"
			>
				Paused: setting off
			</Link>
		);
		hint = "PR status is off in Settings";
	} else if (cause?.source === "prismalens") {
		word = `Paused: ${cause.name}`;
	} else if (s.paused?.reason === "settling") {
		word = "Paused: settling";
	} else if (s.paused) {
		const until = at(s.paused.until);
		word = until ? `Paused until ${until}` : "Paused";
		hint =
			s.paused.reason === "rate_limited"
				? "The code host asked us to wait"
				: "The agent's usage limit";
	} else word = "Active";
	const shown = (
		<span className={cn("shrink-0", tone)} data-testid="pr-sub-state">
			{word}
		</span>
	);
	return hint ? <Hint label={hint}>{shown}</Hint> : shown;
}

function counts(s: PrSubscriptionView): string {
	const c = s.counts;
	const parts = [`${c.delivered} delivered`, `${c.waiting} waiting`];
	if (c.filtered) parts.push(`${c.filtered} left out`);
	if (c.alreadySent) parts.push(`${c.alreadySent} already sent`);
	return parts.join(", ");
}

function Row({
	s,
	actions,
	prId,
}: {
	s: PrSubscriptionView;
	actions: Actions;
	prId: string;
}) {
	const [confirm, setConfirm] = useState(false);
	const creator = CREATOR[s.createdBy];
	const ended = s.state === "ended";
	const last = s.lastDeliveredAt
		? shortTime(new Date(s.lastDeliveredAt), locale())
		: null;
	const cancel = () => actions.cancel(s.id);
	return (
		<li
			className={cn(
				"flex min-w-0 flex-col gap-0.5 py-1 text-meta",
				ended && "opacity-60",
			)}
			data-testid="pr-sub-row"
			data-state={s.state}
		>
			<div className="flex min-w-0 items-center gap-2">
				<Hint label={creator.word}>
					<span className="inline-flex shrink-0 text-text-3">
						<creator.Icon aria-label={creator.word} className={ICON} />
					</span>
				</Hint>
				<span className="min-w-0 truncate text-text-1">{s.summary}</span>
				<span aria-hidden className="text-text-3">
					·
				</span>
				<StateWord s={s} />
				<span className="ml-auto flex shrink-0 items-center gap-1">
					{s.deliveryFailing && (
						<Button
							variant="text"
							size="sm"
							disabled={actions.busy}
							onClick={() => void actions.retry()}
							data-testid="pr-sub-retry"
						>
							Retry
						</Button>
					)}
					{ended ? (
						<Button
							variant="text"
							size="sm"
							disabled={actions.busy}
							onClick={() => void actions.resume(prId, s.id)}
							data-testid="pr-sub-resume"
						>
							Resume
						</Button>
					) : (
						<Button
							variant="text"
							size="sm"
							disabled={actions.busy}
							onClick={() =>
								s.counts.waiting > 0 ? setConfirm(true) : void cancel()
							}
							data-testid="pr-sub-cancel"
						>
							Cancel
						</Button>
					)}
				</span>
			</div>
			<span className="ml-[22px] text-text-3 tabular-nums">
				{counts(s)}
				{last && `, last ${last}`}
			</span>
			{confirm && (
				<DestructiveConfirm
					open={confirm}
					onOpenChange={setConfirm}
					title={`Discard ${s.counts.waiting} waiting ${s.counts.waiting === 1 ? "event" : "events"}?`}
					description="The agent will not get them."
					confirmLabel="Cancel subscription"
					onConfirm={cancel}
				/>
			)}
		</li>
	);
}

/**
 * One PR's subscriptions (#1179 §7): who made each, what it hears, its state and
 * counts, and Retry, Cancel, Resume and Check now.
 */
export function PrSubscriptions({
	threadId,
	prId,
}: {
	threadId: string;
	prId: string;
}) {
	const query = usePrSubscriptions(threadId, prId);
	const actions = usePrSubscriptionActions(threadId);
	const [allEnded, setAllEnded] = useState(false);
	if (query.isPending) return <Loading rows={2} />;
	if (query.isError)
		return (
			<Problem
				text="Subscriptions didn't load"
				onRetry={() => void query.refetch()}
			/>
		);
	const subs = query.data.subscriptions;
	const live = subs.filter((s) => s.state !== "ended");
	const ended = subs.filter((s) => s.state === "ended");
	const shownEnded = allEnded ? ended : ended.slice(0, ENDED_SHOWN);
	if (!subs.length)
		return (
			<Empty
				text="No subscriptions"
				testId="pr-subs-empty"
				action={
					<Button
						variant="text"
						size="sm"
						disabled={actions.busy}
						onClick={() => void actions.start(prId)}
						data-testid="pr-sub-start"
					>
						Subscribe
					</Button>
				}
			/>
		);
	return (
		<div className="flex min-w-0 flex-col" data-testid="pr-subscriptions">
			<ul className="flex min-w-0 flex-col">
				{[...live, ...shownEnded].map((s) => (
					<Row key={s.id} s={s} actions={actions} prId={prId} />
				))}
			</ul>
			<span className="flex items-center gap-1">
				{actions.error && (
					<Hint label={actions.error}>
						<span className="text-meta text-danger" data-testid="pr-sub-error">
							Didn't go through
						</span>
					</Hint>
				)}
				{ended.length > ENDED_SHOWN && !allEnded && (
					<Button variant="text" size="sm" onClick={() => setAllEnded(true)}>
						{ended.length - ENDED_SHOWN} more
					</Button>
				)}
				{live.length > 0 && (
					<Button
						variant="text"
						size="sm"
						disabled={actions.polling}
						onClick={() => void actions.poll()}
						data-testid="pr-sub-poll"
					>
						<RefreshCw aria-hidden className="size-3" />
						Check now
					</Button>
				)}
			</span>
		</div>
	);
}
