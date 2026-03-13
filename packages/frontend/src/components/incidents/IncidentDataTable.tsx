/**
 * Incident Data Table Component
 *
 * TanStack Table implementation with sorting and pagination
 */

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { IncidentWithRelations } from "@prismalens/contracts";
import {
	type ColumnDef,
	type SortingState,
	type PaginationState,
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	getPaginationRowModel,
	useReactTable,
} from "@tanstack/react-table";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
	Eye,
	CheckCircle,
	Search,
	AlertTriangle,
	Clock,
	FileText,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	ArrowUpDown,
	ArrowUp,
	ArrowDown,
	Brain,
} from "lucide-react";
import type { Severity, IncidentStatus } from "@prismalens/contracts";

export interface IncidentDataTableProps {
	incidents: IncidentWithRelations[];
	isLoading?: boolean;
	onAcknowledge?: (id: string) => void;
	onInvestigate?: (id: string) => void;
}

const priorityColors: Record<string, string> = {
	p1: "bg-red-600 text-white",
	p2: "bg-orange-500 text-white",
	p3: "bg-yellow-500 text-black",
	p4: "bg-blue-500 text-white",
	p5: "bg-gray-500 text-white",
};

function formatTimeAgo(date: string): string {
	const now = new Date();
	const then = new Date(date);
	const diffMs = now.getTime() - then.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMins / 60);
	const diffDays = Math.floor(diffHours / 24);

	if (diffDays > 0) return `${diffDays}d ago`;
	if (diffHours > 0) return `${diffHours}h ago`;
	if (diffMins > 0) return `${diffMins}m ago`;
	return "Just now";
}

// Sortable header component
function SortableHeader({
	column,
	title,
}: {
	column: any;
	title: string;
}) {
	const sorted = column.getIsSorted();

	return (
		<Button
			variant="ghost"
			size="sm"
			className="-ml-3 h-8 data-[state=open]:bg-accent"
			onClick={() => column.toggleSorting(sorted === "asc")}
		>
			{title}
			{sorted === "asc" ? (
				<ArrowUp className="ml-2 h-4 w-4" />
			) : sorted === "desc" ? (
				<ArrowDown className="ml-2 h-4 w-4" />
			) : (
				<ArrowUpDown className="ml-2 h-4 w-4" />
			)}
		</Button>
	);
}

// Investigations badge showing count and status
function InvestigationsBadge({ incident }: { incident: IncidentWithRelations }) {
	const investigations = incident.investigations ?? [];
	const count = investigations.length;

	if (count === 0) {
		return <span className="text-muted-foreground">-</span>;
	}

	const running = investigations.filter((i) => i.status === "running").length;
	const completed = investigations.filter((i) => i.status === "completed").length;
	const failed = investigations.filter((i) => i.status === "failed").length;

	return (
		<Tooltip>
			<TooltipTrigger>
				<div className="flex items-center gap-1">
					<Brain className="h-3 w-3 text-muted-foreground" />
					<span>{count}</span>
					{running > 0 && (
						<span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<div className="text-xs">
					{completed > 0 && <div>{completed} completed</div>}
					{running > 0 && <div>{running} running</div>}
					{failed > 0 && <div>{failed} failed</div>}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}

// Column definitions
const createColumns = (
	onAcknowledge?: (id: string) => void,
	onInvestigate?: (id: string) => void,
): ColumnDef<IncidentWithRelations>[] => [
	{
		accessorKey: "number",
		header: ({ column }) => <SortableHeader column={column} title="#" />,
		cell: ({ row }) => (
			<span className="font-mono text-sm">INC-{row.original.number}</span>
		),
		size: 80,
	},
	{
		accessorKey: "title",
		header: ({ column }) => <SortableHeader column={column} title="Title" />,
		cell: ({ row }) => (
			<div>
				<Link
					to="/incidents/$id"
					params={{ id: row.original.id }}
					className="font-medium hover:underline hover:text-primary"
				>
					{row.original.title}
				</Link>
				{row.original.description && (
					<p className="text-sm text-muted-foreground truncate max-w-[300px]">
						{row.original.description}
					</p>
				)}
			</div>
		),
	},
	{
		accessorKey: "severity",
		header: ({ column }) => <SortableHeader column={column} title="Severity" />,
		cell: ({ row }) => (
			<SeverityBadge severity={row.original.severity as Severity} />
		),
		size: 100,
		sortingFn: (rowA, rowB) => {
			const order = ["critical", "high", "medium", "low", "info"];
			return order.indexOf(rowA.original.severity) - order.indexOf(rowB.original.severity);
		},
	},
	{
		accessorKey: "priority",
		header: ({ column }) => <SortableHeader column={column} title="Priority" />,
		cell: ({ row }) => (
			<Badge className={priorityColors[row.original.priority] || "bg-gray-500"}>
				{row.original.priority.toUpperCase()}
			</Badge>
		),
		size: 100,
	},
	{
		accessorKey: "status",
		header: ({ column }) => <SortableHeader column={column} title="Status" />,
		cell: ({ row }) => (
			<StatusBadge status={row.original.status as IncidentStatus} />
		),
		size: 120,
	},
	{
		accessorKey: "service",
		header: "Service",
		cell: ({ row }) =>
			row.original.service ? (
				<Link
					to="/services/$id"
					params={{ id: row.original.service.id }}
					search={{ tab: "general" }}
					className="text-sm hover:underline hover:text-primary"
				>
					{row.original.service.name}
				</Link>
			) : (
				<span className="text-muted-foreground">-</span>
			),
		size: 120,
	},
	{
		id: "investigations",
		header: "Inv",
		cell: ({ row }) => <InvestigationsBadge incident={row.original} />,
		size: 60,
	},
	{
		accessorKey: "alertCount",
		header: ({ column }) => <SortableHeader column={column} title="Alerts" />,
		cell: ({ row }) => (
			<div className="flex items-center gap-1">
				<AlertTriangle className="h-3 w-3 text-muted-foreground" />
				<span>{row.original.alertCount}</span>
			</div>
		),
		size: 80,
	},
	{
		accessorKey: "triggeredAt",
		header: ({ column }) => <SortableHeader column={column} title="Triggered" />,
		cell: ({ row }) => (
			<Tooltip>
				<TooltipTrigger>
					<div className="flex items-center gap-1 text-sm">
						<Clock className="h-3 w-3 text-muted-foreground" />
						{formatTimeAgo(row.original.triggeredAt)}
					</div>
				</TooltipTrigger>
				<TooltipContent>
					{new Date(row.original.triggeredAt).toLocaleString()}
				</TooltipContent>
			</Tooltip>
		),
		size: 100,
	},
	{
		id: "actions",
		header: "",
		cell: ({ row }) => (
			<div className="flex items-center justify-end gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="ghost" size="icon" asChild>
							<Link to="/incidents/$id" params={{ id: row.original.id }}>
								<Eye className="h-4 w-4" />
							</Link>
						</Button>
					</TooltipTrigger>
					<TooltipContent>View Details</TooltipContent>
				</Tooltip>

				{row.original.status === "triggered" && onAcknowledge && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => onAcknowledge(row.original.id)}
							>
								<CheckCircle className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Acknowledge</TooltipContent>
					</Tooltip>
				)}

				{["triggered", "investigating"].includes(row.original.status) &&
					onInvestigate && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => onInvestigate(row.original.id)}
								>
									<Search className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Start Investigation</TooltipContent>
						</Tooltip>
					)}
			</div>
		),
		size: 120,
	},
];

export function IncidentDataTable({
	incidents,
	isLoading,
	onAcknowledge,
	onInvestigate,
}: IncidentDataTableProps) {
	const [sorting, setSorting] = useState<SortingState>([
		{ id: "triggeredAt", desc: true },
	]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 10,
	});

	const columns = createColumns(onAcknowledge, onInvestigate);

	const table = useReactTable({
		data: incidents,
		columns,
		state: {
			sorting,
			pagination,
		},
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	if (isLoading) {
		return <IncidentTableSkeleton />;
	}

	if (incidents.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
				<FileText className="h-12 w-12 mb-4 opacity-50" />
				<p className="text-lg font-medium">No incidents found</p>
				<p className="text-sm">
					Incidents will appear here when alerts are correlated
				</p>
			</div>
		);
	}

	return (
		<TooltipProvider>
			<div className="space-y-4">
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<TableHead
											key={header.id}
											style={{ width: header.column.getSize() }}
										>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows.map((row) => (
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>

				{/* Pagination */}
				<div className="flex items-center justify-between px-2">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<span>
							Showing {table.getRowModel().rows.length} of {incidents.length} incidents
						</span>
					</div>
					<div className="flex items-center gap-6">
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Rows per page</span>
							<Select
								value={String(pagination.pageSize)}
								onValueChange={(value) => {
									setPagination((prev) => ({
										...prev,
										pageSize: Number(value),
										pageIndex: 0,
									}));
								}}
							>
								<SelectTrigger className="h-8 w-[70px]">
									<SelectValue placeholder={String(pagination.pageSize)} />
								</SelectTrigger>
								<SelectContent side="top">
									{[10, 20, 30, 50, 100].map((size) => (
										<SelectItem key={size} value={String(size)}>
											{size}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">
								Page {pagination.pageIndex + 1} of {table.getPageCount()}
							</span>
							<div className="flex items-center gap-1">
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => table.firstPage()}
									disabled={!table.getCanPreviousPage()}
								>
									<ChevronsLeft className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => table.previousPage()}
									disabled={!table.getCanPreviousPage()}
								>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => table.nextPage()}
									disabled={!table.getCanNextPage()}
								>
									<ChevronRight className="h-4 w-4" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									className="h-8 w-8"
									onClick={() => table.lastPage()}
									disabled={!table.getCanNextPage()}
								>
									<ChevronsRight className="h-4 w-4" />
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

// Loading skeleton
const SKELETON_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5"];

function IncidentTableSkeleton() {
	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[80px]">#</TableHead>
						<TableHead>Title</TableHead>
						<TableHead className="w-[100px]">Severity</TableHead>
						<TableHead className="w-[100px]">Priority</TableHead>
						<TableHead className="w-[120px]">Status</TableHead>
						<TableHead className="w-[120px]">Service</TableHead>
						<TableHead className="w-[60px]">Inv</TableHead>
						<TableHead className="w-[80px]">Alerts</TableHead>
						<TableHead className="w-[100px]">Triggered</TableHead>
						<TableHead className="w-[120px]" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{SKELETON_ROWS.map((rowKey) => (
						<TableRow key={rowKey}>
							<TableCell>
								<Skeleton className="h-4 w-12" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-64 mb-1" />
								<Skeleton className="h-3 w-48" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-16" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-12" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-20" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-24" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-8" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-8" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-4 w-16" />
							</TableCell>
							<TableCell>
								<div className="flex justify-end gap-1">
									<Skeleton className="h-8 w-8" />
									<Skeleton className="h-8 w-8" />
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
