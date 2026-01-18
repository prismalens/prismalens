"use client";

import { useState } from "react";
import type {
	TimelineEntryType,
	TimelineEntryWithRelations,
	TimelineSource,
} from "@prismalens/contracts";
import { format, isToday, isYesterday } from "date-fns";
import { ClipboardList, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AddTimelineEntryDialog } from "./AddTimelineEntryDialog";
import { TimelineEntry } from "./TimelineEntry";

export interface TimelineTabProps {
	incidentId: string;
	entries: TimelineEntryWithRelations[];
	isLoading?: boolean;
	onCreateEntry?: (entry: {
		title: string;
		description?: string;
		type: TimelineEntryType;
	}) => void;
	isCreating?: boolean;
	className?: string;
}

type TypeFilter = TimelineEntryType | "all";
type SourceFilter = TimelineSource | "all";

const typeFilterOptions: { value: TypeFilter; label: string }[] = [
	{ value: "all", label: "All Types" },
	{ value: "incident_created", label: "Incident Created" },
	{ value: "status_changed", label: "Status Changes" },
	{ value: "alert_added", label: "Alerts Added" },
	{ value: "investigation_started", label: "Investigation Started" },
	{ value: "investigation_completed", label: "Investigation Completed" },
	{ value: "recommendation_added", label: "Recommendations" },
	{ value: "comment", label: "Comments" },
	{ value: "custom", label: "Custom" },
];

const sourceFilterOptions: { value: SourceFilter; label: string }[] = [
	{ value: "all", label: "All Sources" },
	{ value: "system", label: "System" },
	{ value: "user", label: "User" },
	{ value: "ai_worker", label: "AI" },
];

function formatDateHeader(dateString: string): string {
	const date = new Date(dateString);
	if (isToday(date)) return "Today";
	if (isYesterday(date)) return "Yesterday";
	return format(date, "MMMM d, yyyy");
}

function groupEntriesByDate(
	entries: TimelineEntryWithRelations[]
): Map<string, TimelineEntryWithRelations[]> {
	const grouped = new Map<string, TimelineEntryWithRelations[]>();

	for (const entry of entries) {
		const dateKey = format(new Date(entry.occurredAt), "yyyy-MM-dd");
		const existing = grouped.get(dateKey) || [];
		existing.push(entry);
		grouped.set(dateKey, existing);
	}

	return grouped;
}

export function TimelineTab({
	incidentId,
	entries,
	isLoading,
	onCreateEntry,
	isCreating,
	className,
}: TimelineTabProps) {
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	// Apply filters
	const filteredEntries = entries.filter((entry) => {
		if (typeFilter !== "all" && entry.type !== typeFilter) return false;
		if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
		return true;
	});

	// Sort by occurredAt descending (most recent first)
	const sortedEntries = [...filteredEntries].sort(
		(a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
	);

	// Group by date
	const groupedEntries = groupEntriesByDate(sortedEntries);

	const handleCreateEntry = (data: {
		title: string;
		description?: string;
		type: TimelineEntryType;
	}) => {
		onCreateEntry?.(data);
		setIsDialogOpen(false);
	};

	if (isLoading) {
		return (
			<div className={cn("space-y-4", className)}>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Skeleton className="h-9 w-32" />
						<Skeleton className="h-9 w-32" />
					</div>
					<Skeleton className="h-9 w-28" />
				</div>
				<div className="space-y-4">
					{[1, 2, 3, 4].map((i) => (
						<div key={i} className="flex gap-4 animate-pulse">
							<div className="flex flex-col items-center">
								<Skeleton className="w-12 h-4" />
								<Skeleton className="w-8 h-8 rounded-full mt-2" />
							</div>
							<div className="flex-1 space-y-2">
								<Skeleton className="h-5 w-3/4" />
								<Skeleton className="h-4 w-1/2" />
							</div>
						</div>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className={cn("space-y-4", className)}>
			{/* Filters and Add Button */}
			<div className="flex items-center justify-between gap-4 flex-wrap">
				<div className="flex items-center gap-2">
					<Select
						value={typeFilter}
						onValueChange={(v) => setTypeFilter(v as TypeFilter)}
					>
						<SelectTrigger className="w-[160px]">
							<SelectValue placeholder="Filter by type" />
						</SelectTrigger>
						<SelectContent>
							{typeFilterOptions.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select
						value={sourceFilter}
						onValueChange={(v) => setSourceFilter(v as SourceFilter)}
					>
						<SelectTrigger className="w-[140px]">
							<SelectValue placeholder="Filter by source" />
						</SelectTrigger>
						<SelectContent>
							{sourceFilterOptions.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{onCreateEntry && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => setIsDialogOpen(true)}
					>
						<Plus className="w-4 h-4 mr-1" />
						Add Entry
					</Button>
				)}
			</div>

			{/* Timeline Entries */}
			{sortedEntries.length === 0 ? (
				<div className="flex flex-col items-center justify-center py-12 text-center">
					<ClipboardList className="w-12 h-12 text-muted-foreground mb-4" />
					<h3 className="text-lg font-medium">No activity yet</h3>
					<p className="text-sm text-muted-foreground max-w-sm mt-1">
						Timeline entries will appear here as the incident progresses.
						System events, investigation updates, and user actions are all
						recorded automatically.
					</p>
					{onCreateEntry && (
						<Button
							variant="outline"
							className="mt-4"
							onClick={() => setIsDialogOpen(true)}
						>
							<Plus className="w-4 h-4 mr-1" />
							Add Entry
						</Button>
					)}
				</div>
			) : (
				<div className="space-y-6">
					{Array.from(groupedEntries.entries()).map(([dateKey, dayEntries]) => (
						<div key={dateKey}>
							<h3 className="text-sm font-medium text-muted-foreground mb-3 sticky top-0 bg-background py-1">
								{formatDateHeader(dayEntries[0].occurredAt)}
							</h3>
							<div className="border-l-2 border-border pl-4 ml-3">
								{dayEntries.map((entry) => (
									<TimelineEntry
										key={entry.id}
										id={entry.id}
										type={entry.type}
										title={entry.title}
										description={entry.description}
										source={entry.source}
										occurredAt={entry.occurredAt}
										user={entry.user}
									/>
								))}
							</div>
						</div>
					))}
				</div>
			)}

			{/* Add Entry Dialog */}
			<AddTimelineEntryDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				onSubmit={handleCreateEntry}
				isSubmitting={isCreating}
			/>
		</div>
	);
}
