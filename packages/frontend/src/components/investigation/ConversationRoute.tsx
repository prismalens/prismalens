// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { useSearch } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useTelemetryNames } from "@/components/incidents/IncidentFacts";
import { RECORD_GRID, RecordLink } from "@/components/incidents/RecordLayout";
import type { RunRef } from "@/components/incidents/record-context";
import { useIncidentRecord } from "@/components/incidents/record-context";
import {
	newerRunOf,
	runNumber,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { Loading, Problem } from "@/components/shared/State";
import { useNow } from "@/hooks/use-now";
import { useInvestigation } from "@/lib/api/hooks/use-investigations-orpc";
import { gatherLine } from "@/lib/gather-line";
import { deriveTranscript, pinnedTo } from "@/lib/investigation-events";
import { recheckBrief } from "@/lib/run-verb";
import { cn } from "@/lib/utils";
import type { ComposerSend } from "./ComposerBox";
import { DockedComposer } from "./DockedComposer";
import { Transcript } from "./Transcript";

/** The only branch that exists until fan-out lands (#280). */
const MAIN_BRANCH = "run";

/** Distinct branches in first-seen order; the report's sentinel is not one. */
function branchesOf(events: { kind: string; branchId?: string }[]): string[] {
	const seen: string[] = [];
	for (const e of events) {
		if (e.kind === "report" || !e.branchId) continue;
		if (!seen.includes(e.branchId)) seen.push(e.branchId);
	}
	return seen;
}

/** The Conversation tab (#673): the selected run's transcript in the one column, the box under it. */
export function ConversationRoute() {
	const record = useIncidentRecord();
	const { incident, run, draft } = record;
	const now = useNow(1000);
	const search = useSearch({
		from: "/_authenticated/incidents/$id/conversation",
	});
	const [branch, setBranch] = useState<string | null>(null);
	const investigation = run.investigation;
	const live = !!run.state && isRunStateLive(run.state);

	const branches = useMemo(() => branchesOf(run.events), [run.events]);
	const openBranch =
		branches.length > 1 ? (branch ?? branches[0] ?? MAIN_BRANCH) : null;
	const events = useMemo(
		() =>
			openBranch
				? run.events.filter(
						(e) => e.kind === "report" || e.branchId === openBranch,
					)
				: run.events,
		[run.events, openBranch],
	);
	const items = useMemo(
		() =>
			deriveTranscript(events, now ?? Date.now(), {
				pending: run.pending,
				run: investigation
					? {
							id: investigation.id,
							status: investigation.status,
							live,
							stopRequested: run.stopRequested,
							error: investigation.error,
							startedAt: investigation.startedAt,
							completedAt: investigation.completedAt,
							kind: investigation.kind,
							hasReport: !!investigation.report,
							continuable: run.continuable,
							lastTurnOutcome: investigation.lastTurnOutcome,
						}
					: undefined,
			}),
		[
			events,
			now,
			run.pending,
			run.stopRequested,
			run.continuable,
			investigation,
			live,
		],
	);
	// `Investigate again`: + New run with what is in the box, then the report quoted (#673 w59, OBJ-013).
	const box = useRef<ComposerSend | null>(null);
	const report = investigation?.report;
	const onRecheck =
		investigation && report
			? () =>
					record.newRun({
						verb: "investigate",
						text: recheckBrief(
							report,
							runNumber(record.runs, investigation.id),
							box.current?.text ?? "",
						),
						files: box.current?.files ?? [],
					})
			: undefined;
	const who = useRunAgentModel(investigation);
	const telemetry = useTelemetryNames(incident.service?.id);
	// Only once the run has started: before that nothing has been gathered.
	const lead =
		investigation && run.events.length > 0
			? gatherLine({
					chat: investigation.kind === "chat",
					alerts: incident.alertCount,
					code: pinnedTo(investigation.workspace),
					telemetry: telemetry ?? [],
					agent: who.agent,
				})
			: undefined;

	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col",
				// A draft's box sits centred in the column; the first send docks it (#673 w59).
				draft && "justify-center pb-[12vh]",
			)}
			data-testid="conversation-route"
			data-draft={draft ? "" : undefined}
		>
			{openBranch && (
				<div
					role="tablist"
					aria-label="Branches"
					className={cn(RECORD_GRID, "flex shrink-0 gap-3")}
					data-testid="branch-tabs"
				>
					{branches.map((b) => (
						<button
							key={b}
							type="button"
							role="tab"
							aria-selected={b === openBranch}
							onClick={() => setBranch(b)}
							className={cn(
								"py-1.5 text-meta underline-offset-[9px]",
								b === openBranch
									? "font-medium text-text-1 underline decoration-accent decoration-2"
									: "text-text-2 hover:text-text-1",
							)}
						>
							{b === MAIN_BRANCH ? "Main" : b}
						</button>
					))}
				</div>
			)}
			<div className={draft ? "shrink-0" : "min-h-0 flex-1"}>
				{draft ? (
					<DraftHeading />
				) : run.isLoading ? (
					<div className={cn(RECORD_GRID, "pt-4")}>
						<Loading rows={5} />
					</div>
				) : run.error || !investigation ? (
					<div className={cn(RECORD_GRID, "pt-4")}>
						<Problem text="This run did not load." />
					</div>
				) : (
					<Transcript
						items={items}
						incidentId={incident.id}
						runId={investigation.id}
						focus={search.call}
						cwd={investigation.workspace?.cwd}
						agent={who.agent}
						lead={lead}
						onRecheck={onRecheck}
					/>
				)}
			</div>
			{!draft && investigation && (
				<NewerRunLine
					incidentId={incident.id}
					runs={record.runs}
					selected={investigation.id}
				/>
			)}
			<div
				className={cn(
					RECORD_GRID,
					"transition-transform duration-(--dur-base) motion-reduce:transition-none",
				)}
				data-testid="composer-dock"
			>
				{/* Not while the run loads: the key turns from "none" to its id and the remount drops typed text (#807). */}
				{(draft || !run.isLoading) && (
					<DockedComposer
						key={draft ? "draft" : (investigation?.id ?? "none")}
						branchId={openBranch ?? undefined}
						boxRef={box}
						onRecheck={onRecheck}
					/>
				)}
			</div>
		</div>
	);
}

/**
 * On an older run, the newer one and the code it looked at (#673 w27): this
 * run keeps reasoning at its own pinned commit (ADR 0004 §2).
 */
export function NewerRunLine({
	incidentId,
	runs,
	selected,
}: {
	incidentId: string;
	runs: RunRef[];
	selected: string;
}) {
	const newer = newerRunOf(runs, selected);
	const { data } = useInvestigation(newer?.id ?? "");
	const at = pinnedTo(data?.workspace);
	if (!newer) return null;
	const n = runNumber(runs, newer.id);
	return (
		<p
			className={cn(RECORD_GRID, "pb-1.5 text-meta text-text-2")}
			data-testid="newer-run-line"
		>
			A newer run (
			<RecordLink
				incidentId={incidentId}
				to="conversation"
				search={{ investigation: newer.id }}
			>
				Run #{n}
			</RecordLink>
			) {at ? `looks at ${at}` : "exists"}
		</p>
	);
}

/**
 * A draft's head, centred in the column above the box (#673 w59); the facts
 * it starts with read once, as the transcript's first gather line.
 */
function DraftHeading() {
	return (
		<div className={cn(RECORD_GRID, "pb-3")} data-testid="draft-heading">
			<h2 className="text-title">New run</h2>
		</div>
	);
}
