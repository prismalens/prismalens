// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { ChevronDown, FileText, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refusalReason, refusalSentence } from "@/lib/refusal-sentence";
import { type AskRecord, askEnd, refusedVerb } from "@/lib/run-asks";
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
	ask,
}: {
	step: RunStep;
	open: boolean;
	onToggle: () => void;
	highlight?: boolean;
	flagged?: boolean;
	onSeeFlag?: () => void;
	/** The agent asked before this call; the ask itself waits in the dock (#820). */
	ask?: AskRecord;
}) {
	const Icon = step.kind === "file" ? FileText : Terminal;
	const waiting = ask?.state === "waiting";
	const refused =
		step.ok === false ? refusalReason(step.output ?? undefined) : null;
	const denied = step.ok === false && ask ? refusedVerb(ask.state) : null;
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
							waiting && "text-warn",
							!waiting && step.ok === false && !denied && "text-danger",
							!waiting && step.ok === null && !step.unfinished && "text-live",
						)}
						data-testid="step-verb"
					>
						{waiting ? "Waiting" : (denied ?? step.verb)}
					</span>
					<span className="min-w-0 flex-1 truncate font-mono text-mono text-text-1">
						{step.command}
					</span>
					<span className="shrink-0 text-meta text-text-3 tabular-nums">
						{waiting ? "" : stepTook(step.took)}
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
						{step.input && (
							<pre
								className="m-0 max-h-60 overflow-auto px-3 pb-1 font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]"
								data-testid="step-input"
							>
								{step.input}
							</pre>
						)}
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
			{ask && (
				<p
					className={cn(
						"mt-1 px-3 text-meta",
						waiting ? "text-warn" : "text-text-3",
					)}
					data-testid="step-ask"
					data-state={ask.state}
				>
					{askEnd(ask)}
				</p>
			)}
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
