/**
 * The incident's layout (#743 §3c): the band and the tab row, with the
 * run's status at its right end, stay pinned over every tab; each tab's body
 * scrolls inside its bounds. The run the strip follows is the one in the URL, else the one just
 * started, else the newest.
 */
import {
	canIncidentAction,
	isWorkflowLive,
	latestRun,
} from "@prismalens/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { IncidentStateBand } from "@/components/incidents/IncidentStateBand";
import type { RecordRoute } from "@/components/incidents/RecordLayout";
import { RecordTabs } from "@/components/incidents/RecordTabs";
import { ReopenDialog } from "@/components/incidents/ReopenDialog";
import { ResolveDialog } from "@/components/incidents/ResolveDialog";
import { RunStrip } from "@/components/incidents/RunStrip";
import {
	type IncidentRecord,
	IncidentRecordContext,
} from "@/components/incidents/record-context";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { PHONE, useMediaQuery } from "@/hooks/use-media-query";
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

const SUB_ROUTES: RecordRoute[] = [
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
		refetch,
	} = useQuery(orpc.incidents.get.queryOptions({ input: { id } }));
	const phone = useMediaQuery(PHONE);
	const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
	const createNote = useCreateTimelineEntry();

	const [startedId, setStartedId] = useState<string | null>(null);
	const runs = incident?.investigations ?? [];
	// The layout stays mounted across incident ids; a run started on another incident is not this one's.
	const started =
		startedId && runs.some((r) => r.id === startedId) ? startedId : null;
	// Report opens the newest run that left one, else the newest so its No report state shows;
	// every other tab the newest of any kind (#673).
	const newest =
		(pathname.endsWith("/report")
			? latestRun({ investigations: runs.filter((r) => r.hasReport) })
			: null) ?? latestRun({ investigations: runs });
	const investigationId = search.investigation ?? started ?? newest?.id ?? null;
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
		onError: (err) =>
			toast({
				title: "Not resolved",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
	});
	const [editOpen, setEditOpen] = useState(false);
	const editCause = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			setEditOpen(false);
			return invalidateIncident();
		},
		onError: (err) =>
			toast({
				title: "Cause not saved",
				description: getErrorMessage(err),
				variant: "destructive",
			}),
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
			investigate: async (start = {}) => {
				await investigateMutation.mutateAsync({
					id,
					...(start.brief ? { brief: start.brief } : {}),
					...(start.agentMode ? { agentMode: start.agentMode } : {}),
					...(start.attachments?.length
						? { attachments: start.attachments }
						: {}),
				});
			},
			isInvestigating: investigateMutation.isPending,
			acknowledge: () => updateMutation.mutate({ id, status: "investigating" }),
			resolve: () => resolveMutation.mutate({ id }),
			openClose: () => setCloseOpen(true),
			openEditCause: () => setEditOpen(true),
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
		const back = (
			<Button variant="text" size="sm" asChild>
				<Link to="/incidents">Back to the board</Link>
			</Button>
		);
		return (
			<div className="px-4 pt-6 sm:px-6">
				{error && !isNotFound(error) ? (
					<Problem
						text="This incident did not load."
						onRetry={() => void refetch()}
						back={back}
					/>
				) : (
					<NotFound back={back} />
				)}
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
					onInvestigate={() => void record.investigate().catch(() => {})}
					onClose={record.openClose}
					onReopen={record.openReopen}
					onEditCause={record.openEditCause}
					isInvestigating={investigateMutation.isPending}
					investigateDisabled={!agentReady}
					investigateDisabledReason={blockedReason}
				/>
				<RecordTabs
					incidentId={id}
					here={here}
					counts={{ alerts: incident.alertCount, timeline: timeline.length }}
					status={phone ? undefined : <RunStrip />}
				/>
				{phone && <RunStrip phone />}
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
				<ResolveDialog
					open={closeOpen}
					onOpenChange={setCloseOpen}
					incident={incident}
					isPending={closeMutation.isPending}
					onConfirm={(cause) => closeMutation.mutate({ id, ...cause })}
				/>
				<ResolveDialog
					mode="edit"
					open={editOpen}
					onOpenChange={setEditOpen}
					incident={incident}
					isPending={editCause.isPending}
					onConfirm={(cause) =>
						editCause.mutate({
							id,
							actualCause: cause.actualCause ?? "",
							actualCauseCategory: cause.actualCauseCategory ?? null,
						})
					}
				/>
			</div>
		</IncidentRecordContext.Provider>
	);
}

function IncidentSkeleton() {
	return (
		<div className="flex h-full flex-col">
			<div className="h-[76px] shrink-0 bg-surface-1" />
			<div className="mx-auto w-full max-w-[46rem] px-4 pt-6 sm:px-6">
				<Loading rows={5} />
			</div>
		</div>
	);
}

/** A 404 from the API: the record is gone, not broken. */
function isNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		(error as { status?: number }).status === 404
	);
}
