// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import {
	enumOptions,
	TIMELINE_ENTRY_TYPE_LABEL,
	TIMELINE_SOURCE_LABEL,
	type TimelineEntryType,
	TimelineEntryTypeSchema,
	type TimelineEntryWithRelations,
	type TimelineSource,
	TimelineSourceSchema,
} from "@prismalens/contracts";
import { format, isToday, isYesterday } from "date-fns";
import { useState } from "react";
import { Empty, Loading } from "@/components/shared/State";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { groupTimeline, type InvestigationRef } from "@/lib/timeline-groups";
import { cn } from "@/lib/utils";
import { TimelineList } from "./TimelineList";

export interface TimelineTabProps {
	incidentId: string;
	entries: TimelineEntryWithRelations[];
	/** The incident's investigations, newest first; their entries fold into one row each. */
	runs?: InvestigationRef[];
	isLoading?: boolean;
	className?: string;
}

type TypeFilter = TimelineEntryType | "all";
type SourceFilter = TimelineSource | "all";

const typeFilterOptions: { value: TypeFilter; label: string }[] = [
	{ value: "all", label: "All types" },
	...enumOptions(TimelineEntryTypeSchema, TIMELINE_ENTRY_TYPE_LABEL),
];

const sourceFilterOptions: { value: SourceFilter; label: string }[] = [
	{ value: "all", label: "All sources" },
	...enumOptions(TimelineSourceSchema, TIMELINE_SOURCE_LABEL),
];

function formatDateHeader(dateString: string): string {
	const date = new Date(dateString);
	if (isToday(date)) return "Today";
	if (isYesterday(date)) return "Yesterday";
	return format(date, "MMMM d, yyyy");
}

function groupEntriesByDate(
	entries: TimelineEntryWithRelations[],
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
	runs = [],
	isLoading,
	className,
}: TimelineTabProps) {
	const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
	const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

	// Apply filters
	const filteredEntries = entries.filter((entry) => {
		if (typeFilter !== "all" && entry.type !== typeFilter) return false;
		if (sourceFilter !== "all" && entry.source !== sourceFilter) return false;
		return true;
	});

	// Sort by occurredAt descending (most recent first)
	const sortedEntries = [...filteredEntries].sort(
		(a, b) =>
			new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
	);

	// Group by date
	const groupedEntries = groupEntriesByDate(sortedEntries);

	if (isLoading) return <Loading rows={6} className={className} />;

	return (
		<div className={cn("space-y-4", className)}>
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex items-center gap-2">
					<Select
						value={typeFilter}
						onValueChange={(v) => setTypeFilter(v as TypeFilter)}
					>
						<SelectTrigger aria-label="Type">
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
						<SelectTrigger aria-label="Source">
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
			</div>

			{/* Timeline Entries */}
			{sortedEntries.length === 0 ? (
				<Empty
					text={
						entries.length === 0
							? "Nothing recorded yet. Status changes, runs, alerts and your notes land here."
							: "Nothing matches these filters."
					}
				/>
			) : (
				<div className="space-y-4">
					{Array.from(groupedEntries.entries()).map(([dateKey, dayEntries]) => (
						<section key={dateKey}>
							<h3 className="sticky top-0 z-[1] bg-canvas py-1 text-meta font-medium text-text-3">
								{formatDateHeader(dayEntries[0].occurredAt)}
							</h3>
							<TimelineList items={groupTimeline(dayEntries, runs)} full />
						</section>
					))}
				</div>
			)}
		</div>
	);
}
