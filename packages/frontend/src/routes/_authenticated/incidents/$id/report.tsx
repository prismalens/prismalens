/**
 * The Report tab (study-v3 §3.2): the answer and how sure, whether it is still
 * broken, why, what could not be checked and what to do now, as a designed
 * page; Markdown is only the export. A run with no report says why not.
 */
import {
	ACCESS_LABEL,
	type InvestigationReport,
	type InvestigationWithRelations,
	runState,
} from "@prismalens/contracts";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	useIncidentFacts,
	useRanWithoutRepo,
} from "@/components/incidents/IncidentFacts";
import {
	type Fact,
	FactsRail,
	RecordLink,
	RecordPage,
} from "@/components/incidents/RecordLayout";
import { runElapsed, useRunAgentModel } from "@/components/incidents/RunStrip";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { DockedComposer } from "@/components/investigation/DockedComposer";
import { DoNow, useDoNow } from "@/components/investigation/DoNow";
import { ExportReportButton } from "@/components/investigation/ExportReportButton";
import { PostToGitHubButton } from "@/components/investigation/PostToGitHubButton";
import {
	Answer,
	CopyFixBrief,
	Gaps,
	Grounded,
	Integrity,
	Now,
	RuledOut,
	RunLine,
	Similar,
	Why,
} from "@/components/investigation/ReportSections";
import { failureWords } from "@/lib/failure-words";
import { formatClock, formatElapsed } from "@/lib/format-time";
import {
	fixBrief,
	groundedIn,
	harnessWords,
	nowLine,
	workDone,
	workSentence,
} from "@/lib/report-view";

export const Route = createFileRoute("/_authenticated/incidents/$id/report")({
	component: ReportRoute,
});

const box = (
	<DockedComposer
		className="bg-transparent px-0 pt-0 pb-0 sm:px-0"
		width="max-w-none"
	/>
);

function ReportRoute() {
	const { run } = useIncidentRecord();
	const inv = run.investigation;
	const report = inv?.report ?? null;
	if (run.state === "done" && inv && report)
		return <ReportPage investigation={inv} report={report} />;
	return <NoReportPage />;
}

/** Below the answer on the phone, or in the header between 768 and 1279. */
function ShareActions({
	investigation,
	brief,
	compact,
}: {
	investigation: InvestigationWithRelations;
	brief: string;
	compact?: boolean;
}) {
	return (
		<>
			<CopyFixBrief
				text={brief}
				variant="ghost"
				label={compact ? "Copy fix brief" : "Copy fix brief for your agent"}
			/>
			<ExportReportButton
				investigationId={investigation.id}
				label={compact ? "Export" : "Export Markdown"}
			/>
			{investigation.status === "completed" && (
				<PostToGitHubButton investigationId={investigation.id} />
			)}
		</>
	);
}

function ReportPage({
	investigation,
	report,
}: {
	investigation: InvestigationWithRelations;
	report: InvestigationReport;
}) {
	const { incident, run, runs } = useIncidentRecord();
	const who = useRunAgentModel(investigation);
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
	const number = runs.length - runs.findIndex((r) => r.id === investigation.id);
	const took = formatElapsed(runElapsed(investigation, null));
	const access = ACCESS_LABEL[report.fidelity?.mode ?? "read-only"];
	const version = report.fidelity?.harnessVersion;
	const agent = [
		who.agent,
		who.model,
		version && `${report.fidelity?.harness} ${version}`,
	]
		.filter(Boolean)
		.join(", ");
	const sources = groundedIn(report, investigation.workspace?.cwd).length;
	const now = nowLine(incident.alerts ?? [], service?.name ?? null);
	const props = {
		incidentId: incident.id,
		investigation,
		report,
		events: run.events,
	};
	const later = "max-md:order-2";

	const rail: Fact[] = [
		{ label: "Run", value: `Investigation #${number}, done in ${took}` },
		{ label: "Agent", value: agent },
		{ label: "Access", value: access, testId: "fact-access" },
		{
			label: "Grounded in",
			value: `${sources} source${sources === 1 ? "" : "s"}`,
		},
		{
			label: "Links",
			value: (
				<>
					<RecordLink
						incidentId={incident.id}
						to="conversation"
						search={{ investigation: investigation.id }}
					>
						Conversation
					</RecordLink>
					<RecordLink
						incidentId={incident.id}
						to="conversation"
						search={{ investigation: investigation.id, ledger: "1" }}
					>
						Event log
					</RecordLink>
				</>
			),
			testId: "report-rail-links",
		},
	];

	return (
		<RecordPage
			testId="report-route"
			box={box}
			rail={
				<FactsRail
					facts={rail}
					actions={
						<>
							<CopyFixBrief text={brief} className="justify-center" />
							<div className="flex flex-wrap gap-1 [&>*]:px-1.5">
								<ExportReportButton investigationId={investigation.id} />
								{investigation.status === "completed" && (
									<PostToGitHubButton investigationId={investigation.id} />
								)}
							</div>
						</>
					}
				/>
			}
		>
			<div
				className="-mt-2 mb-3 hidden justify-end gap-1 md:flex xl:hidden"
				data-testid="report-header-actions"
			>
				<ShareActions investigation={investigation} brief={brief} compact />
			</div>
			<div className="flex flex-col">
				<Answer report={report} />
				<Now now={now} severity={incident.severity} />
				<Why {...props} className={later} />
				<Gaps {...props} className={later} />
				<DoNow steps={steps} className="max-md:order-1" />
				<RuledOut {...props} className={later} />
				<Grounded
					investigation={investigation}
					report={report}
					className={later}
				/>
				<Similar investigation={investigation} className={later} />
				<Integrity report={report} className={later} />
				<RunLine
					incidentId={incident.id}
					investigationId={investigation.id}
					parts={[`Investigation #${number}`, agent, took, access]}
					className={`${later} xl:hidden`}
				/>
				<div
					className={`${later} mt-3 flex flex-wrap gap-1 md:hidden`}
					data-testid="report-phone-actions"
				>
					<ShareActions investigation={investigation} brief={brief} compact />
				</div>
			</div>
		</RecordPage>
	);
}

function seconds(n: number): string {
	return n < 60 ? `${n} second${n === 1 ? "" : "s"}` : formatElapsed(n);
}

/** No report: none yet, still working, failed or stopped; each says why and where to look. */
function NoReportPage() {
	const { incident, run, runs, investigationId, selectRun } =
		useIncidentRecord();
	const { rail } = useIncidentFacts();
	const who = useRunAgentModel(run.investigation);
	const inv = run.investigation;
	const now = nowLine(
		incident.alerts ?? [],
		incident.service?.displayName || incident.service?.name || null,
	);
	const lastGood = runs.findIndex(
		(r) =>
			r.id !== investigationId &&
			runState(r.status, { hasEvents: true }) === "done",
	);
	const lastGoodRun = lastGood >= 0 ? runs[lastGood] : null;
	const links = inv && (
		<p className="mt-3 flex gap-3.5 text-body" data-testid="report-links">
			<RecordLink
				incidentId={incident.id}
				to="conversation"
				search={{ ledger: "1" }}
			>
				Event log
			</RecordLink>
			<RecordLink incidentId={incident.id} to="conversation">
				Conversation
			</RecordLink>
		</p>
	);

	let title: string;
	let body: ReactNode = null;
	if (!investigationId || !inv || !run.state) {
		title = "No investigation yet.";
		body =
			"The report lands here when one finishes. Brief the agent in the box below to start one.";
	} else if (run.state === "failed") {
		const took = runElapsed(inv, null);
		const work = workDone(run.events);
		const late = work.commands + work.files > 0;
		const words = failureWords(inv.error);
		title = late
			? `No report. The run failed after ${formatElapsed(took)}.`
			: `No report. The run failed ${seconds(took)} in.`;
		body = (
			<>
				{late && (
					<>
						It {workSentence(work)} before it stopped; what it found is in the{" "}
						<RecordLink incidentId={incident.id} to="conversation">
							Conversation
						</RecordLink>
						.{" "}
					</>
				)}
				{who.agent} answered:{" "}
				<span
					className="font-mono text-mono text-text-1"
					data-testid="report-error"
				>
					{inv.error ? harnessWords(inv.error) : "no error was recorded"}
				</span>
				.{" "}
				{words.what.startsWith("The agent is not signed in")
					? "PrismaLens never signs an agent in for you; sign it in on this machine, then start again."
					: words.next}
			</>
		);
	} else if (run.state === "stopped") {
		title = `No report. You stopped the run${inv.completedAt ? ` at ${formatClock(inv.completedAt)}` : ""} after ${formatElapsed(runElapsed(inv, null))}.`;
		body =
			"What it found so far is in the Conversation. Start a new investigation from the box below.";
	} else {
		title = "The report comes when the run finishes.";
		body = "Follow the run in the Conversation.";
	}

	return (
		<RecordPage
			testId="report-route"
			box={box}
			rail={<FactsRail facts={rail} />}
		>
			<div data-testid="report-empty">
				<h2 className="text-title">{title}</h2>
				{body && <p className="mt-1.5 text-body text-text-2">{body}</p>}
				<Now now={now} severity={incident.severity} />
				{links}
				{lastGoodRun && (
					<p className="mt-6 text-body text-text-2">
						<button
							type="button"
							onClick={() => selectRun(lastGoodRun.id)}
							className="text-accent hover:underline"
							data-testid="report-last-good"
						>
							Read the report from investigation #{runs.length - lastGood}
						</button>
					</p>
				)}
			</div>
		</RecordPage>
	);
}
