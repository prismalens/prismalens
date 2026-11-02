// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { Square } from "lucide-react";
import { RunDot } from "@/components/incidents/RunTree";
import type { RunRef } from "@/components/incidents/record-context";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { RunsMenu } from "./RunsMenu";

export interface StripChip {
	text: string;
	title: string;
	warn?: boolean;
}

/**
 * The run strip under the header (#811): state, what it is doing (never
 * under 100 px), the model (warn only on a mismatch), which credential
 * cloned the code, a warning when PrismaLens's tools did not reach the
 * agent (#848), Stop run while live, and the runs menu. A phone drops the
 * chips, which Run details' Summary carries, so the runs menu stays on screen (0.5.3 walk W11).
 */
export function RunStrip({
	state,
	waiting,
	label,
	detail,
	reason,
	model,
	code,
	tools,
	onStop,
	stopping,
	onResume,
	resuming,
	incidentId,
	runs,
	current,
}: {
	state: RunState | null;
	/** The agent waits on your answer in the dock (#673 w5-14). */
	waiting?: boolean;
	label: string;
	detail: string;
	/** The full why behind a short state: a phone drops the detail and the label opens this (#1010 N6). */
	reason?: string | null;
	model?: StripChip | null;
	/** Hidden while the details panel is open: its Summary carries it. */
	code?: StripChip | null;
	/** Only when PrismaLens's tools did not reach the agent (#848). */
	tools?: StripChip | null;
	/** Live only. */
	onStop?: () => void;
	stopping?: boolean;
	/** An interrupted run PrismaLens did not resume (#981). */
	onResume?: () => void;
	resuming?: boolean;
	incidentId: string;
	runs: RunRef[];
	current: string | null;
}) {
	return (
		<div
			className="relative flex h-9 min-w-0 shrink-0 items-center gap-2 px-4 whitespace-nowrap md:gap-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline"
			data-testid="run-strip"
		>
			{state ? (
				<RunDot state={state} waiting={waiting} className="size-[7px]" />
			) : (
				<span
					aria-hidden
					className="size-[7px] shrink-0 rounded-full bg-text-3"
				/>
			)}
			{reason ? (
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							className="min-w-0 truncate text-left font-medium max-md:flex-1 md:shrink-0"
							data-testid="run-strip-label"
						>
							{label}
						</button>
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="text-meta text-text-2"
						data-testid="run-strip-reason"
					>
						{reason}
					</PopoverContent>
				</Popover>
			) : (
				<span
					className="min-w-0 truncate font-medium md:shrink-0"
					data-testid="run-strip-label"
				>
					{label}
				</span>
			)}
			<span
				className={cn(
					"min-w-0 flex-1 truncate md:min-w-[100px]",
					waiting ? "text-warn" : "text-text-2",
					reason && "max-md:hidden",
				)}
				data-testid="run-strip-detail"
			>
				{detail}
			</span>
			{model && <Chip chip={model} testId="run-strip-model" />}
			{code && <Chip chip={code} testId="run-strip-code" />}
			{tools && <Chip chip={tools} testId="run-strip-tools" />}
			{onStop && (
				<Button
					variant="secondary"
					className="h-[26px] shrink-0 gap-1.5 bg-surface-2 hover:bg-surface-3"
					disabled={stopping}
					onClick={onStop}
					data-testid="run-strip-stop"
				>
					<Square className="size-3 fill-current" aria-hidden />
					{stopping ? "Stopping" : "Stop run"}
				</Button>
			)}
			{onResume && (
				<Button
					variant="primary"
					className="h-[26px] shrink-0"
					disabled={resuming}
					onClick={onResume}
					data-testid="run-strip-resume"
				>
					Resume
				</Button>
			)}
			<RunsMenu incidentId={incidentId} runs={runs} current={current} />
		</div>
	);
}

function Chip({ chip, testId }: { chip: StripChip; testId: string }) {
	return (
		<Hint label={chip.title}>
			<span
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the chip's full source is in its hint, which keyboard users reach by focus.
				tabIndex={0}
				className={cn(
					"h-[22px] max-w-64 shrink-0 truncate rounded-[4px] bg-surface-2 px-2 text-meta leading-[22px] max-md:hidden",
					chip.warn ? "text-warn" : "text-text-3",
				)}
				data-testid={testId}
			>
				{chip.text}
			</span>
		</Hint>
	);
}
