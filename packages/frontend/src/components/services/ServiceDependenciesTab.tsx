import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { serviceTypeIcons } from "./service-detail.utils";

interface ServiceDependenciesTabProps {
	topology?: {
		upstream: Array<{
			service: {
				id: string;
				name: string;
				displayName?: string | null;
				type: string;
			};
			dependencyType: string;
			criticality: string;
		}>;
		downstream: Array<{
			service: {
				id: string;
				name: string;
				displayName?: string | null;
				type: string;
			};
			dependencyType: string;
			criticality: string;
		}>;
	};
	onAddDependency: () => void;
	onEditDependency: (dep: {
		dependencyId: string;
		name: string;
		type: string;
		criticality: string;
	}) => void;
	onRemoveDependency: (depId: string) => void;
}

export function ServiceDependenciesTab({
	topology,
	onAddDependency,
	onEditDependency,
	onRemoveDependency,
}: ServiceDependenciesTabProps) {
	return (
		<div className="space-y-6">
			{/* Upstream Dependencies */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-medium">
						Upstream Dependencies ({topology?.upstream?.length ?? 0})
					</h3>
					<Button size="sm" variant="outline" onClick={onAddDependency}>
						<Plus className="h-4 w-4 mr-1" />
						Add Dependency
					</Button>
				</div>
				<div className="max-h-96 overflow-y-auto rounded-md border">
					{topology?.upstream && topology.upstream.length > 0 ? (
						<div className="divide-y">
							{topology.upstream.map((edge) => (
								<div
									key={edge.service.id}
									className="flex items-center justify-between p-3 hover:bg-muted/50"
								>
									<Link
										to="/services/$id"
										params={{ id: edge.service.id }}
										search={{ tab: "overview" }}
										className="flex items-center gap-2 min-w-0 flex-1"
									>
										<div className="p-1 rounded bg-muted flex-shrink-0">
											{serviceTypeIcons[edge.service.type] || (
												<Server className="h-4 w-4" />
											)}
										</div>
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">
												{edge.service.displayName || edge.service.name}
											</p>
											<p className="text-xs text-muted-foreground capitalize">
												{edge.service.type}
											</p>
										</div>
									</Link>
									<div className="flex items-center gap-2 flex-shrink-0">
										<Badge variant="outline" className="text-xs">
											{edge.dependencyType}
										</Badge>
										<Badge variant="secondary" className="text-xs">
											{edge.criticality}
										</Badge>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0"
											onClick={() =>
												onEditDependency({
													dependencyId: edge.service.id,
													name: edge.service.displayName || edge.service.name,
													type: edge.dependencyType,
													criticality: edge.criticality,
												})
											}
										>
											<Pencil className="h-3 w-3" />
										</Button>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0 text-destructive hover:text-destructive"
											onClick={() => onRemoveDependency(edge.service.id)}
										>
											<Trash2 className="h-3 w-3" />
										</Button>
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="p-4 text-sm text-muted-foreground text-center">
							No upstream dependencies
						</p>
					)}
				</div>
			</div>

			{/* Downstream Dependents */}
			<div>
				<h3 className="text-sm font-medium mb-3">
					Downstream Dependents ({topology?.downstream?.length ?? 0})
				</h3>
				<div className="max-h-96 overflow-y-auto rounded-md border">
					{topology?.downstream && topology.downstream.length > 0 ? (
						<div className="divide-y">
							{topology.downstream.map((edge) => (
								<div
									key={edge.service.id}
									className="flex items-center justify-between p-3 hover:bg-muted/50"
								>
									<Link
										to="/services/$id"
										params={{ id: edge.service.id }}
										search={{ tab: "overview" }}
										className="flex items-center gap-2 min-w-0 flex-1"
									>
										<div className="p-1 rounded bg-muted flex-shrink-0">
											{serviceTypeIcons[edge.service.type] || (
												<Server className="h-4 w-4" />
											)}
										</div>
										<div className="min-w-0">
											<p className="font-medium text-sm truncate">
												{edge.service.displayName || edge.service.name}
											</p>
											<p className="text-xs text-muted-foreground capitalize">
												{edge.service.type}
											</p>
										</div>
									</Link>
									<div className="flex items-center gap-2 flex-shrink-0">
										<Badge variant="outline" className="text-xs">
											{edge.dependencyType}
										</Badge>
										<Badge variant="secondary" className="text-xs">
											{edge.criticality}
										</Badge>
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="p-4 text-sm text-muted-foreground text-center">
							No downstream dependents
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
