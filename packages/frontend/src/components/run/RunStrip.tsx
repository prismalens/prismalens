// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { LogIn, TriangleAlert } from "lucide-react";
import { RunDot } from "@/components/incidents/RunTree";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { SignInButton } from "@/components/thread/session/SignInButton";
import { Button } from "@/components/ui/button";

export interface StripChip {
	text: string;
	title: string;
	warn?: boolean;
}

/**
 * The run's part of the one header (sheet §2): its state word with the detail
 * in a hint, one warning mark when something is off, and Resume or Retry; the
 * runs sit in the header's ⋯. Stop lives in the composer; the credential sits
 * in Run details. A phone keeps the mark; Retry stays in the dock.
 */
export function RunStrip({
	state,
	waiting,
	label,
	detail,
	reason,
	model,
	tools,
	onResume,
	resuming,
	onRetry,
	retrying,
	signIn,
}: {
	state: RunState | null;
	/** The agent waits on your answer in the dock (#673 w5-14). */
	waiting?: boolean;
	label: string;
	detail: string;
	/** The full why behind a short state (#1010 N6). */
	reason?: string | null;
	model?: StripChip | null;
	/** Only when PrismaLens's tools did not reach the agent (#848). */
	tools?: StripChip | null;
	/** An interrupted run PrismaLens did not resume (#981). */
	onResume?: () => void;
	resuming?: boolean;
	/** A failed or stopped investigation: a new run, as the board's Retry run. */
	onRetry?: () => void;
	retrying?: boolean;
	/** A signed-out agent's own sign-in command, run in the terminal or on the host (#1101 cat 23). */
	signIn?: string | null;
}) {
	const warns = [model?.warn ? model : null, tools].filter(
		(c): c is StripChip => !!c,
	);
	return (
		<div
			className="flex min-w-0 shrink items-center gap-1.5 whitespace-nowrap"
			data-testid="run-strip"
		>
			<Hint label={reason ?? detail} when={!!(reason ?? detail)}>
				<span
					className="inline-flex min-w-0 items-center gap-1.5 text-body"
					data-testid="run-strip-label"
				>
					{(state === "starting" || state === "working") && !waiting ? (
						<Ring className="text-accent" />
					) : state ? (
						<RunDot state={state} waiting={waiting} className="size-[7px]" />
					) : null}
					<span className="truncate font-medium text-text-2 max-md:sr-only">
						{label}
					</span>
					<span className="sr-only" data-testid="run-strip-detail">
						, {detail}
					</span>
				</span>
			</Hint>
			{warns.length > 0 && (
				<Hint label={warns.map((w) => w.title).join(". ")}>
					<span
						// biome-ignore lint/a11y/noNoninteractiveTabindex: the warning's words are in its hint, reached by focus.
						tabIndex={0}
						className="flex size-7 items-center justify-center rounded-control text-warn outline-none focus-visible:ring-2 focus-visible:ring-accent max-md:hidden"
						data-testid="run-strip-tools"
					>
						<TriangleAlert className="size-3.5" aria-hidden />
						<span className="sr-only">
							{warns.map((w) => w.text).join(", ")}
						</span>
					</span>
				</Hint>
			)}
			{onResume && (
				<Button
					variant="text"
					size="sm"
					className="shrink-0 max-md:hidden"
					disabled={resuming}
					onClick={onResume}
					data-testid="run-strip-resume"
				>
					Resume
				</Button>
			)}
			{signIn && (
				<SignInButton
					command={signIn}
					trigger={(onClick) => (
						<Button
							variant="text"
							size="sm"
							className="shrink-0 max-md:hidden"
							onClick={onClick}
							data-testid="run-strip-sign-in"
						>
							<LogIn aria-hidden />
							Sign in
						</Button>
					)}
				/>
			)}
			{onRetry && (
				<Button
					variant="text"
					size="sm"
					className="shrink-0 max-md:hidden"
					disabled={retrying}
					onClick={onRetry}
					data-testid="run-strip-retry"
				>
					{retrying ? "Starting" : "Retry"}
				</Button>
			)}
		</div>
	);
}
