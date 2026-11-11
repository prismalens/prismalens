// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isBlockedMode } from "@prismalens/contracts";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { stopLine, stopMode, stopNext } from "@/lib/provider-stop";
import { countdown, limitState, type ThreadLimit } from "./session-words";

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

const LABEL = {
	usage_limit: "Usage limit",
	rate_limited: "Rate limit",
	overloaded: "Provider busy",
	out_of_credit: "Blocked: out of credit",
	key_rejected: "Blocked: API key rejected",
	spend_cap: "Blocked: spend cap",
} as const;

export interface SwitchChoices {
	/** The thread agent's other models. */
	models: { id: string; label: string }[];
	/** Other agents that are ready; each starts a new thread. */
	agents: { id: string; label: string }[];
}

/**
 * A thread its provider stopped (#1024, #1101): which stop, when it resumes in
 * local time, what happens next, and one action per cause. A Blocked stop has no
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
	accountUrl,
	switchChoices,
	onSwitchModel,
	onSwitchAgent,
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
	/** Fires the waiting retry now, or takes a fixed Blocked stop up again. */
	onRetryNow?: () => void;
	/** Opens the agent's settings, where its key lives. */
	onUpdateKey?: () => void;
	/** The provider's billing or limits page for Add credit and Raise the cap. */
	accountUrl?: string | null;
	switchChoices?: SwitchChoices;
	onSwitchModel?: (model: string) => void;
	onSwitchAgent?: (agent: string) => void;
	pending?: boolean;
	/** A fixed clock, for tests and the gallery. */
	now?: number;
	clock?: (at: string) => string;
}) {
	const mode = stopMode(limit);
	const blocked = isBlockedMode(mode);
	const state = blocked ? "blocked" : limitState(limit);
	const target =
		state === "resuming" || state === "retrying"
			? (limit.nextAttemptAt ?? limit.resetsAt ?? null)
			: null;
	const now = useNow(
		!!target && fixedNow === undefined,
		fixedNow ?? Date.now(),
	);
	const left = target && mode !== "overloaded" ? countdown(target, now) : null;
	const message = draft?.trim() ?? "";
	const retrying = mode === "rate_limited" || mode === "overloaded";
	const switchLabel = blocked
		? "Switch agent"
		: mode === "overloaded"
			? "Switch model"
			: "Switch agent or model";
	return (
		<section
			aria-label={LABEL[mode]}
			className="grid gap-2 rounded-surface bg-surface-2 px-3 py-2.5"
			data-testid="limit-dock"
			data-state={state}
			data-mode={mode}
		>
			<p className="flex flex-wrap items-baseline gap-x-2 text-body text-text-1">
				<span
					aria-hidden
					className={`h-3 w-[3px] shrink-0 self-center rounded-full ${blocked ? "bg-danger" : "bg-warn"}`}
				/>
				<span data-testid="limit-dock-line">
					{stopLine(limit, { clock, now })}
				</span>
				{left && (
					<span
						className="text-meta text-text-3 tabular-nums"
						data-testid="limit-dock-countdown"
					>
						{left}
					</span>
				)}
			</p>
			<p className="text-meta text-text-2" data-testid="limit-dock-next">
				{stopNext(limit)}
			</p>
			{limit.message && !blocked && (
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
				{blocked ? (
					<>
						{mode === "key_rejected" && onUpdateKey ? (
							<Button
								size="sm"
								disabled={pending}
								onClick={onUpdateKey}
								data-testid="limit-dock-update-key"
							>
								Update key
							</Button>
						) : (
							accountUrl && (
								<Button size="sm" asChild data-testid="limit-dock-account">
									<a href={accountUrl} target="_blank" rel="noreferrer">
										{mode === "out_of_credit" ? "Add credit" : "Raise the cap"}
										<ExternalLink className="size-3.5" aria-hidden />
									</a>
								</Button>
							)
						)}
						{onRetryNow && (
							<Button
								size="sm"
								variant="secondary"
								disabled={pending}
								onClick={onRetryNow}
								data-testid="limit-dock-try-again"
							>
								Try again
							</Button>
						)}
					</>
				) : state === "gaveUp" ? (
					<>
						{retrying && onRetryNow ? (
							<Button
								size="sm"
								disabled={pending}
								onClick={onRetryNow}
								data-testid="limit-dock-retry-now"
							>
								Retry now
							</Button>
						) : (
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
						)}
					</>
				) : (
					<>
						{mode === "overloaded" && onRetryNow && (
							<Button
								size="sm"
								disabled={pending}
								onClick={onRetryNow}
								data-testid="limit-dock-retry-now"
							>
								Retry now
							</Button>
						)}
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
					</>
				)}
				{switchChoices &&
					(switchChoices.models.length > 0 ||
						switchChoices.agents.length > 0) && (
						<SwitchMenu
							label={switchLabel}
							choices={
								blocked
									? { models: [], agents: switchChoices.agents }
									: switchChoices
							}
							disabled={pending}
							onModel={onSwitchModel}
							onAgent={onSwitchAgent}
						/>
					)}
				{!blocked && state !== "gaveUp" && limit.autoResume && (
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
			</div>
		</section>
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
				<Button
					size="sm"
					variant="secondary"
					disabled={disabled}
					data-testid="limit-dock-switch"
				>
					{label}
					<ChevronDown className="size-3.5" aria-hidden />
				</Button>
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

/** The `auto-resume` bodies the dock's controls send. */
export const autoResumeBody = {
	dontResume: () => ({ on: false }) as const,
	sendAtReset: (message: string) => ({ on: true, message }) as const,
	resumeAtReset: () => ({ on: true }) as const,
	removeQueued: (on: boolean) => ({ on, message: null }) as const,
};
