// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { HARNESS_DATA_NOTE } from "@prismalens/contracts";
import { ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Surface } from "@/components/kit/Surface";
import { TOOL_LINE, ToolLineChevron } from "@/components/kit/ToolLine";
import { CopyButton } from "@/components/shared/CopyButton";
import { Hint } from "@/components/shared/Hint";
import { Ring } from "@/components/shared/Ring";
import { RunInTerminal } from "@/components/terminal/RunInTerminal";
import { Button } from "@/components/ui/button";
import { refusalReason, refusalSentence } from "@/lib/refusal-sentence";
import { type AskRecord, askEnd, refusedVerb } from "@/lib/run-asks";
import { NODE_ICON } from "@/lib/spine";
import { cn } from "@/lib/utils";
import { PlMark } from "./PlMark";
import { exitCode, type RunStep, stepTook } from "./run-steps";

/**
 * One tool call as a flat line (sheet §2): icon, verb, subject, chevron; no
 * frame and no step number. Opened, the command and output sit indented in
 * plain mono. A flagged step carries its note under it.
 */
export function StepCard({
	step,
	open,
	onToggle,
	highlight,
	flagged,
	onSeeFlag,
	ask,
	fileSha,
	onOpenFile,
	nested,
}: {
	step: RunStep;
	open: boolean;
	onToggle: () => void;
	highlight?: boolean;
	flagged?: boolean;
	onSeeFlag?: () => void;
	/** The agent asked before this call; the ask itself waits in the dock (#820). */
	ask?: AskRecord;
	/** The commit a read step's file is shown at; absent when it is outside the run's code. */
	fileSha?: string;
	onOpenFile?: () => void;
	/** Under its group's line: indented one icon's width. */
	nested?: boolean;
}) {
	const node = step.node ?? (step.kind === "file" ? "read" : "command");
	const Icon = NODE_ICON[node];
	const waiting = ask?.state === "waiting";
	const refused =
		step.ok === false ? refusalReason(step.output ?? undefined) : null;
	const denied = step.ok === false && ask ? refusedVerb(ask.state) : null;
	const failed = step.ok === false && !denied;
	const running = step.ok === null && !step.unfinished && !waiting;
	const command = step.run ?? step.command;
	const why =
		failed && !refused && step.output
			? failLine(step.output)
			: step.unfinished
				? "The turn ended before this call answered."
				: null;
	const canOpenFile = !!fileSha && !!onOpenFile;
	const exit = exitCode(step);
	return (
		<Surface
			id="tool.row"
			ctx={{
				command,
				output: step.output ?? "",
				onToggle,
				onOpenFile: canOpenFile ? onOpenFile : undefined,
				facts: {
					is: { open, hasOutput: !!step.output, hasFile: canOpenFile },
				},
			}}
		>
			<li
				id={`step-${step.n}`}
				className={cn(
					"flex min-w-0 scroll-mt-4 flex-col",
					nested && "pl-[22px]",
				)}
				data-testid="step"
				data-step={step.n}
				data-node={node}
				data-highlight={highlight ? "" : undefined}
			>
				<button
					type="button"
					aria-expanded={open}
					aria-controls={`step-${step.n}-body`}
					onClick={onToggle}
					className={cn(
						TOOL_LINE,
						"whitespace-nowrap",
						highlight && "bg-surface-2 text-text-1",
					)}
					data-testid="step-toggle"
				>
					<span
						className={cn(
							"flex size-3.5 shrink-0 items-center justify-center",
							failed ? "text-danger" : waiting ? "text-warn" : "text-text-3",
						)}
					>
						{running ? (
							<Hint label="Running">
								<span role="img" aria-label="Running" className="flex">
									<Ring className="size-3.5" />
								</span>
							</Hint>
						) : failed ? (
							<Hint label="Failed">
								<X
									role="img"
									aria-label="Failed"
									className="size-3.5 stroke-[2]"
								/>
							</Hint>
						) : waiting ? (
							<ShieldAlert aria-hidden className="size-3.5 stroke-[1.75]" />
						) : step.pl ? (
							<PlMark />
						) : (
							<Icon aria-hidden className="size-3.5 stroke-[1.75]" />
						)}
					</span>
					{/* A PrismaLens step's title carries its own verb, running or done (#1101). */}
					{(waiting || denied || !step.gateway || step.ok === false) && (
						<span className="shrink-0" data-testid="step-verb">
							{waiting ? "Waiting" : (denied ?? step.verb)}
						</span>
					)}
					<span
						className={cn(
							"min-w-0 truncate",
							!step.gateway && "font-mono text-mono",
						)}
						data-testid="step-title"
					>
						{step.gateway ? step.title : (step.subject ?? step.command)}
					</span>
					{why ? (
						<span
							className="min-w-0 shrink-[2] truncate text-danger"
							data-testid="step-why"
						>
							{why}
						</span>
					) : (
						step.outcome && (
							<span
								className="min-w-0 shrink-[2] truncate text-text-3"
								data-testid="step-outcome"
							>
								{step.outcome}
							</span>
						)
					)}
					<span className="flex-1" />
					{exit !== null && (
						<Hint label={`Exit code ${exit}`}>
							<span
								className="shrink-0 font-mono text-meta text-danger tabular-nums"
								data-testid="step-exit"
							>
								exit {exit}
							</span>
						</Hint>
					)}
					<span className="shrink-0 text-meta text-text-3 tabular-nums">
						{waiting ? "" : stepTook(step.took)}
					</span>
					<ToolLineChevron open={open} />
				</button>
				{step.pl?.args && (
					<p
						className="truncate pl-[22px] font-mono text-meta text-text-3"
						data-testid="step-args"
					>
						{step.pl.args}
					</p>
				)}
				{step.dataNote && (
					<p
						className="pl-[22px] text-meta text-text-3"
						data-testid="step-data-note"
					>
						{HARNESS_DATA_NOTE}
					</p>
				)}
				{open && (
					<div
						id={`step-${step.n}-body`}
						className="group/cmd flex min-w-0 flex-col gap-1 pb-1 pl-[22px]"
						data-testid="step-body"
					>
						<div className="relative min-w-0" data-testid="step-command">
							<pre className="m-0 pr-28 font-mono text-mono whitespace-pre-wrap text-text-1 [overflow-wrap:anywhere]">
								$ <code>{step.command}</code>
							</pre>
							{/* Copy and Run in terminal show on hover or focus, over the line's end. */}
							<span className="absolute top-0 right-0 flex items-center gap-1 opacity-0 group-focus-within/cmd:opacity-100 group-hover/cmd:opacity-100 [@media(hover:none)]:opacity-100">
								{step.shell && <RunInTerminal command={command} compact />}
								<CopyButton value={command} variant="text" />
							</span>
						</div>
						{fileSha && onOpenFile && (
							<button
								type="button"
								id={`open-step-${step.n}`}
								onClick={onOpenFile}
								className="self-start text-meta text-accent underline underline-offset-[3px] decoration-[oklch(from_var(--accent)_l_c_h/0.4)] hover:decoration-current"
								data-testid="step-open-file"
							>
								Open the file at {fileSha.slice(0, 7)}
							</button>
						)}
						{step.input && (
							<pre
								className="m-0 max-h-60 overflow-auto font-mono text-mono whitespace-pre-wrap text-text-2 [overflow-wrap:anywhere]"
								data-testid="step-input"
							>
								{step.input}
							</pre>
						)}
						<pre
							className={cn(
								"m-0 max-h-80 overflow-auto font-mono text-mono whitespace-pre-wrap [overflow-wrap:anywhere]",
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
				{ask && (
					<p
						className="pl-[22px] text-meta text-text-2"
						data-testid="step-ask"
						data-state={ask.state}
					>
						{askEnd(ask)}
					</p>
				)}
				{flagged && (
					<div
						role="note"
						className="flex min-w-0 items-center gap-2 pl-[22px] text-body"
						data-testid="step-flag"
					>
						<TriangleAlert
							aria-hidden
							className="size-3.5 shrink-0 stroke-[1.75] text-danger"
						/>
						<span className="min-w-0 flex-1 text-text-1">
							This output contained an instruction aimed at the agent. The agent
							ignored it.
						</span>
						{onSeeFlag && (
							<Button
								size="sm"
								variant="text"
								onClick={onSeeFlag}
								data-testid="step-flag-details"
							>
								See details
							</Button>
						)}
					</div>
				)}
			</li>
		</Surface>
	);
}

/** A failure's reason as one line: the first line that says something, past the data note. */
export function failLine(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l && l !== HARNESS_DATA_NOTE && !/^[[{]/.test(l));
	if (!line) return null;
	return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}
