// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PreRunCoverage } from "@/components/run/PreRunCoverage";
import { viewName } from "@/components/run/run-labels";
import { deriveSteps } from "@/components/run/run-steps";
import { Hint } from "@/components/shared/Hint";
import { Button } from "@/components/ui/button";
import { ago, useNow } from "@/hooks/use-now";
import { answerWord } from "@/lib/answer-word";
import { citedFile } from "@/lib/evidence-files";
import { failureSentence } from "@/lib/failure-sentence";
import { failureWords } from "@/lib/failure-words";
import { formatClock } from "@/lib/format-time";
import { commandText } from "@/lib/report-view";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import { commandOf, noteOf } from "./fixes";
import { plain } from "./SituationCard";
import type { Overview } from "./use-overview";

const TAG_TONE = {
	Confirmed: "text-ok",
	Likely: "text-accent",
	Unconfirmed: "text-warn",
	"No cause found": "text-text-3",
} as const;

/**
 * Why (#811): the likely cause from the newest run that named one, its
 * evidence (each row opens the step that found it), what was ruled out or
 * not checked, and the lasting fix in place. A live run banners above it;
 * the finding stands until that run reports. Under it, what PrismaLens read
 * before that run (#848).
 */
export function WhyCard({
	o,
	onInvestigate,
}: {
	o: Overview;
	onInvestigate: () => void;
}) {
	const now = useNow(30_000);
	const { incident, runs } = o.record;
	const [lasting, setLasting] = useState(false);
	const report = o.report;
	const reported = o.reported;
	const latest = o.latest;
	const failedLatest =
		latest && o.latestRun.state === "failed" && latest.id !== reported?.id
			? latest
			: null;
	const tag = report ? answerWord(report).word : null;
	const transcriptRun = reported ?? failedLatest;
	const preRun =
		o.reportInvestigation?.preRun ?? o.latestRun.investigation?.preRun ?? null;
	const run = (id: string) => ({
		to: "/incidents/$id/conversation" as const,
		params: { id: incident.id },
		search: { investigation: id },
	});
	return (
		<Card
			title="Why"
			testId="why-card"
			sub={
				<>
					{tag && (
						<span
							className={cn("shrink-0 text-meta font-medium", TAG_TONE[tag])}
							data-testid="why-tag"
						>
							{tag === "No cause found" ? "No cause named" : tag}
						</span>
					)}
					{!tag && failedLatest && (
						<span
							className="shrink-0 text-meta font-medium text-danger"
							data-testid="why-tag"
						>
							No cause yet
						</span>
					)}
					{reported && (
						<span className="min-w-0 truncate text-meta text-text-3">
							From {viewName(runs, reported)},{" "}
							{ago(reported.completedAt ?? reported.createdAt, now)}
						</span>
					)}
				</>
			}
			actions={
				<>
					{runs.length > 0 && !o.live && (
						<Button
							variant="secondary"
							className="h-6 shrink-0 bg-surface-2 px-2 text-meta hover:bg-surface-3"
							onClick={onInvestigate}
							data-testid="why-investigate"
						>
							Investigate again
						</Button>
					)}
					{transcriptRun && (
						<Link
							{...run(transcriptRun.id)}
							className="shrink-0 text-meta text-accent hover:underline"
							data-testid="why-transcript"
						>
							{viewName(runs, transcriptRun)} transcript
						</Link>
					)}
				</>
			}
		>
			<div className="flex flex-col gap-2.5">
				{o.live && (
					<Link
						{...run(o.live.id)}
						className="flex min-w-0 items-center gap-2 rounded-control bg-live/10 px-2.5 py-1.5 whitespace-nowrap transition-colors duration-(--dur-instant) hover:bg-live/15"
						data-testid="why-live"
					>
						<span
							aria-hidden
							className="breathe size-1.5 shrink-0 rounded-full bg-live"
						/>
						<span className="min-w-0 flex-1 truncate">
							{viewName(runs, o.live)}{" "}
							{o.latestRun.awaiting || o.live.awaitingApprovalAt
								? "waits for your approval in the box below."
								: "is investigating."}
							{report
								? " This finding stands until it reports."
								: " Its finding lands here when it reports."}
						</span>
						<span className="shrink-0 text-meta text-accent">Watch</span>
					</Link>
				)}
				{failedLatest && (
					<FailedRun
						o={o}
						name={viewName(runs, failedLatest)}
						standing={!!report}
					/>
				)}
				{report ? (
					<Finding o={o} lasting={lasting} setLasting={setLasting} />
				) : !o.live && !failedLatest ? (
					<p className="text-text-3" data-testid="why-none">
						{runs.length === 0
							? "No run yet. A run reads the alert, the code and the telemetry, then names a likely cause."
							: "No run has reached a finding yet."}
					</p>
				) : null}
				{preRun && (
					<section
						aria-label="Read before the run"
						className="mt-1 rounded-surface bg-surface-2 px-3 py-3"
						data-testid="why-coverage"
					>
						<PreRunCoverage preRun={preRun} />
					</section>
				)}
			</div>
		</Card>
	);
}

function FailedRun({
	o,
	name,
	standing,
}: {
	o: Overview;
	name: string;
	standing: boolean;
}) {
	const inv = o.latestRun.investigation;
	const steps = useMemo(
		() =>
			deriveSteps(o.latestRun.events, {
				cwd: inv?.workspace?.cwd,
				ended: true,
			}),
		[o.latestRun.events, inv?.workspace?.cwd],
	);
	const error = inv?.error ?? o.latest?.error ?? null;
	const said = failureSentence("The agent", error);
	const words = failureWords(error);
	return (
		<>
			<div
				className="rounded-surface bg-danger/12 px-3 py-2.5"
				data-row
				data-testid="why-failed"
			>
				<div className="font-semibold text-danger">
					{name} stopped before a finding
					{standing ? "; the finding below stands" : ""}
				</div>
				<div className="text-text-1">
					{words.next ? `${words.what} ${words.next}` : said.said}
				</div>
			</div>
			{!standing && steps.length > 0 && (
				<>
					<span className="text-meta text-text-3">Its last steps</span>
					<ol className="flex flex-col">
						{steps.slice(-3).map((s) => (
							<li
								key={s.n}
								className="flex gap-2.5 px-1 py-1.5 shadow-[inset_0_-1px_0_var(--hairline)]"
								data-row
							>
								<span className="w-16 shrink-0 text-meta text-text-3 tabular-nums">
									{formatClock(s.at)}
								</span>
								<span className="min-w-0 truncate text-text-2">{s.title}</span>
							</li>
						))}
					</ol>
				</>
			)}
		</>
	);
}

function Finding({
	o,
	lasting,
	setLasting,
}: {
	o: Overview;
	lasting: boolean;
	setLasting: (v: boolean) => void;
}) {
	const report = o.report;
	const { incident } = o.record;
	if (!report || !o.reported) return null;
	const cwd = o.reportInvestigation?.workspace?.cwd;
	const top = report.hypotheses.find((h) => h.status !== "refuted");
	const evidence = top?.evidence ?? [];
	const ruled = report.ruledOut.length;
	const unchecked = report.coverage.notQueried.length;
	const fix = o.options.lasting;
	const runId = o.reported.id;
	return (
		<>
			<p
				className="line-clamp-3 text-[15px] leading-[22px]"
				dir="auto"
				data-testid="why-cause"
			>
				{plain(report.rootCause ?? report.summary)}
			</p>
			{evidence.length === 0 ? (
				<p className="text-text-3">No evidence recorded for this conclusion.</p>
			) : (
				<ul className="flex flex-col gap-1" data-testid="why-evidence">
					{evidence.map((e, i) => {
						const src = commandText(e.source, cwd);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: evidence rows have no id; their order is the report's.
							<li key={i} data-row>
								<Hint label={e.observation}>
									<Link
										to="/incidents/$id/conversation"
										params={{ id: incident.id }}
										search={{
											investigation: runId,
											...(e.toolCallId ? { call: e.toolCallId } : {}),
											...(citedFile(e.source, o.reportInvestigation?.workspace)
												? { file: e.source }
												: {}),
										}}
										className="flex min-w-0 items-baseline gap-2.5 rounded-control bg-surface-2 px-2.5 py-1.5 transition-colors duration-(--dur-instant) hover:bg-surface-3"
										data-testid="why-evidence-row"
									>
										<span className="w-[52px] shrink-0 text-meta text-text-3">
											{e.direction === "supports" ? "For" : "Against"}
										</span>
										<span className="line-clamp-2 min-w-0 flex-1" dir="auto">
											{plain(e.observation)}
										</span>
										<span className="max-w-[40%] shrink-0 truncate font-mono text-mono text-text-3">
											{src}
										</span>
									</Link>
								</Hint>
							</li>
						);
					})}
				</ul>
			)}
			{lasting && fix && (
				<div
					id="lasting-fix"
					className="rounded-control bg-surface-2 px-2.5 py-2"
					data-row
					data-testid="why-lasting"
				>
					<p className="font-medium" dir="auto">
						{fix.title}
					</p>
					<p className="text-text-2" dir="auto">
						{plain(fix.detail)}
					</p>
					{commandOf(fix) ? (
						<code className="mt-1 block font-mono text-mono break-all whitespace-pre-wrap text-text-1">
							{commandOf(fix)}
						</code>
					) : (
						noteOf(fix) && (
							<p className="text-text-2" dir="auto">
								{noteOf(fix)}
							</p>
						)
					)}
				</div>
			)}
			<div className="flex gap-4.5 text-meta whitespace-nowrap">
				<Link
					to="/incidents/$id/conversation"
					params={{ id: incident.id }}
					search={{ investigation: runId }}
					className="text-text-2 hover:underline"
					data-testid="why-ruled-out"
				>
					{ruled === 0 ? "Nothing ruled out" : `${ruled} ruled out`}
				</Link>
				{unchecked > 0 && (
					<Link
						to="/incidents/$id/conversation"
						params={{ id: incident.id }}
						search={{ investigation: runId }}
						className="text-warn hover:underline"
						data-testid="why-unchecked"
					>
						{unchecked} not checked
					</Link>
				)}
				<span className="flex-1" />
				{fix && (
					<button
						type="button"
						aria-expanded={lasting}
						aria-controls="lasting-fix"
						onClick={() => {
							setLasting(!lasting);
							window.setTimeout(
								() =>
									document
										.getElementById("lasting-fix")
										?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
								50,
							);
						}}
						className="text-accent hover:underline"
						data-testid="why-lasting-toggle"
					>
						Lasting fix
					</button>
				)}
			</div>
		</>
	);
}
