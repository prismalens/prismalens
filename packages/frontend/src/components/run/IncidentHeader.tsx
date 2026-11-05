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
	type Severity,
} from "@prismalens/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { MergeDialog } from "@/components/incidents/MergeDialog";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { NoteDialog } from "./NoteDialog";
import { firingWord } from "./run-labels";
import { StatusUpdateDialog } from "./StatusUpdateDialog";

const SEVERITIES = Object.keys(SEVERITY_LABEL) as Severity[];

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
	/** The page's own control before Resolve, e.g. the details toggle. */
	trailing?: ReactNode;
}) {
	// A chat carries no incident number, in the tab title or for screen readers (#1020 D10).
	usePageTitle(
		isPlainChat(incident)
			? `${incident.title} / ${view}`
			: `INC-${incident.number} ${readableTitle(incident.title)} / ${view}`,
	);
	const navigate = useNavigate();
	useEscapeBack(
		useCallback(() => void navigate({ to: "/threads" }), [navigate]),
	);
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

	return (
		<header
			className="flex h-(--header-h) min-w-0 shrink-0 items-center gap-3 bg-surface-1 pr-3 pl-2 whitespace-nowrap"
			data-testid="incident-header"
		>
			<Hint label="Back to threads">
				<Button variant="text" size="icon" className="shrink-0" asChild>
					<Link
						to="/threads"
						aria-label="Back to threads"
						data-testid="incident-back"
					>
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
							<span aria-hidden className="size-[7px] rounded-full bg-danger" />
						)}
						{firing.text}
					</span>
				)
			)}
			<span className="flex-1" />
			{trailing}
			{resolvable && !chat && (
				<Button
					variant="secondary"
					// A phone gives the title this room; Resolve waits in More there (#1020).
					className="h-7 shrink-0 bg-surface-2 hover:bg-surface-3 max-sm:hidden"
					onClick={() => (firing?.firing ? setConfirmOpen(true) : onResolve())}
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
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="secondary"
						size="icon"
						className="size-7 shrink-0 bg-surface-2 text-text-2 hover:bg-surface-3"
						aria-label="More actions"
						data-testid="header-more"
					>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-60">
					{resolvable && !chat && (
						<DropdownMenuItem
							className="sm:hidden"
							onClick={() =>
								firing?.firing ? setConfirmOpen(true) : onResolve()
							}
							data-testid="header-resolve-menu"
						>
							Resolve
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						onClick={() => setNoteOpen(true)}
						data-testid="header-note"
					>
						Add a note
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setUpdateOpen(true)}
						data-testid="header-status-update"
					>
						Write a status update
					</DropdownMenuItem>
					{!merged && (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger data-testid="header-severity-menu">
								Change severity
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuRadioGroup
									value={incident.severity}
									onValueChange={(v) =>
										v !== incident.severity &&
										severity.mutate({
											id: incident.id,
											severity: v as Severity,
										})
									}
								>
									{SEVERITIES.map((s) => (
										<DropdownMenuRadioItem
											key={s}
											value={s}
											disabled={severity.isPending}
											data-testid={`header-severity-${s}`}
										>
											{SEVERITY_LABEL[s]}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					)}
					{onInvestigateAgain && (
						<DropdownMenuItem
							onClick={onInvestigateAgain}
							data-testid="header-investigate-again"
						>
							Investigate again
						</DropdownMenuItem>
					)}
					{canMerge && (
						<DropdownMenuItem
							onClick={() => setMergeOpen(true)}
							data-testid="header-merge"
						>
							Merge into another incident
						</DropdownMenuItem>
					)}
					{reportRunId && (
						<DropdownMenuItem
							disabled={exportReport.isPending}
							onClick={() => exportReport.mutate({ id: reportRunId })}
							data-testid="header-export"
						>
							Export report as Markdown
						</DropdownMenuItem>
					)}
					{merged && (
						<DropdownMenuItem asChild>
							<Link to="/incidents/$id" params={{ id: merged.id }}>
								Merged into INC-{merged.number}
							</Link>
						</DropdownMenuItem>
					)}
					{incident.status === "closed" && (
						<DropdownMenuItem
							onClick={onEditCause}
							data-testid="header-edit-cause"
						>
							Edit cause
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
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
							resolve, PrismaLens opens a new incident and links it to this one.
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
	);
}
