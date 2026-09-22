/**
 * The incident record (#523 S1). A state band that never scrolls, the durable
 * record in sections (report, evidence, run ledger, alerts, timeline), a live
 * sidecar rail, and a composer docked across the bottom. The run streams here,
 * in place (#599); there is no second route to bounce to.
 */
import { canIncidentAction } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	CloseIncidentDialog,
	CorrelatedAlerts,
	IncidentComposer,
	IncidentRail,
	IncidentStateBand,
	RecommendationsList,
	TimelineTab,
} from "@/components/incidents";
import type { ComposerCommand } from "@/components/incidents/IncidentComposer";
import {
	EvidenceSection,
	ReportSection,
} from "@/components/investigation/ReportSections";
import { RunLedgerSection } from "@/components/investigation/RunLedgerSection";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { RecordSection } from "@/components/shared/RecordSection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLayoutPrefs } from "@/hooks/use-layout-prefs";
import { useToast } from "@/hooks/use-toast";
import {
	useCreateTimelineEntry,
	useInvestigationReadiness,
	useTimeline,
} from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { recommendationKeys } from "@/lib/api/hooks/use-recommendations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { download } from "@/lib/download";
import { getErrorMessage } from "@/lib/get-error-message";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	// `tab` is accepted and ignored so links from before the reshape still resolve.
	validateSearch: (
		search: Record<string, unknown>,
	): { investigation?: string } => ({
		...(typeof search.investigation === "string"
			? { investigation: search.investigation }
			: {}),
	}),
	component: IncidentRecordPage,
});

function IncidentRecordPage() {
	const { id } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { railHidden, toggleRail } = useLayoutPrefs();
	const [showAllAlerts, setShowAllAlerts] = useState(false);
	const [showAllTimeline, setShowAllTimeline] = useState(false);
	const { isReady: canRunInvestigation, blockedReason } =
		useInvestigationReadiness();

	// `]` hides or shows the rail, unless the operator is typing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (e.key !== "]" || e.metaKey || e.ctrlKey || e.altKey) return;
			if (
				t?.tagName === "INPUT" ||
				t?.tagName === "TEXTAREA" ||
				t?.isContentEditable
			)
				return;
			e.preventDefault();
			toggleRail();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [toggleRail]);

	const {
		data: incident,
		isLoading: isLoadingIncident,
		error: incidentError,
	} = useQuery(orpc.incidents.get.queryOptions({ input: { id } }));
	const { data: recommendations = [] } = useQuery({
		...orpc.recommendations.list.queryOptions({ input: { incidentId: id } }),
		enabled: !!incident,
	});
	const { data: timelineEntries = [], isLoading: isLoadingTimeline } =
		useTimeline(id);
	const createTimelineEntryMutation = useCreateTimelineEntry();

	// The run shown: the one in the URL, else the one just started, else the newest.
	const [startedId, setStartedId] = useState<string | null>(null);
	const runs = incident?.investigations ?? [];
	const latest = runs[0]?.id ?? null;
	const investigationId = search.investigation ?? startedId ?? latest;
	const run = useInvestigationRun(investigationId);
	const selectRun = (next: string) =>
		navigate({ search: () => ({ investigation: next }), replace: true });

	// oRPC query keys start with a path array, so a string key such as ["incidents"] never
	// matches and nothing refetches until a reload (#337 run e, G13). Use the key builders.
	const invalidateIncident = () =>
		queryClient.invalidateQueries({ queryKey: incidentKeys.all() });
	const updateMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: invalidateIncident,
	});
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (data) => {
			invalidateIncident();
			queryClient.invalidateQueries({ queryKey: investigationKeys.all() });
			if (data.investigationId) {
				setStartedId(data.investigationId);
				navigate({
					search: () => ({ investigation: data.investigationId }),
					replace: true,
				});
			}
		},
		onError: (error) => {
			toast({
				title: "Investigation refused",
				description: getErrorMessage(error),
				variant: "destructive",
			});
		},
	});
	const resolveMutation = useMutation({
		...orpc.incidents.resolve.mutationOptions(),
		onSuccess: invalidateIncident,
	});
	const [closeOpen, setCloseOpen] = useState(false);
	const closeMutation = useMutation({
		...orpc.incidents.close.mutationOptions(),
		onSuccess: () => {
			setCloseOpen(false);
			return invalidateIncident();
		},
	});
	const completeRecommendationMutation = useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: recommendationKeys.all() }),
	});
	const exportMutation = useMutation({
		...orpc.investigations.exportMarkdown.mutationOptions(),
		onSuccess: ({ filename, markdown }) => download(filename, markdown),
		onError: (error) =>
			toast({
				title: "Export failed",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});

	const handleInvestigate = () => investigateMutation.mutate({ id });
	const handleNote = (text: string) =>
		createTimelineEntryMutation.mutate(
			{ incidentId: id, title: text, type: "comment", source: "user" },
			{
				onError: (error) =>
					toast({
						title: "Note not saved",
						description: getErrorMessage(error),
						variant: "destructive",
					}),
			},
		);

	if (isLoadingIncident) return <IncidentRecordSkeleton />;
	if (incidentError || !incident) {
		return (
			<div className="flex h-full flex-col items-center justify-center p-8">
				<p className="text-lg font-medium text-run-failed">
					Failed to load incident
				</p>
				<p className="text-sm text-muted-foreground">
					{incidentError?.message || "Incident not found"}
				</p>
			</div>
		);
	}

	const investigation = run.investigation;
	const runLive = run.isActive;
	const canInvestigate =
		canIncidentAction("investigate", incident.status) && !runLive;
	const hasReport = !!investigation && !runLive && !run.failed;

	const commands: ComposerCommand[] = [
		{
			name: "investigate",
			hint: "Start a run on this incident",
			run: handleInvestigate,
			disabledReason: !canInvestigate
				? runLive
					? "A run is already in progress"
					: "Only an open incident can be investigated"
				: !canRunInvestigation
					? (blockedReason ?? "No coding agent is available")
					: undefined,
		},
		{
			name: "acknowledge",
			hint: "Mark the incident as being worked",
			run: () => updateMutation.mutate({ id, status: "investigating" }),
			disabledReason: canIncidentAction("acknowledge", incident.status)
				? undefined
				: "Already acknowledged",
		},
		{
			name: "resolve",
			hint: "Mark the incident resolved",
			run: () => resolveMutation.mutate({ id }),
			disabledReason: canIncidentAction("resolve", incident.status)
				? undefined
				: "Already resolved",
		},
		{
			name: "close",
			hint: "Close with the actual cause recorded",
			run: () => setCloseOpen(true),
			disabledReason: canIncidentAction("close", incident.status)
				? undefined
				: "Resolve the incident first",
		},
		{
			name: "export",
			hint: "Download the report as Markdown",
			run: () => {
				if (investigation) exportMutation.mutate({ id: investigation.id });
			},
			disabledReason: !hasReport ? "No completed report to export" : undefined,
		},
	];

	return (
		<div
			className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]"
			data-testid="incident-record-frame"
		>
			<IncidentStateBand
				incident={incident}
				runLive={runLive}
				onAcknowledge={() =>
					updateMutation.mutate({ id, status: "investigating" })
				}
				onInvestigate={handleInvestigate}
				onResolve={() => resolveMutation.mutate({ id })}
				onClose={() => setCloseOpen(true)}
				onCancelRun={run.cancel}
				isInvestigating={investigateMutation.isPending}
				investigateDisabled={!canRunInvestigation}
				investigateDisabledReason={blockedReason}
				railHidden={railHidden}
				onToggleRail={toggleRail}
			/>

			<CloseIncidentDialog
				open={closeOpen}
				onOpenChange={setCloseOpen}
				isPending={closeMutation.isPending}
				onConfirm={(cause) => closeMutation.mutate({ id, ...cause })}
			/>

			<div
				className={
					railHidden
						? "grid min-h-0"
						: "grid min-h-0 xl:grid-cols-[minmax(0,1fr)_20rem]"
				}
			>
				<div
					className="min-h-0 min-w-0 space-y-6 overflow-y-auto px-4 py-4 sm:px-6"
					data-testid="incident-record"
				>
					{incident.description && (
						<p className="max-w-3xl text-record text-muted-foreground">
							{incident.description}
						</p>
					)}
					{(incident.actualCause || incident.actualCauseCategory) && (
						<p className="max-w-3xl text-record" data-testid="actual-cause">
							<span className="text-muted-foreground">
								{incident.actualCause
									? `Actual cause${
											incident.actualCauseCategory
												? ` (${incident.actualCauseCategory})`
												: ""
										}: `
									: "Actual cause category: "}
							</span>
							{incident.actualCause ?? incident.actualCauseCategory}
						</p>
					)}

					{hasReport && investigation ? (
						<>
							<ReportSection investigation={investigation} />
							<EvidenceSection investigation={investigation} />
						</>
					) : (
						!investigationId && (
							<RecordSection id="report" title="Report">
								<div
									className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4"
									data-testid="investigation-empty"
								>
									<div>
										<p className="text-record font-medium">
											No investigation yet
										</p>
										<p className="text-record text-muted-foreground">
											{canRunInvestigation
												? "Start one and the run streams here, in place."
												: (blockedReason ??
													"No coding agent is available to run one.")}
										</p>
									</div>
									<Button
										size="sm"
										onClick={handleInvestigate}
										disabled={
											!canRunInvestigation || investigateMutation.isPending
										}
									>
										{investigateMutation.isPending ? "Starting" : "Investigate"}
									</Button>
								</div>
							</RecordSection>
						)
					)}

					{investigationId && (
						<RunLedgerSection
							run={run}
							runs={runs}
							selectedId={investigationId}
							onSelect={selectRun}
						/>
					)}

					{recommendations.length > 0 && (
						<RecordSection
							id="recommendations"
							title="Recommendations"
							count={recommendations.length}
						>
							<RecommendationsList
								recommendations={recommendations}
								onComplete={(recId) =>
									completeRecommendationMutation.mutate({
										id: recId,
										status: "completed",
									})
								}
								onDismiss={(recId) =>
									completeRecommendationMutation.mutate({
										id: recId,
										status: "rejected",
									})
								}
							/>
						</RecordSection>
					)}

					<RecordSection
						id="alerts"
						title="Alerts"
						count={incident.alertCount}
						actions={
							(incident.alerts?.length ?? 0) > 5 ? (
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-meta"
									onClick={() => setShowAllAlerts((v) => !v)}
									data-testid="alerts-toggle"
								>
									{showAllAlerts
										? "Show fewer"
										: `Show all ${incident.alerts?.length}`}
								</Button>
							) : undefined
						}
					>
						<CorrelatedAlerts
							alerts={
								showAllAlerts
									? (incident.alerts ?? [])
									: (incident.alerts ?? []).slice(0, 5)
							}
						/>
					</RecordSection>

					<RecordSection
						id="timeline"
						title="Timeline"
						count={timelineEntries.length}
						actions={
							timelineEntries.length > 5 ? (
								<Button
									variant="ghost"
									size="sm"
									className="h-6 px-2 text-meta"
									onClick={() => setShowAllTimeline((v) => !v)}
									data-testid="timeline-toggle"
								>
									{showAllTimeline
										? "Show fewer"
										: `Show all ${timelineEntries.length}`}
								</Button>
							) : undefined
						}
					>
						<TimelineTab
							incidentId={id}
							entries={
								showAllTimeline ? timelineEntries : timelineEntries.slice(0, 5)
							}
							isLoading={isLoadingTimeline}
						/>
					</RecordSection>
				</div>

				<div className="lg:sticky lg:top-16 lg:self-start">
					<IncidentRail
						incident={incident}
						run={investigationId ? run : null}
					/>
				</div>
			</div>

			<IncidentComposer
				incidentNumber={incident.number}
				commands={commands}
				onNote={handleNote}
				isPending={createTimelineEntryMutation.isPending}
			/>
		</div>
	);
}

function IncidentRecordSkeleton() {
	return (
		<div className="space-y-6 p-4">
			<div className="flex items-center gap-3">
				<Skeleton className="h-6 w-16" />
				<Skeleton className="h-5 w-14" />
				<Skeleton className="h-6 w-96" />
			</div>
			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="space-y-6">
					<Skeleton className="h-40" />
					<Skeleton className="h-64" />
				</div>
				<div className="space-y-3">
					<Skeleton className="h-32" />
					<Skeleton className="h-24" />
				</div>
			</div>
		</div>
	);
}
