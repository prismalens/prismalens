// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { isRunStateLive } from "@prismalens/contracts";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { Mono } from "@/components/shared/Mono";
import { Segmented } from "@/components/shared/Segmented";
import { StateChip, StateWord } from "@/components/shared/StateChip";
import { Progress } from "@/components/ui/progress";
import { useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { composerMode } from "@/lib/composer-keys";
import { getErrorMessage } from "@/lib/get-error-message";
import { deriveTranscript } from "@/lib/investigation-events";
import { cn } from "@/lib/utils";
import { ComposerBox } from "./ComposerBox";
import { InvestigationDetailSkeleton } from "./InvestigationDetailSkeleton";
import { InvestigationStreamPanel } from "./InvestigationStreamPanel";
import { SummaryPanel } from "./SummaryPanel";
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
 * The conversation route (#743 §3c, layer 2): the transcript with the box
 * docked under it, and the Summary | Report | Timeline panel beside it.
 * The Ledger view is the row-per-event panel that existed before.
 */
export function ConversationRoute() {
	const record = useIncidentRecord();
	const { incident, run, investigationId } = record;
	const { toast } = useToast();
	const now = useNow(1000);
	const [view, setView] = useState<"transcript" | "ledger">("transcript");
	const [phoneTab, setPhoneTab] = useState<"conversation" | "summary">(
		"conversation",
	);
	const [branch, setBranch] = useState<string | null>(null);
	const who = useRunAgentModel(run.investigation);
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
		openBranch && openBranch !== MAIN_BRANCH
			? `Branch ${openBranch}`
			: "Main agent";
	const mode = composerMode(investigationId ? { live } : null);

	const box = (
		<div className="shrink-0 border-t bg-background px-3 py-2">
			<ComposerBox
				docked
				mode={mode}
				target={
					addressee === "Main agent"
						? "the main agent"
						: addressee.toLowerCase()
				}
				fixed={who}
				waiting={run.waiting}
				isPending={record.isInvestigating}
				blockedReason={
					!record.canInvestigate && mode !== "live"
						? "Only an open incident can be investigated."
						: record.investigateBlocked
				}
				onInvestigate={(brief) => record.investigate(brief || undefined)}
				onMessage={(text, send) =>
					run.sendMessage(text, send, {
						branchId: openBranch ?? undefined,
						onError: (error) =>
							toast({
								title: "Message not sent",
								description: getErrorMessage(error),
								variant: "destructive",
							}),
					})
				}
				undeliverable={run.undeliverable}
				onSaveAsNote={(text) => record.addNote(text, run.clearUndeliverable)}
			/>
		</div>
	);

	return (
		<div
			className="flex h-full min-h-0 flex-col"
			data-testid="conversation-route"
		>
			<div className="flex h-10 shrink-0 items-center border-b px-3 lg:hidden">
				<Segmented
					label="Phone view"
					value={phoneTab}
					onChange={setPhoneTab}
					options={[
						{ value: "conversation", label: "Conversation" },
						{ value: "summary", label: "Summary" },
					]}
				/>
			</div>
			<div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
				<section
					className={cn(
						"flex min-h-0 min-w-0 flex-col",
						phoneTab === "summary" && "hidden lg:flex",
					)}
				>
					<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
						<h2 className="text-record font-medium">Conversation</h2>
						<StateWord
							tone={live ? "active" : "neutral"}
							data-testid="conversation-addressee"
						>
							{addressee}
						</StateWord>
						<Segmented
							label="View"
							value={view}
							onChange={setView}
							options={[
								{ value: "transcript", label: "Transcript" },
								{ value: "ledger", label: "Ledger" },
							]}
							className="ml-auto"
							testId="conversation-view"
						/>
					</div>
					{openBranch && (
						<div
							role="tablist"
							aria-label="Branches"
							className="flex shrink-0 gap-3 border-b px-3"
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
											? "border-primary text-foreground"
											: "border-transparent text-muted-foreground hover:text-foreground",
									)}
								>
									{b === MAIN_BRANCH ? "Main" : b}
								</button>
							))}
						</div>
					)}
					{!investigationId ? (
						<p className="flex-1 p-6 text-center text-record text-muted-foreground">
							No run yet. Start one below.
						</p>
					) : run.isLoading ? (
						<div className="flex-1 p-4">
							<InvestigationDetailSkeleton />
						</div>
					) : run.error || !investigation ? (
						<div className="flex flex-1 flex-col items-center justify-center py-8">
							<AlertCircle className="mb-3 h-8 w-8 text-run-failed" />
							<p className="text-record font-medium text-run-failed">
								Failed to load the run
							</p>
							<p className="text-meta text-muted-foreground">
								{run.error?.message || "Investigation not found"}
							</p>
						</div>
					) : view === "transcript" ? (
						<Transcript items={items} incidentId={incident.id} />
					) : (
						<LedgerView events={events} />
					)}
					{box}
				</section>
				<SummaryPanel
					className={cn(
						"min-h-0 flex-col border-l bg-muted/20",
						phoneTab === "summary" ? "flex" : "hidden lg:flex",
					)}
				/>
			</div>
		</div>
	);
}

/** Today's row-per-event ledger, with the failed and polling panels it carried. */
function LedgerView({
	events,
}: {
	events: ReturnType<typeof useIncidentRecord>["run"]["events"];
}) {
	const { run } = useIncidentRecord();
	const investigation = run.investigation;
	if (!investigation) return null;
	return (
		<div
			className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
			data-testid="investigation-panel"
		>
			{run.failed && (
				<div
					className="rounded-md border border-run-failed/40 bg-run-failed/8 p-3"
					data-testid="investigation-failed-state"
				>
					<div className="flex items-center gap-2">
						<StateChip tone="failed">failed</StateChip>
						<span className="text-record font-medium">
							Investigation failed
						</span>
					</div>
					<p className="mt-2 whitespace-pre-wrap font-mono text-meta">
						{investigation.error ?? "No error was recorded."}
					</p>
					<p className="mt-2 text-meta text-muted-foreground">
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
						<div className="flex items-center gap-2 text-record font-medium">
							Investigation progress
							<StateChip tone="stale" data-testid="stream-fallback-badge">
								polling
							</StateChip>
						</div>
						<Mono className="text-meta text-muted-foreground">
							{run.jobProgress}%
						</Mono>
					</div>
					<Progress value={run.jobProgress} className="mt-2 h-1.5" />
					<div className="mt-2 flex items-center justify-between text-meta text-muted-foreground">
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
