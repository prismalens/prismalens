// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, FileText, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refusalReason, refusalSentence } from "@/lib/refusal-sentence";
import { cn } from "@/lib/utils";
import { type RunStep, stepTook } from "./run-steps";

/**
 * One numbered tool call in the transcript (#811): `Step 4 Ran git diff …
 * 0.3s`, the whole row expands to the command and its output. A flagged
 * step carries the red note under it; `highlight` rings a step a link opened.
 */
export function StepCard({
	step,
	open,
	onToggle,
	highlight,
	flagged,
	onSeeFlag,
}: {
	step: RunStep;
	open: boolean;
	onToggle: () => void;
	highlight?: boolean;
	flagged?: boolean;
	onSeeFlag?: () => void;
}) {
	const Icon = step.kind === "file" ? FileText : TerminalSquare;
	const refused =
		step.ok === false ? refusalReason(step.output ?? undefined) : null;
	return (
		<li
			id={`step-${step.n}`}
			className="flex scroll-mt-4 flex-col"
			data-testid="step"
			data-step={step.n}
			data-highlight={highlight ? "" : undefined}
		>
			<div
				className={cn(
					"flex flex-col overflow-hidden rounded-surface bg-surface-1 transition-shadow duration-(--dur-fast)",
					highlight && "shadow-[0_0_0_2px_var(--accent)]",
				)}
			>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={`step-${step.n}-body`}
					onClick={onToggle}
					className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-left whitespace-nowrap text-text-2 transition-colors duration-(--dur-instant) hover:bg-surface-3"
					data-testid="step-toggle"
				>
					<Icon className="size-3.5 shrink-0" aria-hidden />
					<span className="shrink-0 text-meta text-text-3">Step {step.n}</span>
					<span
						className={cn(
							"shrink-0",
							step.ok === false && "text-danger",
							step.ok === null && !step.unfinished && "text-live",
						)}
						data-testid="step-verb"
					>
						{step.verb}
					</span>
					<code className="min-w-0 flex-1 truncate bg-transparent p-0 font-mono text-mono text-text-1">
						{step.command}
					</code>
					<span className="shrink-0 text-meta text-text-3 tabular-nums">
						{stepTook(step.took)}
					</span>
					<ChevronDown
						aria-hidden
						className={cn(
							"size-3 shrink-0 text-text-3 transition-transform duration-(--dur-fast) motion-reduce:transition-none",
							open && "rotate-180",
						)}
					/>
				</button>
				{open && (
					<div
						id={`step-${step.n}-body`}
						className="flex flex-col bg-[linear-gradient(var(--hairline),var(--hairline))] bg-[length:100%_1px] bg-no-repeat"
						data-testid="step-body"
					>
						<pre className="m-0 px-3 pt-2 pb-1 font-mono text-mono whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]">
							$ {step.command}
						</pre>
						<pre
							className={cn(
								"m-0 px-3 pt-1 pb-2.5 font-mono text-mono whitespace-pre-wrap [overflow-wrap:anywhere]",
								step.ok === false ? "text-danger" : "text-text-2",
							)}
							data-testid="step-output"
						>
							{refused
								? refusalSentence(refused)
								: (step.output ??
									(step.unfinished
										? "The turn ended before this call answered."
										: "Running."))}
						</pre>
					</div>
				)}
			</div>
			{flagged && (
				<div
					role="note"
					className="mt-1.5 flex items-center gap-2.5 rounded-surface bg-[oklch(from_var(--danger)_l_c_h/0.14)] px-3 py-2"
					data-testid="step-flag"
				>
					<span className="min-w-0 flex-1 text-text-1">
						This output contained an instruction aimed at the agent. The agent
						ignored it.
					</span>
					{onSeeFlag && (
						<Button
							size="sm"
							variant="secondary"
							onClick={onSeeFlag}
							data-testid="step-flag-details"
						>
							See details
						</Button>
					)}
				</div>
			)}
		</li>
	);
}
