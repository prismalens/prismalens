// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Service Card Component
 *
 * Displays a service in a card format with linked sources
 */

import type { ServiceWithRelations } from "@prismalens/contracts";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, GitBranch } from "lucide-react";
import { Mono } from "@/components/shared/Mono";
import { type ChipTone, StateChip } from "@/components/shared/StateChip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { serviceTypeIcons } from "./service-detail.utils";

export interface ServiceCardProps {
	service: ServiceWithRelations;
}

const tierTones: Record<string, ChipTone> = {
	tier_1: "critical",
	tier_2: "high",
	tier_3: "medium",
	tier_4: "neutral",
};

const tierLabels: Record<string, string> = {
	tier_1: "Tier 1",
	tier_2: "Tier 2",
	tier_3: "Tier 3",
	tier_4: "Tier 4",
};

export function ServiceCard({ service }: ServiceCardProps) {
	const typeIcon = serviceTypeIcons[service.type] || serviceTypeIcons.service;
	const repos = service.repositories ?? [];

	return (
		<Card className="hover:border-primary/50 transition-colors">
			<CardHeader className="pb-3">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-muted">{typeIcon}</div>
						<div>
							<CardTitle className="text-base">
								<Link
									to="/services/$id"
									params={{ id: service.id }}
									search={{ tab: "overview" }}
									className="hover:text-primary hover:underline"
								>
									{service.displayName || service.name}
								</Link>
							</CardTitle>
							<Mono className="text-record text-muted-foreground block">
								{service.name}
							</Mono>
						</div>
					</div>
					<div className="flex flex-col items-end gap-1">
						<StateChip tone={tierTones[service.tier] || "neutral"}>
							{tierLabels[service.tier] || service.tier}
						</StateChip>
						<StateChip tone="neutral" className="capitalize">
							{service.type}
						</StateChip>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Description */}
				{service.description && (
					<p className="text-record text-muted-foreground line-clamp-2">
						{service.description}
					</p>
				)}

				{/* Sources */}
				{repos.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{repos.map((sr) => (
							<span
								key={sr.id}
								className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground"
							>
								<span>🔗</span>
								<Mono>{sr.repository.fullName}</Mono>
							</span>
						))}
					</div>
				)}

				{/* Stats Row */}
				<div className="flex items-center gap-4 text-sm">
					{service.alertCount !== undefined && service.alertCount > 0 && (
						<div className="flex items-center gap-1 text-stale">
							<AlertTriangle className="h-4 w-4" />
							<span>{service.alertCount} alerts</span>
						</div>
					)}
					{service.incidentCount !== undefined && service.incidentCount > 0 && (
						<div className="flex items-center gap-1 text-run-failed">
							<AlertTriangle className="h-4 w-4" />
							<span>{service.incidentCount} incidents</span>
						</div>
					)}
					{service.dependencies && service.dependencies.length > 0 && (
						<div className="flex items-center gap-1 text-muted-foreground">
							<GitBranch className="h-4 w-4" />
							<span>{service.dependencies.length} deps</span>
						</div>
					)}
				</div>

				{/* Tags */}
				{service.tags && service.tags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{service.tags.slice(0, 3).map((tag) => (
							<Badge key={tag} variant="secondary" className="text-xs">
								{tag}
							</Badge>
						))}
						{service.tags.length > 3 && (
							<Badge variant="secondary" className="text-xs">
								+{service.tags.length - 3}
							</Badge>
						)}
					</div>
				)}

				{/* Meta */}
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<div className="flex items-center gap-2">
						{service.team && <span>Team: {service.team}</span>}
					</div>
					<Button variant="ghost" size="sm" asChild>
						<Link
							to="/services/$id"
							params={{ id: service.id }}
							search={{ tab: "overview" }}
						>
							View
						</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
