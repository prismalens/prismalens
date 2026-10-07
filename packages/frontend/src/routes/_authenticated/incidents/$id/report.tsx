/**
 * The Report tab (#673, report-is-a-hero-surface): the run's header, the
 * answer, a summary pool and the sections on pools; Markdown is only the
 * export. A run with no report says so and names the runs that have one.
 */
import {
	type InvestigationReport,
	type InvestigationWithRelations,
	isAlertFiring,
} from "@prismalens/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { modelName, useAgentChoice } from "@/components/agent/AgentPicker";
import { useRanWithoutRepo } from "@/components/incidents/IncidentFacts";
import { RecordLink, RecordPage } from "@/components/incidents/RecordLayout";
import { useIncidentRecord } from "@/components/incidents/record-context";
import {
	modelSource,
	runElapsed,
	runName,
	runNumber,
	useRunAgentModel,
} from "@/components/incidents/run-facts";
import { DoNow, useDoNow } from "@/components/investigation/DoNow";
import { ExportReportButton } from "@/components/investigation/ExportReportButton";
import { PostToGitHubButton } from "@/components/investigation/PostToGitHubButton";
import {
	Answer,
	Gaps,
	Grounded,
	Integrity,
	RuledOut,
	Similar,
	SummaryPool,
	Why,
} from "@/components/investigation/ReportSections";
import { StateWord } from "@/components/shared/StateWord";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ago, useNow } from "@/hooks/use-now";
import { useToast } from "@/hooks/use-toast";
import { failureSentence } from "@/lib/failure-sentence";
import { formatClock, formatElapsed } from "@/lib/format-time";
import { fixBrief } from "@/lib/report-view";

export const Route = createFileRoute("/_authenticated/incidents/$id/report")({
	component: ReportRoute,
});

function ReportRoute() {
	const { run } = useIncidentRecord();
	const inv = run.investigation;
	const report = inv?.report ?? null;
	if (run.state === "done" && inv && report)
		return <ReportPage investigation={inv} report={report} />;
	return <NoReportPage />;
}

/** `Run #N` with its kind, who ran it and when, and the share actions. */
function ReportHeader({
	investigation,
	report,
	brief,
}: {
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
	brief: string;
}) {
	const { runs } = useIncidentRecord();
	const { harnesses } = useAgentChoice();
	const { toast } = useToast();
	const now = useNow();
	const who = useRunAgentModel(investigation);
	const harness = harnesses.find((h) => h.id === investigation.harness);
	const version = report.fidelity?.harnessVersion;
	const source = modelSource(
		investigation,
		(id) => modelName(harness, id) ?? id,
	).replace(/^model /, "");
	return (
		<header className="pt-1 pb-4" data-testid="report-header">
			<div className="flex items-center gap-3">
				<h2 className="text-title">Run #{runNumber(runs, investigation.id)}</h2>
				<span className="rounded-[4px] bg-surface-3 px-1.5 text-[11px] leading-4 font-medium text-text-2">
					{investigation.kind === "chat" ? "Chat" : "Investigation"}
				</span>
				<div className="ml-auto flex items-center gap-1">
					<ExportReportButton
						investigationId={investigation.id}
						label="Export"
					/>
					{investigation.status === "completed" && (
						<PostToGitHubButton investigationId={investigation.id} />
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="text"
								size="icon"
								aria-label="More report actions"
								data-testid="report-more"
							>
								<MoreHorizontal className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-[220px]">
							<DropdownMenuItem
								onClick={() =>
									navigator.clipboard.writeText(brief).then(
										() =>
											toast({ title: "Fix brief copied", variant: "neutral" }),
										() =>
											toast({
												title: "Not copied",
												description: "The browser did not allow the clipboard.",
												variant: "destructive",
											}),
									)
								}
								data-testid="copy-fix-brief"
							>
								Copy fix brief
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<p className="mt-0.5 flex flex-wrap gap-x-3 text-meta text-text-2">
				<span>
					Ran on {who.agent}
					{version ? ` ${version}` : ""}, model {who.model} ({source})
				</span>
				{investigation.completedAt && (
					<span>Completed {ago(investigation.completedAt, now)}</span>
				)}
			</p>
		</header>
	);
}

function ReportPage({
	investigation,
	report,
}: {
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
}) {
	const { incident, run } = useIncidentRecord();
	const noRepo =
		useRanWithoutRepo(investigation.id) ||
		investigation.workspace?.layout === "unmapped";
	const service = incident.service
		? {
				id: incident.service.id,
				name: incident.service.displayName || incident.service.name,
			}
		: null;
	const steps = useDoNow({
		incidentId: incident.id,
		investigation,
		unmappedService: noRepo ? service : null,
	});
	const brief = fixBrief({
		incident,
		report,
		cwd: investigation.workspace?.cwd,
		steps: steps.map((s) =>
			s.kind === "link"
				? { title: s.title, done: false }
				: { title: s.title, detail: s.detail, done: s.done },
		),
	});
	const alert = alertAsWritten(
		incident.alerts ?? [],
		investigation.completedAt,
	);
	const props = {
		incidentId: incident.id,
		investigation,
		report,
		events: run.events,
	};
	return (
		<RecordPage testId="report-route">
			<ReportHeader
				investigation={investigation}
				report={report}
				brief={brief}
			/>
			<Answer report={report} />
			<SummaryPool
				investigation={investigation}
				report={report}
				alert={alert}
				steps={steps.map((s) =>
					s.kind === "link"
						? { title: s.title, done: false }
						: { title: s.title, priority: s.priority, done: s.done },
				)}
			/>
			<Why {...props} />
			<Gaps {...props} />
			<DoNow steps={steps} />
			<RuledOut {...props} />
			<Grounded investigation={investigation} report={report} />
			<Similar investigation={investigation} />
			<Integrity report={report} />
		</RecordPage>
	);
}

/** The first alert as it stood when the report was written. */
function alertAsWritten(
	alerts: {
		title?: string | null;
		alertName?: string | null;
		status: string;
		triggeredAt: string;
		resolvedAt?: string | null;
	}[],
	at: string | Date | null,
): { name: string; line: string; firing: boolean } | null {
	const a = alerts[0];
	if (!a) return null;
	const written = at ? new Date(at).getTime() : Date.now();
	const resolved = a.resolvedAt ? Date.parse(a.resolvedAt) : null;
	const firing =
		resolved === null ? isAlertFiring(a.status) : resolved > written;
	return {
		name: a.alertName || a.title || "Alert",
		line:
			resolved !== null
				? `cleared at ${formatClock(resolved)}`
				: firing
					? "still firing"
					: "not firing",
		firing,
	};
}

/** No report: none yet, working, failed, stopped or a chat; it names the runs that have one. */
function NoReportPage() {
	const { incident, run, runs, investigationId, selectRun } =
		useIncidentRecord();
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	const withReport = runs.filter((r) => r.hasReport);

	let title: string;
	let body: ReactNode = null;
	if (investigationId && (!inv || !run.state)) {
		title = run.error ? "The run did not load." : "Loading the run.";
	} else if (!investigationId || !inv || !run.state) {
		title = "No report";
		body = "No run yet. Start one with + New run.";
	} else if (run.state === "failed") {
		const said = failureSentence(who.agent, inv.error);
		title = "No report";
		body = (
			<>
				<StateWord tone="danger" className="text-body">
					Run failed
				</StateWord>
				{inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""}:{" "}
				{said.words ? (
					<>
						{who.agent} answered "
						<span className="text-text-1" data-testid="report-error">
							{said.words}
						</span>
						".
					</>
				) : (
					said.said
				)}
			</>
		);
	} else if (run.state === "stopped") {
		title = "No report";
		body = `You stopped Run #${runNumber(runs, inv.id)}${inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""} after ${formatElapsed(runElapsed(inv, null))}. What it found is in the Conversation.`;
	} else if (inv.kind === "chat") {
		title = "No report";
		body = "A chat run ends with no report.";
	} else {
		title = "No report yet";
		body = "The report comes when the run finishes.";
	}

	return (
		<RecordPage testId="report-route">
			<div className="pool px-3.5 py-3" data-testid="report-empty">
				<h2 className="text-heading">{title}</h2>
				{body && <div className="mt-1 text-body text-text-2">{body}</div>}
				<p className="mt-2 text-meta text-text-2" data-testid="report-runs">
					{withReport.length === 0 ? (
						"No run on this incident has a report."
					) : (
						<>
							{withReport.length === 1 ? "A report is on " : "Reports are on "}
							{withReport.map((r, i) => (
								<span key={r.id}>
									{i > 0 ? ", " : ""}
									<button
										type="button"
										onClick={() => selectRun(r.id)}
										className="text-accent hover:underline"
										data-testid="report-last-good"
									>
										{runName(runs, r)}
									</button>
								</span>
							))}
							.
						</>
					)}
				</p>
				{inv && (
					<p className="mt-2 text-meta">
						<RecordLink incidentId={incident.id} to="conversation">
							Open the conversation
						</RecordLink>
					</p>
				)}
			</div>
		</RecordPage>
	);
}
