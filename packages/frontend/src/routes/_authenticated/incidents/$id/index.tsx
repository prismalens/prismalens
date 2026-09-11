/**
 * The incident screen. The investigation runs in place here (#599, the UX
 * study's highest-value change): no round-trip to a second route.
 */
import type { TimelineEntryType } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	CorrelatedAlerts,
	IncidentDetailHeader,
	IncidentOverview,
	RecommendationsList,
	TimelineTab,
} from "@/components/incidents";
import { InvestigationPanel } from "@/components/investigation/InvestigationPanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
	useCreateTimelineEntry,
	useInvestigationReadiness,
	useTimeline,
} from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

type IncidentTab =
	| "overview"
	| "alerts"
	| "investigation"
	| "recommendations"
	| "timeline";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	validateSearch: (
		search: Record<string, unknown>,
	): { tab?: IncidentTab; investigation?: string } => ({
		...(typeof search.tab === "string"
			? { tab: search.tab as IncidentTab }
			: {}),
		...(typeof search.investigation === "string"
			? { investigation: search.investigation }
			: {}),
	}),
	component: IncidentDetailPage,
});

function IncidentDetailPage() {
	const { id } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isReady: canRunInvestigation, blockedReason } =
		useInvestigationReadiness();

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

	// The investigation shown: the one in the URL, else the newest on the incident.
	const [startedId, setStartedId] = useState<string | null>(null);
	const latest = incident?.investigations?.[0]?.id ?? null;
	const investigationId = search.investigation ?? startedId ?? latest;
	const tab: IncidentTab =
		search.tab ?? (investigationId ? "investigation" : "overview");
	const setTab = (next: string) =>
		navigate({
			search: (prev) => ({ ...prev, tab: next as IncidentTab }),
			replace: true,
		});

	const updateMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
	});
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
			queryClient.invalidateQueries({ queryKey: ["investigations"] });
			if (data.investigationId) {
				setStartedId(data.investigationId);
				navigate({
					search: () => ({
						tab: "investigation",
						investigation: data.investigationId,
					}),
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
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["incidents"] }),
	});
	const completeRecommendationMutation = useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["recommendations"] }),
	});

	const handleInvestigate = () => investigateMutation.mutate({ id });
	const handleCreateTimelineEntry = (entry: {
		title: string;
		description?: string;
		type: TimelineEntryType;
	}) => {
		createTimelineEntryMutation.mutate({
			incidentId: id,
			title: entry.title,
			description: entry.description,
			type: entry.type,
			source: "user",
		});
	};

	if (isLoadingIncident) return <IncidentDetailSkeleton />;
	if (incidentError || !incident) {
		return (
			<div className="flex flex-col items-center justify-center py-12">
				<p className="text-lg font-medium text-destructive">
					Failed to load incident
				</p>
				<p className="text-sm text-muted-foreground">
					{incidentError?.message || "Incident not found"}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<IncidentDetailHeader
				incident={incident}
				onAcknowledge={() =>
					updateMutation.mutate({ id, status: "investigating" })
				}
				onInvestigate={handleInvestigate}
				onResolve={() => resolveMutation.mutate({ id })}
				isInvestigating={investigateMutation.isPending}
				investigateDisabled={!canRunInvestigation}
				investigateDisabledReason={blockedReason}
			/>

			<Tabs value={tab} onValueChange={setTab} className="space-y-4">
				<TabsList>
					<TabsTrigger value="overview">Overview</TabsTrigger>
					<TabsTrigger value="alerts">
						Alerts ({incident.alertCount})
					</TabsTrigger>
					<TabsTrigger value="investigation">Investigation</TabsTrigger>
					<TabsTrigger value="recommendations">
						Recommendations ({recommendations.length})
					</TabsTrigger>
					<TabsTrigger value="timeline">
						Timeline ({timelineEntries.length})
					</TabsTrigger>
				</TabsList>
				<TabsContent value="overview">
					<IncidentOverview
						incident={incident}
						timelineEntries={timelineEntries}
						timelineLoading={isLoadingTimeline}
					/>
				</TabsContent>
				<TabsContent value="alerts">
					<CorrelatedAlerts alerts={incident.alerts || []} />
				</TabsContent>
				<TabsContent value="investigation">
					{investigationId ? (
						<div className="space-y-4">
							{(incident.investigations?.length ?? 0) > 1 && (
								<div
									className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
									data-testid="investigation-history"
								>
									<span>Runs:</span>
									{incident.investigations?.map((inv, i) => (
										<Button
											key={inv.id}
											variant={
												inv.id === investigationId ? "secondary" : "ghost"
											}
											size="sm"
											onClick={() =>
												navigate({
													search: () => ({
														tab: "investigation",
														investigation: inv.id,
													}),
													replace: true,
												})
											}
										>
											#{(incident.investigations?.length ?? 0) - i} ·{" "}
											{inv.status}
										</Button>
									))}
								</div>
							)}
							<InvestigationPanel
								key={investigationId}
								investigationId={investigationId}
							/>
						</div>
					) : (
						<div
							className="flex flex-col items-center justify-center py-12 text-center"
							data-testid="investigation-empty"
						>
							<p className="text-lg font-medium">No investigation yet</p>
							<p className="text-sm text-muted-foreground max-w-md mt-1">
								{canRunInvestigation
									? "Start one and the run streams here, in place."
									: (blockedReason ??
										"No coding agent is available to run one.")}
							</p>
							<Button
								className="mt-4"
								onClick={handleInvestigate}
								disabled={!canRunInvestigation || investigateMutation.isPending}
							>
								{investigateMutation.isPending ? "Starting..." : "Investigate"}
							</Button>
						</div>
					)}
				</TabsContent>
				<TabsContent value="recommendations">
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
				</TabsContent>
				<TabsContent value="timeline">
					<TimelineTab
						incidentId={id}
						entries={timelineEntries}
						isLoading={isLoadingTimeline}
						onCreateEntry={handleCreateTimelineEntry}
						isCreating={createTimelineEntryMutation.isPending}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function IncidentDetailSkeleton() {
	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<Skeleton className="h-4 w-32" />
				<div className="flex items-center gap-3">
					<Skeleton className="h-6 w-20" />
					<Skeleton className="h-8 w-64" />
				</div>
				<Skeleton className="h-4 w-96" />
			</div>
			<Skeleton className="h-10 w-96" />
			<Skeleton className="h-64" />
		</div>
	);
}
