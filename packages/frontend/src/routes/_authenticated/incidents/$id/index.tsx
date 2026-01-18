import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { TimelineEntryType } from "@prismalens/contracts";
import {
	CorrelatedAlerts,
	IncidentDetailHeader,
	IncidentOverview,
	InvestigationProgress,
	PostmortemEditor,
	RecommendationsList,
	TimelineTab,
} from "@/components/incidents";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCreateTimelineEntry, useLlmConfigs, useTimeline } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";

export const Route = createFileRoute("/_authenticated/incidents/$id/")({
	component: IncidentDetailPage,
});

function IncidentDetailPage() {
	const { id } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Check if LLM is configured
	const { data: llmConfigs } = useLlmConfigs();
	const isLlmConfigured = !!llmConfigs?.activeProvider;

	// Fetch incident details
	const {
		data: incident,
		isLoading: isLoadingIncident,
		error: incidentError,
	} = useQuery(orpc.incidents.get.queryOptions({ input: { id } }));

	// Fetch recommendations for this incident
	const { data: recommendations = [] } = useQuery({
		...orpc.recommendations.list.queryOptions({ input: { incidentId: id } }),
		enabled: !!incident,
	});

	// Fetch timeline entries for this incident
	const {
		data: timelineEntries = [],
		isLoading: isLoadingTimeline,
	} = useTimeline(id);

	// Create timeline entry mutation
	const createTimelineEntryMutation = useCreateTimelineEntry();

	// Update incident mutation (for acknowledge)
	const updateMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
		},
	})

	// Investigate mutation
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (data) => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
			queryClient.invalidateQueries({ queryKey: ["investigations"] });
			// Navigate to the investigation
			if (data.investigationId) {
				navigate({ to: "/investigations/$id", params: { id: data.investigationId } });
			}
		},
	})

	// Resolve mutation
	const resolveMutation = useMutation({
		...orpc.incidents.resolve.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["incidents"] });
		},
	})

	// Recommendation mutations
	const completeRecommendationMutation = useMutation({
		...orpc.recommendations.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["recommendations"] });
		},
	})

	const handleAcknowledge = () => {
		updateMutation.mutate({ id, status: "investigating" });
	}

	const handleInvestigate = () => {
		investigateMutation.mutate({ id });
	}

	const handleResolve = () => {
		resolveMutation.mutate({ id });
	}

	const handleCompleteRecommendation = (recId: string) => {
		completeRecommendationMutation.mutate({ id: recId, status: "completed" });
	}

	const handleDismissRecommendation = (recId: string) => {
		completeRecommendationMutation.mutate({ id: recId, status: "rejected" });
	};

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

	if (isLoadingIncident) {
		return <IncidentDetailSkeleton />;
	}

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
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<IncidentDetailHeader
				incident={incident}
				onAcknowledge={handleAcknowledge}
				onInvestigate={handleInvestigate}
				onResolve={handleResolve}
				isInvestigating={investigateMutation.isPending}
				investigateDisabled={!isLlmConfigured}
				investigateDisabledReason={
					!isLlmConfigured
						? "Configure an AI provider in Settings to enable investigations"
						: undefined
				}
			/>

			{/* Tabs */}
			<Tabs defaultValue="overview" className="space-y-4">
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
					<TabsTrigger value="postmortem">Postmortem</TabsTrigger>
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
					<InvestigationProgress
						investigations={incident.investigations || []}
						onStartInvestigation={handleInvestigate}
						isStarting={investigateMutation.isPending}
					/>
				</TabsContent>

				<TabsContent value="recommendations">
					<RecommendationsList
						recommendations={recommendations}
						onComplete={handleCompleteRecommendation}
						onDismiss={handleDismissRecommendation}
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

				<TabsContent value="postmortem">
					<PostmortemEditor
						incidentId={id}
						incidentTitle={incident.title}
					/>
				</TabsContent>
			</Tabs>
		</div>
	)
}

function IncidentDetailSkeleton() {
	return (
		<div className="space-y-6">
			{/* Header skeleton */}
			<div className="space-y-4">
				<Skeleton className="h-4 w-32" />
				<div className="flex items-center gap-3">
					<Skeleton className="h-6 w-20" />
					<Skeleton className="h-8 w-64" />
				</div>
				<div className="flex items-center gap-2">
					<Skeleton className="h-6 w-16" />
					<Skeleton className="h-6 w-12" />
					<Skeleton className="h-6 w-24" />
				</div>
				<Skeleton className="h-4 w-96" />
			</div>

			{/* Tabs skeleton */}
			<div className="space-y-4">
				<Skeleton className="h-10 w-96" />
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
					<Skeleton className="h-32" />
				</div>
			</div>
		</div>
	)
}
