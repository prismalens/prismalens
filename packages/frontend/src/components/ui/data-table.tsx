"use client";

import {
	type ColumnDef,
	type SortingState,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface DataTableProps<TData, TValue> {
	columns: ColumnDef<TData, TValue>[];
	data: TData[];
	isLoading?: boolean;
	skeletonRows?: number;
	emptyMessage?: string;
	emptyState?: React.ReactNode;
	onRowClick?: (row: TData) => void;
	enableSorting?: boolean;
	enablePagination?: boolean;
	pageSize?: number;
}

export function DataTable<TData, TValue>({
	columns,
	data,
	isLoading,
	skeletonRows = 5,
	emptyMessage = "No results.",
	emptyState,
	onRowClick,
	enableSorting = false,
	enablePagination = false,
	pageSize = 20,
}: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([]);

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		...(enableSorting
			? {
					getSortedRowModel: getSortedRowModel(),
					onSortingChange: setSorting,
					state: { sorting },
				}
			: {}),
		...(enablePagination
			? {
					getPaginationRowModel: getPaginationRowModel(),
					initialState: { pagination: { pageSize } },
				}
			: {}),
	});

	return (
		<div className="space-y-2">
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										className={
											enableSorting &&
											header.column.getCanSort()
												? "cursor-pointer select-none"
												: undefined
										}
										onClick={
											enableSorting
												? header.column.getToggleSortingHandler()
												: undefined
										}
									>
										{header.isPlaceholder
											? null
											: flexRender(
													header.column.columnDef.header,
													header.getContext(),
												)}
										{enableSorting &&
											({
												asc: " \u2191",
												desc: " \u2193",
											}[
												header.column.getIsSorted() as string
											] ?? null)}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{isLoading ? (
							Array.from({ length: skeletonRows }).map((_, i) => (
								<TableRow key={`skeleton-${i}`}>
									{columns.map((_, j) => (
										<TableCell key={`skeleton-${i}-${j}`}>
											<Skeleton className="h-4 w-full" />
										</TableCell>
									))}
								</TableRow>
							))
						) : table.getRowModel().rows?.length ? (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									data-state={
										row.getIsSelected() && "selected"
									}
									className={
										onRowClick
											? "cursor-pointer"
											: undefined
									}
									onClick={() =>
										onRowClick?.(row.original)
									}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))
						) : emptyState ? (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center"
								>
									{emptyState}
								</TableCell>
							</TableRow>
						) : (
							<TableRow>
								<TableCell
									colSpan={columns.length}
									className="h-24 text-center text-muted-foreground"
								>
									{emptyMessage}
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{enablePagination && table.getPageCount() > 1 && (
				<div className="flex items-center justify-between px-2">
					<p className="text-sm text-muted-foreground">
						Page {table.getState().pagination.pageIndex + 1} of{" "}
						{table.getPageCount()}
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.nextPage()}
							disabled={!table.getCanNextPage()}
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
