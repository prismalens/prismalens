/**
 * The incident's Case File (experiment, s09): the alert-time capture and the
 * claims built from it. Off unless Settings, Experiments turns it on.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { CaseFileView } from "@/components/case-file/CaseFileView";
import { useIncidentRecord } from "@/components/incidents/record-context";
import { IncidentHeader } from "@/components/run/IncidentHeader";
import { Empty, Loading, Problem } from "@/components/shared/State";
import {
	useCaseFileSettings,
	useCaseView,
} from "@/lib/api/hooks/use-case-files-orpc";

export const Route = createFileRoute("/_authenticated/incidents/$id/case")({
	component: CasePage,
});

function CasePage() {
	const record = useIncidentRecord();
	const { incident } = record;
	return (
		<div className="flex h-full min-h-0 flex-col" data-testid="incident-case">
			<IncidentHeader
				incident={incident}
				view="Case File"
				onResolve={record.openClose}
				onReopen={record.openReopen}
				onEditCause={record.openEditCause}
			/>
			<main className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[52rem] px-4 pt-4 pb-12">
					<CaseBody incidentId={incident.id} />
				</div>
			</main>
		</div>
	);
}

function CaseBody({ incidentId }: { incidentId: string }) {
	const settings = useCaseFileSettings();
	const enabled = settings.data?.enabled === true;
	const view = useCaseView(incidentId, enabled);
	if (settings.isLoading) return <Loading />;
	if (!enabled || view.data?.enabled === false)
		return (
			<Empty
				testId="case-off"
				text="Case File is off."
				action={
					<Link
						to="/settings"
						search={{ tab: "experiments" }}
						className="text-accent hover:underline"
					>
						Turn it on in Settings, Experiments
					</Link>
				}
			/>
		);
	if (view.isLoading) return <Loading />;
	if (view.error || !view.data)
		return (
			<Problem
				text="The case did not load."
				onRetry={() => void view.refetch()}
			/>
		);
	return <CaseFileView incidentId={incidentId} view={view.data} />;
}
