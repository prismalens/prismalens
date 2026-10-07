// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTelemetryNames } from "@/components/incidents/IncidentFacts";
import { RECORD_GRID } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { useRunAgentModel } from "@/components/incidents/run-facts";
import { Loading, Problem } from "@/components/shared/State";
import { useNow } from "@/hooks/use-now";
import { deriveTranscript } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
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
						}
					: undefined,
			}),
		[events, now, run.pending, run.stopRequested, investigation, live],
	);
	const who = useRunAgentModel(investigation);

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="conversation-route"
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
			<div className="min-h-0 flex-1">
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
						focus={search.call}
						cwd={investigation.workspace?.cwd}
						agent={who.agent}
					/>
				)}
			</div>
			<div className={RECORD_GRID}>
				<DockedComposer
					key={draft ? "draft" : (investigation?.id ?? "none")}
					branchId={openBranch ?? undefined}
				/>
			</div>
		</div>
	);
}

/** A draft's head: what the run starts with, the facts its gather line will carry. */
function DraftHeading() {
	const { incident } = useIncidentRecord();
	const telemetry = useTelemetryNames(incident.service?.id);
	const service = incident.service?.displayName || incident.service?.name;
	const n = incident.alertCount;
	const parts = [
		`${n === 0 ? "no alerts" : n === 1 ? "1 alert" : `${n} alerts`}`,
		service ? `${service}'s code` : "no repository",
		...(telemetry ?? []),
	];
	return (
		<div className={cn(RECORD_GRID, "pt-3")} data-testid="draft-heading">
			<h2 className="text-title">New run</h2>
			<p className="mt-0.5 text-body text-text-2">
				Starts with {parts.join(", ")}
			</p>
		</div>
	);
}
