// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	INCIDENT_STATUS_LABEL,
	type IncidentStatus,
	type IncidentWithRelations,
	isIncidentEnded,
	isIncidentOpen,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { MergeDialog } from "@/components/incidents/MergeDialog";
import { DRAFT } from "@/components/incidents/record-context";
import { Surface, SurfaceMore } from "@/components/kit/Surface";
import { Hint } from "@/components/shared/Hint";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { useEscapeBack } from "@/hooks/use-escape-back";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import { incidentKeys, timelineKeys } from "@/lib/api/hooks";
import { orpc } from "@/lib/api/orpc-client";
import { download } from "@/lib/download";
import { getErrorMessage } from "@/lib/get-error-message";
import { readableTitle } from "@/lib/title";
import { isPlainChat } from "@/lib/trigger";
import { cn } from "@/lib/utils";
import type { IncidentCtx } from "./incident.actions";
import { NoteDialog } from "./NoteDialog";
import { firingWord } from "./run-labels";
import { StatusUpdateDialog } from "./StatusUpdateDialog";

/**
 * The breadcrumb header (#811): back to the inbox, `INC-1 WalkGrouped / Run 2`,
 * severity, firing; then the page's own control, Resolve and the menu.
 * The incident name is the way up to the overview. The overview can reuse it with `view="Overview"`.
 */
export function IncidentHeader({
	incident,
	view,
	reportRunId,
	onResolve,
	onReopen,
	onEditCause,
	onInvestigateAgain,
	trailing,
	details,
	runs,
	resolvePrimary = false,
}: {
	incident: IncidentWithRelations;
	view: string;
	/** A run with a report: the menu exports it as Markdown. */
	reportRunId?: string | null;
	onResolve: () => void;
	onReopen: () => void;
	onEditCause: () => void;
	/** A reported run: start a new run with its report quoted. */
	onInvestigateAgain?: (() => void) | null;
	/** The page's own state before the menu, e.g. the run strip. */
	trailing?: ReactNode;
	/** The run's details panel, toggled from the menu; its flags ride on the ⋯. */
	details?: {
		open: boolean;
		onToggle: () => void;
		label: string;
		flagged: number;
		warns: string[];
	};
	/** The incident's runs, reached from the menu. */
	runs?: { count: number };
	/** Resolve is this state's primary action (a finished report): a button, not a menu row. */
	resolvePrimary?: boolean;
}) {
	// A chat carries no incident number, in the tab title or for screen readers (#1020 D10).
	usePageTitle(
		isPlainChat(incident)
			? `${incident.title} / ${view}`
			: `INC-${incident.number} ${readableTitle(incident.title)} / ${view}`,
	);
	const navigate = useNavigate();
	useEscapeBack(useCallback(() => void navigate({ to: "/new" }), [navigate]));
	const now = useNow(30_000);
	const { toast } = useToast();
	const queryClient = useQueryClient();
	const [mergeOpen, setMergeOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [updateOpen, setUpdateOpen] = useState(false);
	const [noteOpen, setNoteOpen] = useState(false);
	const firing = firingWord(incident.alerts ?? [], now);
	// A chat started from Home is not an incident: no severity, firing or Resolve button (#1020 D10).
	const chat = isPlainChat(incident);
	const merged = incident.mergedInto;
	const canMerge = !incident.mergedIntoId && isIncidentOpen(incident.status);
	const resolvable = !merged && canIncidentAction("close", incident.status);
	const reopenable = !merged && canIncidentAction("reopen", incident.status);
	const severity = useMutation({
		...orpc.incidents.update.mutationOptions(),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: incidentKeys.all() }),
				queryClient.invalidateQueries({ queryKey: timelineKeys.all() }),
			]),
		onError: (error) =>
			toast({
				title: "Severity not changed",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});
	const exportReport = useMutation({
		...orpc.investigations.exportMarkdown.mutationOptions(),
		onSuccess: ({ filename, markdown }) => download(filename, markdown),
		onError: (error) =>
			toast({
				title: "Export failed",
				description: getErrorMessage(error),
				variant: "destructive",
			}),
	});

	const resolve = () => (firing?.firing ? setConfirmOpen(true) : onResolve());
	const flagged = !!details && !details.open && details.flagged > 0;
	const warned = !!details && !details.open && details.warns.length > 0;
	const moreLabel = [
		"Incident actions",
		...(flagged && details
			? [
					`${details.flagged} flagged ${details.flagged === 1 ? "item" : "items"}`,
				]
			: []),
		...(warned && details ? details.warns : []),
	].join(", ");
	const ctx: IncidentCtx = {
		toggleDetails: () => details?.onToggle(),
		detailsLabel: details?.label ?? "Details",
		allRuns: () =>
			void navigate({ to: "/incidents/$id", params: { id: incident.id } }),
		newConversation: () =>
			void navigate({
				to: "/incidents/$id/conversation",
				params: { id: incident.id },
				search: { investigation: DRAFT },
			}),
		resolve,
		note: () => setNoteOpen(true),
		statusUpdate: () => setUpdateOpen(true),
		setSeverity: (v) =>
			v !== incident.severity &&
			severity.mutate({ id: incident.id, severity: v }),
		severity: incident.severity,
		investigateAgain: () => onInvestigateAgain?.(),
		merge: () => setMergeOpen(true),
		exportReport: () => reportRunId && exportReport.mutate({ id: reportRunId }),
		openMerged: () =>
			merged &&
			void navigate({ to: "/incidents/$id", params: { id: merged.id } }),
		editCause: onEditCause,
		facts: {
			is: {
				chat,
				hasRun: !!details,
				detailsOpen: !!details?.open,
				manyRuns: (runs?.count ?? 0) > 1,
				resolvable: resolvable && !chat,
				severityEditable: !chat && !merged && !severity.isPending,
				canInvestigateAgain: !!onInvestigateAgain,
				canMerge: canMerge && !chat,
				hasReport: !!reportRunId && !exportReport.isPending,
				merged: !!merged,
				closed: incident.status === "closed",
			},
		},
	};
	return (
		<Surface id="incident.header" ctx={ctx}>
			<header
				className="flex h-(--header-h) min-w-0 shrink-0 items-center gap-3 bg-surface-1 pr-3 pl-2 whitespace-nowrap"
				data-testid="incident-header"
				data-title-row
			>
				<Hint label="Back">
					<Button variant="text" size="icon" className="shrink-0" asChild>
						<Link to="/new" aria-label="Back" data-testid="incident-back">
							<ChevronLeft className="size-4" />
						</Link>
					</Button>
				</Hint>
				<h1 className="min-w-[104px] shrink truncate text-title">
					{!chat && <span className="sr-only">INC-{incident.number} </span>}
					<Hint label="The incident's latest run">
						<Link
							to="/incidents/$id"
							params={{ id: incident.id }}
							className="inline-flex min-h-6 max-w-full items-center underline-offset-[3px] hover:underline"
							data-testid="crumb-incident"
							dir="auto"
						>
							{chat ? incident.title : readableTitle(incident.title)}
						</Link>
					</Hint>
				</h1>
				<span aria-hidden className="shrink-0 text-text-3 max-sm:hidden">
					/
				</span>
				<span
					className="shrink-0 text-body font-semibold max-sm:hidden"
					aria-current="page"
					data-testid="crumb-view"
				>
					{view}
				</span>
				{!chat && (
					<span
						className="shrink-0 rounded-control bg-surface-2 px-2 text-meta font-medium"
						style={{ color: `var(--sev-${incident.severity})` }}
						data-testid="header-severity"
					>
						{SEVERITY_LABEL[incident.severity]}
					</span>
				)}
				{chat ? null : merged ? (
					<Link
						to="/incidents/$id"
						params={{ id: merged.id }}
						className="shrink-0 text-text-3 underline-offset-2 hover:text-text-1 hover:underline max-sm:hidden"
						data-testid="header-state"
					>
						Merged into INC-{merged.number}
					</Link>
				) : isIncidentEnded(incident.status) ? (
					<span
						className="shrink-0 text-text-3 max-sm:hidden"
						data-testid="header-state"
					>
						{INCIDENT_STATUS_LABEL[incident.status as IncidentStatus]}
					</span>
				) : (
					firing && (
						<span
							className={cn(
								"flex shrink-0 items-center gap-1.5 max-lg:hidden",
								firing.firing ? "text-danger" : "text-text-3",
							)}
							data-testid="header-firing"
						>
							{firing.firing && (
								<span
									aria-hidden
									className="size-[7px] rounded-full bg-danger"
								/>
							)}
							{firing.text}
						</span>
					)
				)}
				<span className="flex-1" />
				{trailing}
				{resolvable && !chat && resolvePrimary && (
					<Button
						variant="secondary"
						// A phone gives the title this room; Resolve waits in ⋯ there (#1020).
						className="h-7 shrink-0 bg-surface-2 hover:bg-surface-3 max-sm:hidden"
						onClick={resolve}
						data-testid="header-resolve"
					>
						Resolve
					</Button>
				)}
				{reopenable && (
					<Button
						variant="secondary"
						className="h-7 shrink-0 bg-surface-2 hover:bg-surface-3"
						onClick={onReopen}
						data-testid="header-reopen"
					>
						Reopen
					</Button>
				)}
				<SurfaceMore
					id="incident.header"
					ctx={ctx}
					align="end"
					trigger={
						<button
							type="button"
							aria-label={moreLabel}
							className="relative flex size-7 shrink-0 items-center justify-center rounded-control bg-surface-2 text-text-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-surface-3"
							data-testid="header-more"
						>
							<MoreHorizontal className="size-4" aria-hidden />
							{/* The details panel's flags stay in sight while it is shut. */}
							{flagged && (
								<span
									aria-hidden
									className="absolute top-[3px] right-[3px] size-[7px] rounded-full bg-danger"
									data-testid="details-flag"
								/>
							)}
							{warned && (
								<span
									aria-hidden
									className={cn(
										"absolute top-[3px] size-[7px] rounded-full bg-warn",
										flagged ? "right-[12px]" : "right-[3px]",
									)}
									data-testid="details-warn"
								/>
							)}
						</button>
					}
				/>
				<NoteDialog open={noteOpen} onOpenChange={setNoteOpen} />
				<StatusUpdateDialog
					open={updateOpen}
					onOpenChange={setUpdateOpen}
					incident={incident}
					now={now}
				/>
				<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
					<AlertDialogContent data-testid="resolve-firing-confirm">
						<AlertDialogHeader>
							<AlertDialogTitle>
								Resolve while the alert is firing?
							</AlertDialogTitle>
							<AlertDialogDescription>
								{incident.title} is still firing. If it keeps firing after you
								resolve, PrismaLens opens a new incident and links it to this
								one.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								className={buttonVariants({ variant: "danger-fill" })}
								onClick={onResolve}
								data-testid="resolve-anyway"
							>
								Resolve anyway
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				{canMerge && (
					<MergeDialog
						open={mergeOpen}
						onOpenChange={setMergeOpen}
						incident={incident}
					/>
				)}
			</header>
		</Surface>
	);
}
