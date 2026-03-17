"use client";

import { useState, type ReactNode } from "react";
import {
	AlertTriangle,
	ChevronRight,
	FolderGit2,
	Server,
	Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const INLINE_THRESHOLD = 3;
const EXPANDED_LIMIT = 10;

interface ImpactLineProps {
	icon: ReactNode;
	count: number;
	singular: string;
	plural: string;
	items: Array<{ id: string; label: string; badge?: string }>;
}

/**
 * Adaptive impact line:
 * - <= 3 items: show names inline (no expand needed)
 * - > 3 items: show count + expandable detail toggle
 */
function ImpactLine({ icon, count, singular, plural, items }: ImpactLineProps) {
	const [expanded, setExpanded] = useState(false);
	const isSmall = count <= INLINE_THRESHOLD;

	return (
		<div className="space-y-1">
			{isSmall ? (
				<div className="space-y-0.5">
					{items.map((item) => (
						<div
							key={item.id}
							className="flex items-center gap-2 text-xs text-muted-foreground"
						>
							<span className="flex-shrink-0 text-foreground">{icon}</span>
							<span>{item.label}</span>
							{item.badge && (
								<Badge variant="outline" className="text-xs px-1 py-0">
									{item.badge}
								</Badge>
							)}
						</div>
					))}
				</div>
			) : (
				<>
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
						className="flex items-center gap-1.5 font-medium text-sm hover:text-foreground/80 transition-colors w-full text-left"
					>
						<span className="flex-shrink-0">{icon}</span>
						<span>
							{count} {count === 1 ? singular : plural}
						</span>
						<ChevronRight
							className={cn(
								"h-3 w-3 ml-auto transition-transform",
								expanded && "rotate-90",
							)}
						/>
					</button>
					{expanded && (
						<div className="ml-5 text-muted-foreground text-xs space-y-0.5">
							{items.slice(0, EXPANDED_LIMIT).map((item) => (
								<div key={item.id} className="flex items-center gap-2">
									<span>{item.label}</span>
									{item.badge && (
										<Badge variant="outline" className="text-xs px-1 py-0">
											{item.badge}
										</Badge>
									)}
								</div>
							))}
							{count > EXPANDED_LIMIT && (
								<div className="text-muted-foreground/70">
									and {count - EXPANDED_LIMIT} more...
								</div>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}

interface DeletionImpactSectionProps {
	impact: {
		connections: Array<{ id: string; label: string }>;
		repositories: Array<{ id: string; fullName: string }>;
		deployments: Array<{ id: string; name: string }>;
		affectedServices: Array<{
			id: string;
			name: string;
			impact: string;
		}>;
		suggestionsCount: number;
	};
	showConnections?: boolean;
}

export function DeletionImpactSection({
	impact,
	showConnections = true,
}: DeletionImpactSectionProps) {
	const hasResources =
		impact.repositories.length > 0 ||
		impact.deployments.length > 0 ||
		impact.affectedServices.length > 0;

	return (
		<div className="space-y-2 py-2 text-sm">
			{showConnections && impact.connections.length > 0 && (
				<div className="text-sm font-medium">
					{impact.connections.length} connection
					{impact.connections.length !== 1 ? "s" : ""}
				</div>
			)}

			{impact.repositories.length > 0 && (
				<ImpactLine
					icon={<FolderGit2 className="h-3 w-3" />}
					count={impact.repositories.length}
					singular="repository"
					plural="repositories"
					items={impact.repositories.map((r) => ({
						id: r.id,
						label: r.fullName,
					}))}
				/>
			)}

			{impact.deployments.length > 0 && (
				<ImpactLine
					icon={<Zap className="h-3 w-3" />}
					count={impact.deployments.length}
					singular="deployment"
					plural="deployments"
					items={impact.deployments.map((d) => ({
						id: d.id,
						label: d.name,
					}))}
				/>
			)}

			{impact.suggestionsCount > 0 && (
				<div className="text-sm">
					{impact.suggestionsCount} pending suggestion
					{impact.suggestionsCount !== 1 ? "s" : ""}
				</div>
			)}

			{impact.affectedServices.length > 0 && (
				<ImpactLine
					icon={<Server className="h-3 w-3" />}
					count={impact.affectedServices.length}
					singular="service affected"
					plural="services affected"
					items={impact.affectedServices.map((s) => ({
						id: `${s.id}-${s.impact}`,
						label: s.name,
						badge: s.impact.replace(/_/g, " "),
					}))}
				/>
			)}

			{hasResources && (
				<div className="flex items-center gap-2 text-destructive text-xs pt-1">
					<AlertTriangle className="h-3 w-3 flex-shrink-0" />
					This action cannot be undone.
				</div>
			)}
		</div>
	);
}
