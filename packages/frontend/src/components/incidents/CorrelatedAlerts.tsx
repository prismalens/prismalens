/**
 * Correlated Alerts Component
 *
 * Shows alerts that are linked to the incident
 */

import { Link } from "@tanstack/react-router";
import type { AlertWithRelations } from "@prismalens/contracts";
import { formatDistanceToNow } from "date-fns";
import { Bell } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";

export interface CorrelatedAlertsProps {
	alerts: AlertWithRelations[];
	onAcknowledge?: (alertId: string) => void;
}

export function CorrelatedAlerts({ alerts, onAcknowledge }: CorrelatedAlertsProps) {
	if (alerts.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
					<Bell className="h-12 w-12 mb-4 opacity-50" />
					<p className="text-lg font-medium">No correlated alerts</p>
					<p className="text-sm">Alerts will appear here when they are correlated to this incident</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="text-sm text-muted-foreground">
				{alerts.length} alert{alerts.length !== 1 ? "s" : ""} correlated to this incident
			</div>

			<div className="grid gap-3">
				{alerts.map((alert) => (
					<Card key={alert.id}>
						<CardHeader className="pb-2">
							<div className="flex items-start justify-between">
								<div className="space-y-1">
									<CardTitle className="text-base font-medium">
										{alert.title}
									</CardTitle>
									{alert.description && (
										<p className="text-sm text-muted-foreground line-clamp-2">
											{alert.description}
										</p>
									)}
								</div>
								<div className="flex items-center gap-2">
									<SeverityBadge severity={alert.severity} />
									<StatusBadge status={alert.status} />
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4 text-sm text-muted-foreground">
									{alert.service && (
										<Link
											to="/services/$id"
											params={{ id: alert.service.id }}
											search={{ tab: "overview" }}
											className="hover:text-primary"
										>
											{alert.service.displayName || alert.service.name}
										</Link>
									)}
									<span>
										{formatDistanceToNow(new Date(alert.triggeredAt), { addSuffix: true })}
									</span>
									{alert.source && <span>Source: {alert.source}</span>}
								</div>
								<div className="flex items-center gap-2">
									{alert.status === "triggered" && onAcknowledge && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => onAcknowledge(alert.id)}
										>
											Acknowledge
										</Button>
									)}
								</div>
							</div>
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
