/**
 * Service Card Component
 *
 * Displays a service in a card format with linked sources
 */

import { Link } from "@tanstack/react-router";
import type { ServiceWithRelations } from "@prismalens/contracts";
import {
	AlertTriangle,
	Box,
	Database,
	ExternalLink,
	GitBranch,
	Globe,
	Server,
	Zap,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface ServiceCardProps {
	service: ServiceWithRelations;
}

const serviceTypeIcons: Record<string, React.ReactNode> = {
	service: <Server className="h-5 w-5" />,
	database: <Database className="h-5 w-5" />,
	queue: <Zap className="h-5 w-5" />,
	cache: <Box className="h-5 w-5" />,
	gateway: <Globe className="h-5 w-5" />,
	external: <ExternalLink className="h-5 w-5" />,
	infrastructure: <Server className="h-5 w-5" />,
};

const tierColors: Record<string, string> = {
	tier_1: "bg-red-500 text-white",
	tier_2: "bg-orange-500 text-white",
	tier_3: "bg-yellow-500 text-black",
	tier_4: "bg-gray-500 text-white",
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
	const deployments = service.deployments ?? [];

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
							<p className="text-sm text-muted-foreground font-mono">
								{service.name}
							</p>
						</div>
					</div>
					<div className="flex flex-col items-end gap-1">
						<Badge className={tierColors[service.tier] || "bg-gray-500"}>
							{tierLabels[service.tier] || service.tier}
						</Badge>
						<Badge variant="outline" className="text-xs capitalize">
							{service.type}
						</Badge>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{/* Description */}
				{service.description && (
					<p className="text-sm text-muted-foreground line-clamp-2">
						{service.description}
					</p>
				)}

				{/* Sources */}
				{(repos.length > 0 || deployments.length > 0) && (
					<div className="flex flex-wrap gap-1">
						{repos.map((sr) => (
							<Badge key={sr.id} variant="secondary" className="text-xs">
								🔗 {sr.repository.fullName}
							</Badge>
						))}
						{deployments.map((dep) => (
							<Badge key={dep.id} variant="secondary" className="text-xs">
								🚀 {dep.name}
								{dep.status && (
									<span className="ml-1 opacity-70">({dep.status})</span>
								)}
							</Badge>
						))}
					</div>
				)}

				{/* Stats Row */}
				<div className="flex items-center gap-4 text-sm">
					{service.alertCount !== undefined && service.alertCount > 0 && (
						<div className="flex items-center gap-1 text-orange-500">
							<AlertTriangle className="h-4 w-4" />
							<span>{service.alertCount} alerts</span>
						</div>
					)}
					{service.incidentCount !== undefined && service.incidentCount > 0 && (
						<div className="flex items-center gap-1 text-red-500">
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
						<Link to="/services/$id" params={{ id: service.id }} search={{ tab: "overview" }}>
							View
						</Link>
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
