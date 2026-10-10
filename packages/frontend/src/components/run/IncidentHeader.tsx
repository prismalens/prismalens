// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	canIncidentAction,
	type IncidentWithRelations,
	isIncidentOpen,
	SEVERITY_LABEL,
} from "@prismalens/contracts";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { MergeDialog } from "@/components/incidents/MergeDialog";
import { Hint } from "@/components/shared/Hint";
import { Mono } from "@/components/shared/Mono";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-now";
import { usePageTitle } from "@/hooks/use-page-title";
import { useToast } from "@/hooks/use-toast";
import { orpc } from "@/lib/api/orpc-client";
import { download } from "@/lib/download";
import { getErrorMessage } from "@/lib/get-error-message";
import { cn } from "@/lib/utils";
import { firingWord } from "./run-labels";

/** The 132 px the Windows window controls draw over (#811); nothing interactive under them. */
export function WindowControlsSpace() {
	return (
		<span
			aria-hidden
			className="hidden w-[132px] shrink-0 desktop:block mac:hidden"
		/>
	);
}

/**
 * The breadcrumb header (#811): back to the inbox, `INC-1 WalkGrouped / Run 2`,
 * service, severity, firing; then the page's own control, Resolve and the menu.
 * The incident name is the way up to the overview. The overview can reuse it with `view="Overview"`.
 */
export function IncidentHeader({
	incident,
	view,
	reportRunId,
	onResolve,
	onReopen,
	onEditCause,
	trailing,
	controlsSpace = true,
}: {
	incident: IncidentWithRelations;
	view: string;
	/** A run with a report: the menu exports it as Markdown. */
	reportRunId?: string | null;
	onResolve: () => void;
	onReopen: () => void;
	onEditCause: () => void;
	/** The page's own control before Resolve, e.g. the details toggle. */
	trailing?: ReactNode;
	/** False while a side panel holds the window controls' corner. */
	controlsSpace?: boolean;
}) {
	usePageTitle(`INC-${incident.number} ${incident.title} / ${view}`);
	const now = useNow(30_000);
	const { toast } = useToast();
	const [mergeOpen, setMergeOpen] = useState(false);
	const firing = firingWord(incident.alerts ?? [], now);
	const service = incident.service;
	const merged = incident.mergedInto;
	const canMerge = !incident.mergedIntoId && isIncidentOpen(incident.status);
	const resolvable = !merged && canIncidentAction("close", incident.status);
	const reopenable = !merged && canIncidentAction("reopen", incident.status);
	const hasMenu =
		!!reportRunId || canMerge || !!merged || incident.status === "closed";
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
			className="flex h-(--header-h) min-w-0 shrink-0 items-center gap-3 bg-surface-1 pr-3 pl-2 whitespace-nowrap desktop:app-drag desktop:[&_a]:app-no-drag desktop:[&_button]:app-no-drag"
			data-testid="incident-header"
		>
			<Hint label="Back to the inbox">
				<Button variant="text" size="icon" className="shrink-0" asChild>
					<Link
						to="/incidents"
						aria-label="Back to the inbox"
						data-testid="incident-back"
					>
						<ChevronLeft className="size-4" />
					</Link>
				</Button>
			</Hint>
			<Mono className="shrink-0 text-meta text-text-3">
				INC-{incident.number}
			</Mono>
			<h1 className="min-w-[104px] shrink truncate text-title">
				<Hint label="Back to the incident overview">
					<Link
						to="/incidents/$id"
						params={{ id: incident.id }}
						className="underline-offset-[3px] hover:underline"
						data-testid="crumb-incident"
						dir="auto"
					>
						{incident.title}
					</Link>
				</Hint>
			</h1>
			<span aria-hidden className="shrink-0 text-text-3">
				/
			</span>
			<span
				className="shrink-0 text-body font-semibold"
				aria-current="page"
				data-testid="crumb-view"
			>
				{view}
			</span>
			{service && (
				<span className="min-w-0 shrink truncate text-text-3 max-lg:hidden">
					{service.displayName || service.name}
				</span>
			)}
			<span
				className="shrink-0 rounded-control bg-surface-2 px-2 text-meta font-medium"
				style={{ color: `var(--sev-${incident.severity})` }}
				data-testid="header-severity"
			>
				{SEVERITY_LABEL[incident.severity]}
			</span>
			{firing && (
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
			)}
			<span className="flex-1" />
			{trailing}
			{resolvable && (
				<Button
					variant="secondary"
					className="h-7 shrink-0 bg-surface-2 hover:bg-surface-3"
					onClick={onResolve}
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
			{hasMenu && (
				<DropdownMenu>
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
					<DropdownMenuContent align="end" className="w-56">
						{reportRunId && (
							<DropdownMenuItem
								disabled={exportReport.isPending}
								onClick={() => exportReport.mutate({ id: reportRunId })}
								data-testid="header-export"
							>
								Export report as Markdown
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
			)}
			{controlsSpace && <WindowControlsSpace />}
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
