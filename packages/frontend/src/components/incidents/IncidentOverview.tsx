// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Incident Overview Component
 *
 * Shows key incident metrics and information in cards
 */

import type {
	IncidentWithRelations,
	TimelineEntryWithRelations,
} from "@prismalens/contracts";
import { AlertTriangle, Clock, Tag, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimelinePreview } from "./TimelinePreview";

export interface IncidentOverviewProps {
	incident: IncidentWithRelations;
	timelineEntries?: TimelineEntryWithRelations[];
	timelineLoading?: boolean;
	onViewTimeline?: () => void;
}

function formatDuration(ms: number | null): string {
	if (!ms) return "N/A";
	const minutes = Math.floor(ms / 60000);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) return `${days}d ${hours % 24}h`;
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	return `${minutes}m`;
}

export function IncidentOverview({
	incident,
	timelineEntries = [],
	timelineLoading,
	onViewTimeline,
}: IncidentOverviewProps) {
	const isActive = !["resolved", "closed"].includes(incident.status);
	const duration = isActive
		? Date.now() - new Date(incident.triggeredAt).getTime()
		: incident.timeToResolve;

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
			{/* Duration Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">
						{isActive ? "Duration" : "Time to Resolve"}
					</CardTitle>
					<Clock className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{formatDuration(duration)}</div>
					{incident.timeToAcknowledge && (
						<p className="text-xs text-muted-foreground">
							TTAck: {formatDuration(incident.timeToAcknowledge)}
						</p>
					)}
				</CardContent>
			</Card>

			{/* Alert Count Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Alerts</CardTitle>
					<AlertTriangle className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					<div className="text-2xl font-bold">{incident.alertCount}</div>
					<p className="text-xs text-muted-foreground">Correlated alerts</p>
				</CardContent>
			</Card>

			{/* Assignee Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Assigned To</CardTitle>
					<Users className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					{incident.assignedTo ? (
						<>
							<div className="text-lg font-bold">
								{incident.assignedTo.firstName} {incident.assignedTo.lastName}
							</div>
							<p className="text-xs text-muted-foreground">
								{incident.assignedTo.email}
							</p>
						</>
					) : (
						<div className="text-lg text-muted-foreground">Unassigned</div>
					)}
				</CardContent>
			</Card>

			{/* Tags Card */}
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
					<CardTitle className="text-sm font-medium">Tags</CardTitle>
					<Tag className="h-4 w-4 text-muted-foreground" />
				</CardHeader>
				<CardContent>
					{incident.tags && incident.tags.length > 0 ? (
						<div className="flex flex-wrap gap-1">
							{incident.tags.map((tag) => (
								<Badge key={tag} variant="secondary" className="text-xs">
									{tag}
								</Badge>
							))}
						</div>
					) : (
						<div className="text-sm text-muted-foreground">No tags</div>
					)}
				</CardContent>
			</Card>

			{/* Customer Impact - Full Width */}
			{incident.customerImpact && (
				<Card className="md:col-span-2 lg:col-span-4">
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Customer Impact
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm">{incident.customerImpact}</p>
					</CardContent>
				</Card>
			)}

			{/* Affected Systems */}
			{incident.affectedSystems && incident.affectedSystems.length > 0 && (
				<Card className="md:col-span-2 lg:col-span-4">
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Affected Systems
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="flex flex-wrap gap-2">
							{incident.affectedSystems.map((system) => (
								<Badge key={system} variant="outline">
									{system}
								</Badge>
							))}
						</div>
					</CardContent>
				</Card>
			)}

			{/* Correlation Reason */}
			{incident.correlationReason && (
				<Card className="md:col-span-2 lg:col-span-4">
					<CardHeader>
						<CardTitle className="text-sm font-medium">
							Correlation Reason
						</CardTitle>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							{incident.correlationReason}
						</p>
					</CardContent>
				</Card>
			)}

			{/* Timeline Preview */}
			<TimelinePreview
				entries={timelineEntries}
				totalCount={timelineEntries.length}
				onViewAll={onViewTimeline}
				isLoading={timelineLoading}
				className="md:col-span-2 lg:col-span-4"
			/>
		</div>
	);
}
