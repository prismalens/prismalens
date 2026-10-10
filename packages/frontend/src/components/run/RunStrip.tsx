// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { RunState } from "@prismalens/contracts";
import { Square } from "lucide-react";
import { RunDot } from "@/components/incidents/RunTree";
import type { RunRef } from "@/components/incidents/record-context";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
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
 * cloned the code, Stop run while live, and the runs menu.
 */
export function RunStrip({
	state,
	label,
	detail,
	model,
	code,
	onStop,
	stopping,
	incidentId,
	runs,
	current,
}: {
	state: RunState | null;
	label: string;
	detail: string;
	model?: StripChip | null;
	/** Hidden while the details panel is open: its Summary carries it. */
	code?: StripChip | null;
	/** Live only. */
	onStop?: () => void;
	stopping?: boolean;
	incidentId: string;
	runs: RunRef[];
	current: string | null;
}) {
	return (
		<div
			className="relative flex h-9 min-w-0 shrink-0 items-center gap-3 px-4 whitespace-nowrap after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-hairline"
			data-testid="run-strip"
		>
			{state ? (
				<RunDot state={state} className="size-[7px]" />
			) : (
				<span
					aria-hidden
					className="size-[7px] shrink-0 rounded-full bg-text-3"
				/>
			)}
			<span className="shrink-0 font-medium" data-testid="run-strip-label">
				{label}
			</span>
			<span
				className="min-w-[100px] flex-1 truncate text-text-2"
				data-testid="run-strip-detail"
			>
				{detail}
			</span>
			{model && <Chip chip={model} testId="run-strip-model" />}
			{code && <Chip chip={code} testId="run-strip-code" />}
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
					"h-[22px] max-w-64 shrink-0 truncate rounded-[4px] bg-surface-2 px-2 text-meta leading-[22px]",
					chip.warn ? "text-warn" : "text-text-3",
				)}
				data-testid={testId}
			>
				{chip.text}
			</span>
		</Hint>
	);
}
