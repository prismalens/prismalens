/**
 * The incident's layout: the band and the tab row stay pinned over every tab;
 * each tab is one 52rem column with nothing beside it (#673 w29). The run
 * the tabs show is the one in the URL, else the one just started, else the newest.
 */
import { isWorkflowLive } from "@prismalens/contracts";
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
import {
	DRAFT,
	type DraftChoice,
	type IncidentRecord,
	IncidentRecordContext,
	type RunStart,
} from "@/components/incidents/record-context";
import { openRun } from "@/components/incidents/run-facts";
import { useInvestigationRun } from "@/components/investigation/useInvestigationRun";
import { Loading, NotFound, Problem } from "@/components/shared/State";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
	timelineKeys,
	useCreateTimelineEntry,
	useInvestigationReadiness,
	useTimeline,
} from "@/lib/api/hooks";
import { incidentKeys } from "@/lib/api/hooks/use-incidents-orpc";
import { investigationKeys } from "@/lib/api/hooks/use-investigations-orpc";
import { orpc } from "@/lib/api/orpc-client";
import { getErrorMessage } from "@/lib/get-error-message";
import type { RunVerb } from "@/lib/run-verb";

export const Route = createFileRoute("/_authenticated/incidents/$id")({
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
	const { data: timeline = [], isLoading: timelineLoading } = useTimeline(id);
	const createNote = useCreateTimelineEntry();

	const [startedId, setStartedId] = useState<string | null>(null);
	type DraftState = {
		choice?: DraftChoice;
		text: string;
		verb?: RunVerb;
		files?: File[];
	};
	const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
	const draftOf = drafts[id] ?? { text: "" };
	const setDraft = (patch: Partial<DraftState>) =>
		setDrafts((all) => ({
			...all,
			[id]: { ...(all[id] ?? { text: "" }), ...patch },
		}));

	const runs = incident?.investigations ?? [];
	const started =
		startedId && runs.some((r) => r.id === startedId) ? startedId : null;
	const here = SUB_ROUTES.find((r) => pathname.endsWith(`/${r}`)) ?? null;
	const newest = openRun(runs, here === "report");
	const draft =
		search.investigation === DRAFT ||
		(here === "conversation" && !search.investigation && runs.length === 0);
	const investigationId = draft
		? null
		: (search.investigation ?? started ?? newest?.id ?? null);
	const run = useInvestigationRun(investigationId);

	// Acknowledge, Resolve and Reopen each write a Timeline entry (#673 walk 4).
	const invalidateIncident = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: incidentKeys.all() }),
			queryClient.invalidateQueries({ queryKey: timelineKeys.all() }),
		]);
	const onStarted = (runId: string | undefined) => {
		invalidateIncident();
		queryClient.invalidateQueries({ queryKey: investigationKeys.all() });
		setDraft({ text: "", choice: undefined, verb: undefined, files: [] });
		if (!runId) return;
		setStartedId(runId);
		navigate({
			to: "/incidents/$id/conversation",
			params: { id },
			search: { investigation: runId },
			replace: true,
		});
	};
	const updateMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: invalidateIncident,
	});
	const investigateMutation = useMutation({
		...orpc.incidents.investigate.mutationOptions(),
		onSuccess: (data) => onStarted(data.investigationId),
	});
	const chatMutation = useMutation({
		...orpc.incidents.chat.mutationOptions(),
		onSuccess: (data) => onStarted(data.investigationId),
	});
	const resolveMutation = useMutation({
		...orpc.incidents.resolve.mutationOptions(),
		onSuccess: invalidateIncident,
	});
	const failed = (title: string) => (err: unknown) =>
		toast({
			title,
			description: getErrorMessage(err),
			variant: "destructive",
		});
	const [closeOpen, setCloseOpen] = useState(false);
	const closeMutation = useMutation({
		...orpc.incidents.close.mutationOptions(),
		onSuccess: () => {
			setCloseOpen(false);
			return invalidateIncident();
		},
		onError: failed("Not resolved"),
	});
	const [editOpen, setEditOpen] = useState(false);
	const editCause = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			setEditOpen(false);
			return invalidateIncident();
		},
		onError: failed("Cause not saved"),
	});
	const [reopenOpen, setReopenOpen] = useState(false);
	const reopenMutation = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () => {
			setReopenOpen(false);
			return invalidateIncident();
		},
		onError: failed("Not reopened"),
	});

	const liveRun =
		runs.find(
			(r) =>
				isWorkflowLive(r.status) ||
				(r.id === run.investigation?.id && run.isActive),
		) ?? null;
	const startInput = (start: RunStart) => ({
		...(start.accessLevel ? { accessLevel: start.accessLevel } : {}),
		...(start.runMode ? { runMode: start.runMode } : {}),
		...(start.harness ? { harness: start.harness } : {}),
		...(start.model !== undefined ? { model: start.model || null } : {}),
		...(start.effort !== undefined ? { effort: start.effort } : {}),
		...(start.attachments?.length ? { attachments: start.attachments } : {}),
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: mutation objects change identity every render; their pending state is listed.
	const record: IncidentRecord | null = useMemo(() => {
		if (!incident) return null;
		return {
			incident,
			runs,
			investigationId,
			draft,
			selectRun: (next: string) =>
				navigate({
					search: (prev) => ({ ...prev, investigation: next }),
					replace: true,
				}),
			newRun: (prefill) => {
				if (prefill)
					setDraft({
						...(prefill.choice ? { choice: prefill.choice } : {}),
						...(prefill.verb ? { verb: prefill.verb } : {}),
						...(prefill.text !== undefined ? { text: prefill.text } : {}),
						...(prefill.files ? { files: prefill.files } : {}),
					});
				navigate({
					to: "/incidents/$id/conversation",
					params: { id },
					search: { investigation: DRAFT },
				});
			},
			draftChoice: draftOf.choice ?? {},
			setDraftChoice: (choice) => setDraft({ choice }),
			draftText: draftOf.text,
			setDraftText: (text) => setDraft({ text }),
			draftVerb: draftOf.verb,
			setDraftVerb: (verb) => setDraft({ verb }),
			draftFiles: draftOf.files ?? [],
			setDraftFiles: (files) => setDraft({ files }),
			run,
			liveRun,
			investigateBlocked: agentReady ? undefined : blockedReason,
			investigate: async (start = {}) => {
				await investigateMutation.mutateAsync({
					id,
					...(start.text ? { brief: start.text } : {}),
					...startInput(start),
				});
			},
			chat: async (start) => {
				await chatMutation.mutateAsync({
					id,
					text: start.text,
					...startInput(start),
				});
			},
			isStarting: investigateMutation.isPending || chatMutation.isPending,
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
						onError: failed("Note not saved"),
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
		draft,
		draftOf.choice,
		draftOf.text,
		draftOf.verb,
		draftOf.files,
		run,
		liveRun,
		agentReady,
		blockedReason,
		investigateMutation.isPending,
		chatMutation.isPending,
		createNote.isPending,
		timeline,
		timelineLoading,
		id,
	]);

	if (isLoading) return <IncidentSkeleton />;
	// A failed refetch (the run tree polls this query) keeps the page it already has.
	if (!incident || !record) {
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
					onAcknowledge={record.acknowledge}
					onNewRun={() => record.newRun()}
					onClose={record.openClose}
					onReopen={record.openReopen}
					onEditCause={record.openEditCause}
				/>
				<RecordTabs
					incidentId={id}
					here={here}
					counts={{ alerts: incident.alertCount, timeline: timeline.length }}
				/>
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
			<div className="h-20 shrink-0" />
			<div className="mx-auto w-full max-w-(--reading-w) px-4 pt-6">
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
