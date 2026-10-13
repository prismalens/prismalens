// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { Copy, TriangleAlert } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ago, useNow } from "@/hooks/use-now";
import { formatClock } from "@/lib/format-time";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { commandOf, type FixOption, type FixStage, noteOf } from "./fixes";
import type { Overview } from "./use-overview";
import { beforeAlert, changeName } from "./what-changed";

const STATE: Record<
	| FixStage["stage"]
	| "checked-not_yet"
	| "checked-below_threshold"
	| "checked-could_not_check"
	| "checked-it_worked",
	{ text: string; tone: string }
> = {
	ready: { text: "Not applied", tone: "text-text-3" },
	applied: { text: "You applied this", tone: "text-text-2" },
	checking: { text: "Checking", tone: "text-live" },
	checked: { text: "", tone: "" },
	"checked-not_yet": { text: "Not working yet", tone: "text-warn" },
	"checked-below_threshold": {
		text: "Below the threshold",
		tone: "text-text-2",
	},
	"checked-could_not_check": { text: "Could not check", tone: "text-warn" },
	"checked-it_worked": { text: "Worked", tone: "text-ok" },
	worked: { text: "Worked", tone: "text-ok" },
};

function stateWord(stage: FixStage) {
	return stage.stage === "checked"
		? STATE[`checked-${stage.check.verdict}`]
		: STATE[stage.stage];
}

/**
 * Stop the impact (#811): the top option with its facts and the whole
 * command (never clipped; it wraps), then the latest question you asked,
 * then the other options. Copy only; nothing here runs a command.
 */
export function StopImpactCard({
	o,
	commandRef,
}: {
	o: Overview;
	commandRef: RefObject<HTMLElement | null>;
}) {
	const { incident } = o.record;
	const opt = o.current;
	const flagged = o.flagged;
	const sub = o.report
		? opt
			? "Undo what hurts users; fix the cause after."
			: null
		: null;
	return (
		<Card
			title="Stop the impact"
			id="stop-the-impact"
			sub={
				sub && (
					<span className="min-w-0 truncate text-meta text-text-3">{sub}</span>
				)
			}
			testId="stop-impact-card"
		>
			<div className="flex flex-col gap-2">
				{opt && o.stage ? (
					<FixCard
						o={o}
						option={opt}
						stage={o.stage}
						flagged={flagged}
						commandRef={commandRef}
					/>
				) : o.report ? (
					<p className="py-2 text-text-2" data-testid="fix-empty">
						The agent found nothing to undo or switch off right away. The cause
						and the lasting fix are under Why.
					</p>
				) : (
					<div className="flex flex-col gap-1.5 py-2" data-testid="fix-none">
						<p className="text-text-2">
							No options yet. No run has reached a finding.
						</p>
						{o.changes?.deploy && (
							<p className="text-text-3">
								{changeName(o.changes.deploy)} shipped{" "}
								{beforeAlert(
									o.changes.deploy.at,
									incident.createdAt,
									(incident.alerts ?? []).length > 0,
								)}
								.
							</p>
						)}
					</div>
				)}
				<YouAsked o={o} />
				{o.others.map((x) => (
					<button
						key={x.id ?? x.title}
						type="button"
						onClick={() => o.pickOption(x)}
						className="flex min-w-0 flex-col rounded-surface bg-surface-2 px-3 py-2 text-left transition-colors duration-(--dur-instant) hover:bg-surface-3"
						data-row
						data-testid="fix-other"
					>
						<span className="truncate" dir="auto">
							{x.title}
						</span>
						<span className="truncate text-meta text-text-3" dir="auto">
							{otherLine(o, x)}
						</span>
					</button>
				))}
			</div>
		</Card>
	);
}

function otherLine(o: Overview, x: FixOption): string {
	const s = o.stageOf(x);
	if (s.stage !== "ready")
		return `Applied at ${formatClock(s.appliedAt)}. ${stateWord(s).text}.`;
	return x.facts[0] ?? x.detail;
}

function FixCard({
	o,
	option,
	stage,
	flagged,
	commandRef,
}: {
	o: Overview;
	option: FixOption;
	stage: FixStage;
	flagged: boolean;
	commandRef: RefObject<HTMLElement | null>;
}) {
	const [flash, setFlash] = useState(false);
	useEffect(() => {
		if (!flash) return;
		const t = window.setTimeout(() => setFlash(false), 1500);
		return () => window.clearTimeout(t);
	}, [flash]);
	const word = stateWord(stage);
	// Undo stands until a check runs (spec): after that the timeline holds a verdict about it.
	const canUndo = option.canUndo && stage.stage === "applied";
	const command = commandOf(option);
	const note = noteOf(option);
	return (
		<div
			className="flex flex-col gap-2 rounded-surface bg-surface-2 p-3"
			data-row
			data-testid="fix-card"
			data-stage={stage.stage}
		>
			<div className="flex min-w-0 items-baseline gap-2.5">
				<span
					className="min-w-0 flex-1 text-title"
					dir="auto"
					data-testid="fix-title"
				>
					{option.title}
				</span>
				<span
					className={cn("shrink-0 text-meta font-medium", word.tone)}
					data-testid="fix-state"
				>
					{word.text}
				</span>
				{canUndo && (
					<Button
						variant="secondary"
						className="h-[22px] shrink-0 rounded-[4px] bg-surface-3 px-2 text-meta hover:bg-surface-4"
						onClick={() => o.undo(option)}
						disabled={o.busy}
						data-testid="fix-undo"
					>
						Undo
					</Button>
				)}
			</div>
			{command ? (
				<div className="flex min-w-0 items-start gap-1.5">
					<code
						ref={commandRef}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: a blocked clipboard selects it, and Ctrl+C needs focus.
						tabIndex={0}
						className="min-w-0 flex-1 rounded-control bg-canvas px-2.5 py-2 font-mono text-mono break-all whitespace-pre-wrap text-text-1 select-all"
						data-testid="fix-command"
					>
						{command}
					</code>
					<Button
						variant="secondary"
						className="h-8 shrink-0 gap-1.5 bg-surface-3 hover:bg-surface-4"
						aria-label="Copy command"
						onClick={async () => {
							if (await o.copy(option, commandRef.current)) setFlash(true);
						}}
						data-testid="fix-copy"
					>
						<Copy className="size-3.5" aria-hidden />
						<span aria-live="polite">{flash ? "Copied" : "Copy"}</span>
					</Button>
				</div>
			) : (
				<>
					<p className="text-text-2" dir="auto">
						{option.detail}
					</p>
					{note && note !== option.detail && (
						<p className="text-text-2" dir="auto" data-testid="fix-note">
							{note}
						</p>
					)}
				</>
			)}
			{option.facts.length > 0 && (
				<ul className="list-disc pl-4 text-text-2" data-testid="fix-facts">
					{option.facts.map((f) => (
						<li key={f} dir="auto">
							{f}
						</li>
					))}
				</ul>
			)}
			{flagged && command && (
				<p
					className="flex gap-1.5 text-meta text-warn"
					data-testid="fix-flagged"
				>
					<TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
					The agent flagged text that tried to instruct it while it worked. Read
					this command before you run it.
				</p>
			)}
			{option.readOnly && (
				<p className="text-meta text-text-3">
					From a report written before fixes could be marked applied.
				</p>
			)}
		</div>
	);
}

/** The latest Ask and its answer; earlier ones link to the newest of them. */
function YouAsked({ o }: { o: Overview }) {
	const now = useNow(30_000);
	const { incident } = o.record;
	const ask = o.ask;
	if (!ask) return null;
	const state = o.askRun.state;
	const answering = state === "starting" || state === "working";
	const answer = o.askRun.latestText;
	const earlier = o.earlierAsks[0];
	return (
		<div
			className="flex flex-col gap-0.5 rounded-surface bg-surface-2 px-3 py-2"
			data-row
			data-testid="you-asked"
		>
			<span className="text-meta text-text-3">
				You asked {ago(ask.startedAt ?? ask.createdAt, now)}
			</span>
			<Link
				to="/incidents/$id/conversation"
				params={{ id: incident.id }}
				search={{ investigation: ask.id }}
				className="font-medium hover:text-accent"
				dir="auto"
				data-testid="you-asked-question"
			>
				{ask.title ?? "Your question"}
			</Link>
			{answering ? (
				<span className="flex items-center gap-2 text-text-2">
					<span aria-hidden className="breathe size-1.5 rounded-full bg-live" />
					Answering.
					<Link
						to="/incidents/$id/conversation"
						params={{ id: incident.id }}
						search={{ investigation: ask.id }}
						className="text-accent hover:underline"
					>
						Open the conversation
					</Link>
				</span>
			) : state === "failed" ? (
				<span className="text-danger">The answer did not finish.</span>
			) : answer ? (
				<span dir="auto" className="text-text-1">
					{answer}
				</span>
			) : null}
			{earlier && (
				<Link
					to="/incidents/$id/conversation"
					params={{ id: incident.id }}
					search={{ investigation: earlier.id }}
					className="truncate text-meta text-accent underline underline-offset-2"
					data-testid="you-asked-earlier"
				>
					{o.earlierAsks.length === 1
						? `1 earlier question${earlier.title ? `: ${earlier.title}` : ""}`
						: `${o.earlierAsks.length} earlier questions`}
				</Link>
			)}
		</div>
	);
}
