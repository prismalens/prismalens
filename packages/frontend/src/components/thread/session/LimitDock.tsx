// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Strip, StripAction } from "@/components/kit/Strip";
import { Hint } from "@/components/shared/Hint";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { stopLine, stopMode, stopNext, stopStrip } from "@/lib/provider-stop";
import { stopCause } from "@/lib/stop-causes";
import { limitState, type ThreadLimit } from "./session-words";

/** Ticks once a second only while a short wait counts down (a busy provider's retry). */
function useNow(active: boolean, initial: number): number {
	const [now, setNow] = useState(initial);
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [active]);
	return now;
}

const SNOOZE_KEY = "pl.limit.snooze";

function readSnoozes(): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? "{}") as Record<
			string,
			string
		>;
	} catch {
		return {};
	}
}

/** Snooze until reset hides the strip until its time; the row and header keep saying Limited. */
function useSnooze(
	key: string | undefined,
	until: string | null | undefined,
): [boolean, () => void] {
	const [snoozed, setSnoozed] = useState(
		() =>
			!!key &&
			!!until &&
			readSnoozes()[key] === until &&
			Date.parse(until) > Date.now(),
	);
	const snooze = () => {
		if (!key || !until) return;
		const kept = Object.fromEntries(
			Object.entries(readSnoozes()).filter(
				([, at]) => Date.parse(at) > Date.now(),
			),
		);
		try {
			localStorage.setItem(
				SNOOZE_KEY,
				JSON.stringify({ ...kept, [key]: until }),
			);
		} catch {}
		setSnoozed(true);
	};
	return [snoozed, snooze];
}

export interface SwitchChoices {
	/** The thread agent's other models. */
	models: { id: string; label: string }[];
	/** Other agents that are ready; each starts a new thread. */
	agents: { id: string; label: string }[];
}

/**
 * A thread its provider stopped (#1024, #1101), as the strip on the composer's top
 * edge (sheet §10): the stop, one time, and quiet actions. A Blocked stop has no
 * timer and never says it resumes.
 */
export function LimitDock({
	limit,
	draft,
	onDontResume,
	onSendAtReset,
	onResumeAtReset,
	onRemoveQueued,
	onSend,
	onRetryNow,
	onUpdateKey,
	account,
	switchChoices,
	onSwitchModel,
	onSwitchAgent,
	pending = false,
	now: fixedNow,
	clock,
	snoozeKey,
}: {
	limit: ThreadLimit;
	/** The composer's draft; "Send at reset" takes it. */
	draft?: string;
	onDontResume: () => void;
	onSendAtReset: (message: string) => void;
	/** Turns auto-resume back on with no message; offered while it is off. */
	onResumeAtReset?: () => void;
	/** Drops the queued draft and leaves auto-resume as it is. */
	onRemoveQueued?: () => void;
	onSend?: () => void;
	/** Fires the waiting retry now, or takes a fixed Blocked stop up again. */
	onRetryNow?: () => void;
	/** Opens the agent's settings, where its key and account live. */
	onUpdateKey?: () => void;
	/** The provider's billing or limits page, named for where it goes ("Open Anthropic limits"). */
	account?: { url: string; label: string } | null;
	switchChoices?: SwitchChoices;
	onSwitchModel?: (model: string) => void;
	onSwitchAgent?: (agent: string) => void;
	pending?: boolean;
	/** A fixed clock, for tests and the gallery. */
	now?: number;
	clock?: (at: string) => string;
	/** The thread, so Snooze until reset is remembered per thread. */
	snoozeKey?: string;
}) {
	const mode = stopMode(limit);
	const cause = stopCause(mode);
	const blocked = cause.state === "blocked";
	const state = blocked ? "blocked" : limitState(limit);
	const now = useNow(
		!!cause.countdown && !!limit.nextAttemptAt && fixedNow === undefined,
		fixedNow ?? Date.now(),
	);
	const until = limit.nextAttemptAt ?? limit.resetsAt;
	const [snoozed, snooze] = useSnooze(snoozeKey, until);
	if (snoozed && !blocked) return null;
	const { head, detail } = stopStrip(limit, { clock, now });
	const message = draft?.trim() ?? "";
	const retrying = !!cause.retries;
	const choices =
		switchChoices &&
		(blocked ? { models: [], agents: switchChoices.agents } : switchChoices);
	const canSwitch =
		!!choices &&
		choices.models.length + choices.agents.length > 0 &&
		(blocked || state === "gaveUp" || !!cause.switchWhileWaiting);
	const queued = limit.message ?? null;
	// PrismaLens can't change an account's cap or credit: the action names the page it opens.
	const accountHint = cause.account
		? `PrismaLens can't change this. ${cause.account.word} on your account there, then send your message again.`
		: "";
	const elsewhere = !!cause.account && !account;
	const act = (testId: string, label: string, onClick?: () => void) =>
		onClick && (
			<StripAction disabled={pending} onClick={onClick} testId={testId}>
				{label}
			</StripAction>
		);
	return (
		<div
			className="contents"
			data-testid="limit-dock"
			data-state={state}
			data-mode={mode}
		>
			<Strip
				status={blocked ? "blocked" : "limited"}
				head={head}
				detail={
					detail || queued || elsewhere ? (
						<>
							<span data-testid="limit-dock-line">
								{elsewhere
									? `${cause.account?.word} on the provider's account`
									: detail}
							</span>
							{queued && (
								<Hint label={queued}>
									<span data-testid="limit-dock-queued">
										{detail ? " · " : ""}
										{blocked
											? "sends your message on retry"
											: "sends your message"}
									</span>
								</Hint>
							)}
						</>
					) : null
				}
				title={`${stopLine(limit, { clock, now })}. ${stopNext(limit)}`}
				actions={
					<>
						{blocked ? (
							<>
								{cause.fixInSettings ? (
									act("limit-dock-update-key", "Update key", onUpdateKey)
								) : account ? (
									<Hint label={accountHint}>
										<StripAction href={account.url} testId="limit-dock-account">
											{account.label}
											<ExternalLink className="size-3" aria-hidden />
										</StripAction>
									</Hint>
								) : null}
								{!cause.noTryAgain &&
									act("limit-dock-try-again", "Try again", onRetryNow)}
								{queued &&
									act(
										"limit-dock-remove-queued",
										"Remove message",
										onRemoveQueued,
									)}
							</>
						) : state === "gaveUp" ? (
							retrying && onRetryNow ? (
								act("limit-dock-retry-now", "Retry now", onRetryNow)
							) : (
								act("limit-dock-send", "Send", onSend)
							)
						) : (
							<>
								{/* A limit can lift early (a plan change); the waiting wake fires at once. */}
								{cause.retryNow &&
									act("limit-dock-retry-now", "Retry now", onRetryNow)}
								{message &&
									!queued &&
									act("limit-dock-send-at-reset", "Send at reset", () =>
										onSendAtReset(message),
									)}
								{queued &&
									act(
										"limit-dock-remove-queued",
										"Remove message",
										onRemoveQueued,
									)}
								{!limit.autoResume &&
									act(
										"limit-dock-resume-at-reset",
										"Resume at reset",
										onResumeAtReset,
									)}
								{limit.autoResume &&
									act(
										"limit-dock-dont-resume",
										"Cancel auto-resume",
										onDontResume,
									)}
								{snoozeKey && until && (
									<StripAction onClick={snooze} testId="limit-dock-snooze">
										Snooze until reset
									</StripAction>
								)}
							</>
						)}
						{canSwitch && choices && (
							<SwitchMenu
								label={blocked ? "Switch agent" : "Switch"}
								choices={choices}
								disabled={pending}
								onModel={onSwitchModel}
								onAgent={onSwitchAgent}
							/>
						)}
					</>
				}
			/>
		</div>
	);
}

function SwitchMenu({
	label,
	choices,
	disabled,
	onModel,
	onAgent,
}: {
	label: string;
	choices: SwitchChoices;
	disabled: boolean;
	onModel?: (model: string) => void;
	onAgent?: (agent: string) => void;
}) {
	if (choices.models.length + choices.agents.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<StripAction disabled={disabled} testId="limit-dock-switch">
					{label}
					<ChevronDown className="size-3" aria-hidden />
				</StripAction>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{choices.models.length > 0 && (
					<>
						<DropdownMenuLabel>Continue here with</DropdownMenuLabel>
						{choices.models.map((m) => (
							<DropdownMenuItem
								key={m.id}
								onSelect={() => onModel?.(m.id)}
								data-testid="limit-dock-switch-model"
							>
								{m.label}
							</DropdownMenuItem>
						))}
					</>
				)}
				{choices.models.length > 0 && choices.agents.length > 0 && (
					<DropdownMenuSeparator />
				)}
				{choices.agents.length > 0 && (
					<>
						<DropdownMenuLabel>New thread with</DropdownMenuLabel>
						{choices.agents.map((a) => (
							<DropdownMenuItem
								key={a.id}
								onSelect={() => onAgent?.(a.id)}
								data-testid="limit-dock-switch-agent"
							>
								{a.label}
							</DropdownMenuItem>
						))}
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export { autoResumeBody } from "./auto-resume";
