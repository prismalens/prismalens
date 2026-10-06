// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccessFact } from "@/components/incidents/IncidentFacts";
import {
	type Fact,
	FactsRail,
	RECORD_GRID,
	RecordLink,
} from "@/components/incidents/RecordLayout";
import { runElapsed, useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { Mono } from "@/components/shared/Mono";
import { StateWord } from "@/components/shared/StateWord";
import { Progress } from "@/components/ui/progress";
import { useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { deriveTranscript, pinnedTo } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { DockedComposer } from "./DockedComposer";
import { InvestigationDetailSkeleton } from "./InvestigationDetailSkeleton";
import { InvestigationStreamPanel } from "./InvestigationStreamPanel";
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

/**
 * The Conversation tab (#743, study-v3 §3.4): the transcript in the reading
 * column with its facts rail, the box docked under it. `?ledger=1` is the
 * Event log, reached from the end line and the rail, never a header toggle.
 */
export function ConversationRoute() {
	const record = useIncidentRecord();
	const { incident, run, investigationId } = record;
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

	const addressee =
		openBranch && openBranch !== MAIN_BRANCH ? `branch ${openBranch}` : null;
	const who = useRunAgentModel(investigation);
	const access = useAccessFact();
	const rail = investigation ? (
		<FactsRail facts={conversationFacts(run, who, access, incident.id)} />
	) : undefined;

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="conversation-route"
		>
			{openBranch && (
				<div
					role="tablist"
					aria-label="Branches"
					className="flex shrink-0 gap-3 px-4 sm:px-6"
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
								"-mb-px border-b-2 py-1.5 text-meta",
								b === openBranch
									? "border-accent text-text-1"
									: "border-transparent text-text-2 hover:text-text-1",
							)}
						>
							{b === MAIN_BRANCH ? "Main" : b}
						</button>
					))}
				</div>
			)}
			<div className="min-h-0 flex-1">
				{!investigationId ? (
					<p className="p-6 text-center text-body text-text-2">
						No investigation yet. Brief the agent below and start one.
					</p>
				) : run.isLoading ? (
					<div className="p-4">
						<InvestigationDetailSkeleton />
					</div>
				) : run.error || !investigation ? (
					<div className="flex flex-col items-center justify-center py-8">
						<AlertCircle className="mb-3 h-8 w-8 text-danger" />
						<p className="text-body font-medium text-danger">
							Failed to load the run
						</p>
						<p className="text-meta text-text-2">
							{run.error?.message || "Investigation not found"}
						</p>
					</div>
				) : search.ledger ? (
					<LedgerView events={events} incidentId={incident.id} />
				) : (
					<Transcript
						items={items}
						incidentId={incident.id}
						focus={search.call}
						cwd={investigation.workspace?.cwd}
						agent={who.agent}
						rail={rail}
					/>
				)}
			</div>
			<div className="shrink-0 pt-1 pb-3">
				<div className={RECORD_GRID}>
					<div className="min-w-0">
						<DockedComposer
							className="px-0 pt-0 pb-0 sm:px-0"
							branchId={openBranch ?? undefined}
							{...(addressee ? { target: addressee } : {})}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

/** What the run has done so far, from its tool results: `3 commands, 2 files read, 1 refused`. */
export function soFar(
	events: {
		kind: string;
		result?: { ok: boolean; toolCategory?: string | null };
	}[],
): string {
	let files = 0;
	let commands = 0;
	let refused = 0;
	for (const e of events) {
		if (e.kind !== "tool_result" || !e.result) continue;
		if (!e.result.ok) refused++;
		else if (e.result.toolCategory === "file") files++;
		else commands++;
	}
	const parts = [
		commands ? `${commands} command${commands === 1 ? "" : "s"}` : null,
		files ? `${files} file${files === 1 ? "" : "s"} read` : null,
		refused ? `${refused} refused` : null,
	].filter(Boolean);
	return parts.length ? parts.join(", ") : "Nothing yet";
}

/** The Conversation's rail (study-v3 §3.3): Agent, Access, So far, Code, and when it stopped. */
function conversationFacts(
	run: ReturnType<typeof useIncidentRecord>["run"],
	who: { agent: string; model: string },
	access: string,
	incidentId: string,
): Fact[] {
	const inv = run.investigation;
	const pinned = pinnedTo(inv?.workspace);
	const repos = inv?.workspace?.repos ?? [];
	const facts: Fact[] = [
		{ label: "Agent", value: `${who.agent}, ${who.model}` },
		{ label: "Access", value: access, testId: "fact-access" },
		{ label: "So far", value: soFar(run.events), testId: "fact-so-far" },
		{
			label: "Code",
			value: pinned
				? repos.length === 1
					? `${pinned}, as repo/`
					: pinned
				: "No repository",
		},
	];
	if (run.state === "stopped" && inv?.completedAt)
		facts.push({
			label: "Stopped",
			value: `${formatClock(inv.completedAt)}${inv.startedAt ? `, after ${formatElapsed(runElapsed(inv, null))}` : ""}`,
		});
	facts.push({
		label: "Links",
		value: (
			<RecordLink
				incidentId={incidentId}
				to="conversation"
				search={{ ledger: "1" }}
			>
				Event log
			</RecordLink>
		),
	});
	return facts;
}

/** Today's row-per-event ledger, with the failed and polling panels it carried. */
function LedgerView({
	events,
	incidentId,
}: {
	events: ReturnType<typeof useIncidentRecord>["run"]["events"];
	incidentId: string;
}) {
	const { run } = useIncidentRecord();
	const navigate = useNavigate({ from: "/incidents/$id/conversation" });
	const investigation = run.investigation;
	if (!investigation) return null;
	return (
		<div
			className="h-full min-h-0 space-y-3 overflow-y-auto p-3"
			data-testid="investigation-panel"
		>
			<div className="flex items-center gap-3 px-1">
				<h2 className="text-heading">Event log</h2>
				<button
					type="button"
					className="text-meta text-accent hover:underline"
					onClick={() =>
						navigate({
							params: { id: incidentId },
							search: (prev) => ({ ...prev, ledger: undefined }),
							replace: true,
						})
					}
					data-testid="event-log-back"
				>
					Back to the conversation
				</button>
			</div>
			{run.failed && (
				<div
					className="rounded-md border border-danger/40 bg-danger/8 p-3"
					data-testid="investigation-failed-state"
				>
					<div className="flex items-center gap-2">
						<StateWord tone="failed">failed</StateWord>
						<span className="text-body font-medium">Investigation failed</span>
					</div>
					<p className="mt-2 whitespace-pre-wrap font-mono text-meta">
						{investigation.error ?? "No error was recorded."}
					</p>
					<p className="mt-2 text-meta text-text-2">
						The last events the harness sent are in the ledger below. The raw
						wire transcript is at{" "}
						<Mono>runs/{investigation.id}/transcript.jsonl</Mono> under the
						workspace directory that pl up printed at start.
					</p>
				</div>
			)}
			{run.streamFailed ? (
				<div
					className="rounded-md border p-3"
					data-testid="investigation-fallback-panel"
				>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2 text-body font-medium">
							Investigation progress
							<StateWord tone="stale" data-testid="stream-fallback-badge">
								polling
							</StateWord>
						</div>
						<Mono className="text-meta text-text-2">{run.jobProgress}%</Mono>
					</div>
					<Progress value={run.jobProgress} className="mt-2 h-1.5" />
					<div className="mt-2 flex items-center justify-between text-meta text-text-2">
						<p data-testid="stream-fallback-message">
							Live stream unavailable, polling for progress
						</p>
						{run.jobState && <Mono>job {run.jobState}</Mono>}
					</div>
				</div>
			) : (
				<InvestigationStreamPanel
					key={investigation.id}
					events={events}
					latestText={run.isActive ? run.latestText : null}
					status={run.ledgerStatus}
				/>
			)}
		</div>
	);
}
