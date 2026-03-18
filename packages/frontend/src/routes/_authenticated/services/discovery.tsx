import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ServiceSuggestion, SuggestionStatus } from "@prismalens/contracts";

import {
	useAcceptBulkSuggestions,
	useConnections,
	useIgnoreSuggestion,
	useRejectSuggestion,
	useSuggestions,
	useTriggerDiscovery,
} from "@/lib/api/hooks";
import { PageHeader } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/ui/data-table";
import { AcceptSuggestionDialog } from "@/components/services/AcceptSuggestionDialog";
import { RunDiscoveryDialog } from "@/components/services/RunDiscoveryDialog";
import { MutationError } from "@/components/shared/MutationError";

const PAGE_SIZE = 25;

const statusOptions = [
	{ value: "all", label: "All Status" },
	{ value: "pending", label: "Pending" },
	{ value: "accepted", label: "Accepted" },
	{ value: "rejected", label: "Rejected" },
	{ value: "ignored", label: "Ignored" },
];

const sourceTypeOptions = [
	{ value: "all", label: "All Sources" },
	{ value: "repository", label: "🔗 Repository" },
	{ value: "deployment", label: "🚀 Deployment" },
];

const statusColors: Record<string, string> = {
	pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
	accepted: "bg-green-500/10 text-green-500 border-green-500/20",
	rejected: "bg-red-500/10 text-red-500 border-red-500/20",
	ignored: "bg-muted text-muted-foreground",
};

export const Route = createFileRoute("/_authenticated/services/discovery")({
	component: DiscoveryPage,
});

function DiscoveryPage() {
	const [statusFilter, setStatusFilter] = useState<SuggestionStatus | "all">("pending");
	const [sourceTypeFilter, setSourceTypeFilter] = useState<"repository" | "deployment" | "all">("all");
	const [page, setPage] = useState(1);
	const [acceptingSuggestion, setAcceptingSuggestion] =
		useState<ServiceSuggestion | null>(null);
	const [discoveryError, setDiscoveryError] = useState<Error | null>(null);
	const [showRunDialog, setShowRunDialog] = useState(false);

	const offset = (page - 1) * PAGE_SIZE;

	// Fetch suggestions
	const { data: suggestions = [], isLoading } = useSuggestions({
		status: statusFilter !== "all" ? statusFilter as SuggestionStatus : undefined,
		sourceType: sourceTypeFilter !== "all" ? sourceTypeFilter : undefined,
		limit: PAGE_SIZE,
		offset,
	});

	// Fetch VCS + deployment connections for "Run Discovery" button
	const { data: allConnections = [] } = useConnections();
	const discoveryConnections = allConnections.filter((c) => {
		const category = c.template?.category;
		return category === "vcs" || category === "deployment";
	});

	const triggerDiscovery = useTriggerDiscovery();
	const rejectSuggestion = useRejectSuggestion();
	const ignoreSuggestion = useIgnoreSuggestion();
	const bulkAccept = useAcceptBulkSuggestions();

	const handleRunDiscovery = async (connectionIds: string[]) => {
		setShowRunDialog(false);
		setDiscoveryError(null);
		const results = await Promise.allSettled(
			connectionIds.map((id) =>
				triggerDiscovery.mutateAsync({ connectionId: id }),
			),
		);
		const failed = results.filter((r) => r.status === "rejected");
		if (failed.length > 0) {
			setDiscoveryError(
				new Error(`${failed.length} of ${connectionIds.length} connections failed`),
			);
		}
	};

	const handleIgnore = (id: string) => {
		ignoreSuggestion.mutate({ id });
	};

	const suggestionsArray = Array.isArray(suggestions) ? suggestions : [];
	const total = suggestionsArray.length;

	const columns: ColumnDef<ServiceSuggestion>[] = [
		{
			accessorKey: "suggestedName",
			header: "Suggested Name",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.suggestedName}</p>
					{row.original.displayName &&
						row.original.displayName !== row.original.suggestedName && (
							<p className="text-xs text-muted-foreground">
								{row.original.displayName}
							</p>
						)}
				</div>
			),
		},
		{
			accessorKey: "repository",
			header: "Repository",
			cell: ({ row }) => (
				<span className="text-sm font-mono text-muted-foreground">
					{row.original.repository}
					{row.original.subPath && `/${row.original.subPath}`}
				</span>
			),
		},
		{
			accessorKey: "sourceType",
			header: "Source",
			cell: ({ row }) => (
				<Badge variant="outline" className="text-xs">
					{row.original.sourceType === "deployment"
						? "🚀 Deployment"
						: "🔗 Repository"}
				</Badge>
			),
		},
		{
			accessorKey: "isMonorepo",
			header: "Type",
			cell: ({ row }) => (
				<Badge variant="outline" className="text-xs">
					{row.original.isMonorepo ? "Monorepo" : "Single"}
				</Badge>
			),
		},
		{
			accessorKey: "status",
			header: "Status",
			cell: ({ row }) => (
				<Badge
					variant="outline"
					className={`capitalize text-xs ${statusColors[row.original.status] || ""}`}
				>
					{row.original.status}
				</Badge>
			),
		},
		{
			id: "actions",
			header: "",
			cell: ({ row }) => {
				if (row.original.status !== "pending") return null;
				return (
					<div className="flex items-center gap-1 justify-end">
						<Button
							variant="outline"
							size="sm"
							onClick={(e) => {
								e.stopPropagation();
								setAcceptingSuggestion(row.original);
							}}
						>
							Accept
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.stopPropagation();
								rejectSuggestion.mutate({ id: row.original.id });
							}}
						>
							Reject
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.stopPropagation();
								handleIgnore(row.original.id);
							}}
						>
							Ignore
						</Button>
					</div>
				);
			},
		},
	];

	return (
		<div className="space-y-6">
			<PageHeader
				backLink={{ label: "Services", to: "/services" }}
				title="Discovered Services"
				subtitle="Services automatically discovered from your integrations"
				actions={
					discoveryConnections.length > 0 ? (
						<Button
							size="sm"
							onClick={() => setShowRunDialog(true)}
							disabled={triggerDiscovery.isPending}
						>
							<Play className="h-4 w-4 mr-1" />
							Run Discovery
						</Button>
					) : undefined
				}
			/>

			<MutationError error={discoveryError} className="mb-4" />

			{/* Filters */}
			<div className="flex items-center gap-3">
				<Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SuggestionStatus | "all")}>
					<SelectTrigger className="w-[160px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{statusOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={sourceTypeFilter} onValueChange={(v) => setSourceTypeFilter(v as "repository" | "deployment" | "all")}>
					<SelectTrigger className="w-[160px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{sourceTypeOptions.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Table */}
			<DataTable
				columns={columns}
				data={suggestionsArray}
				isLoading={isLoading}
				emptyMessage="No suggestions found"
			/>

			{/* Pagination */}
			{total >= PAGE_SIZE && (
				<div className="flex items-center justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {suggestionsArray.length} suggestions
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={page <= 1}
							onClick={() => setPage((p) => p - 1)}
						>
							<ChevronLeft className="h-4 w-4 mr-1" />
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={total < PAGE_SIZE}
							onClick={() => setPage((p) => p + 1)}
						>
							Next
							<ChevronRight className="h-4 w-4 ml-1" />
						</Button>
					</div>
				</div>
			)}

			{/* Accept Dialog */}
			<AcceptSuggestionDialog
				open={!!acceptingSuggestion}
				onOpenChange={(open) => {
					if (!open) setAcceptingSuggestion(null);
				}}
				suggestion={acceptingSuggestion}
			/>

			{/* Run Discovery Dialog */}
			<RunDiscoveryDialog
				open={showRunDialog}
				onOpenChange={setShowRunDialog}
				connections={discoveryConnections}
				onRun={handleRunDiscovery}
				isPending={triggerDiscovery.isPending}
			/>
		</div>
	);
}
