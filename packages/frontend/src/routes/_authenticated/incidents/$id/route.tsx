/**
 * The incident's layout (#743 §3c): the band and, once a run exists, the run
 * strip stay pinned over every layer under the incident; the card page and
 * the routes (conversation, report, alerts, timeline) scroll inside their
 * bounds. The run the strip follows is the one in the URL, else the one just
 * started, else the newest.
 */
import { canIncidentAction, isWorkflowLive } from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CloseIncidentDialog } from "@/components/incidents/CloseIncidentDialog";
import type { CardRoute } from "@/components/incidents/cards/Card";
import { IncidentStateBand } from "@/components/incidents/IncidentStateBand";
import { RecordCrumb } from "@/components/incidents/RecordCrumb";
import { ReopenDialog } from "@/components/incidents/ReopenDialog";
import { RunStrip } from "@/components/incidents/RunStrip";
import {
	type IncidentRecord,
	IncidentRecordContext,
} from "@/components/incidents/record-context";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
	useCreateTimelineEntry,
	useInvestigationReadiness,
	useTimeline,
} from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";

export const Route = createFileRoute("/_authenticated/incidents/$id")({
	// `tab` is accepted and ignored so links from before the reshape still resolve.
	validateSearch: (
		search: Record<string, unknown>,
	): { investigation?: string } => ({
		...(typeof search.investigation === "string"
			? { investigation: search.investigation }
			: {}),
	}),
	component: IncidentLayout,
});

const SUB_ROUTES: CardRoute[] = [
	"conversation",
	"report",
	"alerts",
	"timeline",
];

function IncidentLayout() {
	const { id } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { pathname } = useLocation();
	const queryClient = useQueryClient();
	const { toast } = useToast();
	const { isReady: agentReady, blockedReason } = useInvestigationReadiness();

	const {
		data: incident,
		isLoading,
		error,
	} = useQuery(orpc.incidents.get.queryOptions({ input: { id } }));
	const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
	const createNote = useCreateTimelineEntry();

	const [startedId, setStartedId] = useState<string | null>(null);
	const runs = incident?.investigations ?? [];
	const investigationId =
		search.investigation ?? startedId ?? runs[0]?.id ?? null;
	const run = useInvestigationRun(investigationId);

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
					search: (prev) => ({ ...prev, investigation: data.investigationId }),
					replace: true,
				});
			}
		},
		onError: (err) =>
			toast({
				title: "Investigation refused",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
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

	const [reopenOpen, setReopenOpen] = useState(false);
	const reopenMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			setReopenOpen(false);
			return invalidateIncident();
		},
		onError: (err) =>
			toast({
				title: "Not reopened",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
	});

	const here = SUB_ROUTES.find((r) => pathname.endsWith(`/${r}`)) ?? null;
	// Any live run on the incident withholds Investigate, whichever run is selected.
	const runLive = run.isActive || runs.some((r) => isWorkflowLive(r.status));

	// biome-ignore lint/correctness/useExhaustiveDependencies: mutation objects change identity every render; their pending state is listed.
	const record: IncidentRecord | null = useMemo(() => {
		if (!incident) return null;
		return {
			incident,
			runs,
			investigationId,
			selectRun: (next: string) =>
				navigate({
					search: (prev) => ({ ...prev, investigation: next }),
					replace: true,
				}),
			run,
			canInvestigate:
				canIncidentAction("investigate", incident.status) && !runLive,
			investigateBlocked: agentReady ? undefined : blockedReason,
			investigate: (brief?: string) =>
				investigateMutation.mutate({ id, ...(brief ? { brief } : {}) }),
			isInvestigating: investigateMutation.isPending,
			acknowledge: () => updateMutation.mutate({ id, status: "investigating" }),
			resolve: () => resolveMutation.mutate({ id }),
			openClose: () => setCloseOpen(true),
			openReopen: () => setReopenOpen(true),
			addNote: (text: string, onDone?: () => void) =>
				createNote.mutate(
					{ incidentId: id, title: text, type: "comment", source: "user" },
					{
						onSuccess: () => onDone?.(),
						onError: (err) =>
							toast({
								title: "Note not saved",
								description: getErrorMessage(err),
								variant: "destructive",
							}),
					},
				),
			isSavingNote: createNote.isPending,
			timeline,
			timelineLoading,
		};
	}, [
		incident,
		runs,
		investigationId,
		run,
		runLive,
		agentReady,
		blockedReason,
		investigateMutation.isPending,
		createNote.isPending,
		timeline,
		timelineLoading,
		id,
	]);

	if (isLoading) return <IncidentSkeleton />;
	if (error || !incident || !record) {
		return (
			<div className="flex h-full flex-col items-center justify-center p-8">
				<p className="text-lg font-medium text-run-failed">
					Failed to load incident
				</p>
				<p className="text-sm text-muted-foreground">
					{error?.message || "Incident not found"}
				</p>
			</div>
		);
	}

	return (
		<IncidentRecordContext.Provider value={record}>
			<div
				className="flex h-full min-h-0 flex-col"
				data-testid="incident-record-frame"
			>
				<IncidentStateBand
					incident={incident}
					runLive={runLive}
					onAcknowledge={record.acknowledge}
					onInvestigate={() => record.investigate()}
					onResolve={record.resolve}
					onClose={record.openClose}
					onReopen={record.openReopen}
					isInvestigating={investigateMutation.isPending}
					investigateDisabled={!agentReady}
					investigateDisabledReason={blockedReason}
					backToIncident={here !== null}
				/>
				<RunStrip />
				{here && <RecordCrumb incidentId={id} here={here} />}
				<div className="min-h-0 flex-1">
					<Outlet />
				</div>
				<ReopenDialog
					open={reopenOpen}
					onOpenChange={setReopenOpen}
					incidentNumber={incident.number}
					isPending={reopenMutation.isPending}
					onConfirm={() =>
						reopenMutation.mutate({ id, status: "investigating" })
					}
				/>
				<CloseIncidentDialog
					open={closeOpen}
					onOpenChange={setCloseOpen}
					isPending={closeMutation.isPending}
					onConfirm={(cause) => closeMutation.mutate({ id, ...cause })}
				/>
			</div>
		</IncidentRecordContext.Provider>
	);
}

function IncidentSkeleton() {
	return (
		<div className="space-y-4 p-4">
			<div className="flex items-center gap-3">
				<Skeleton className="h-6 w-16" />
				<Skeleton className="h-5 w-14" />
				<Skeleton className="h-6 w-96" />
			</div>
			<div className="mx-auto max-w-[46rem] space-y-3">
				<Skeleton className="h-24" />
				<Skeleton className="h-16" />
				<Skeleton className="h-20" />
			</div>
		</div>
	);
}
