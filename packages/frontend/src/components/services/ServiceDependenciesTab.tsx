// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Link } from "@tanstack/react-router";
import { Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { Mono } from "@/components/shared/Mono";
import { StateChip } from "@/components/shared/StateChip";
import { Button } from "@/components/ui/button";
import { DependencyEditor } from "./DependencyEditor";
import { serviceTypeIcons } from "./service-detail.utils";

interface ServiceDependenciesTabProps {
	serviceId: string;
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
	onRemoveDependency: (depId: string) => void;
	onRefresh?: () => void;
}

export function ServiceDependenciesTab({
	serviceId,
	topology,
	onRemoveDependency,
	onRefresh,
}: ServiceDependenciesTabProps) {
	const [editorState, setEditorState] = useState<{
		mode: "add" | "edit";
		dep?: {
			dependencyId: string;
			name: string;
			type: string;
			criticality: string;
		};
	} | null>(null);

	const existingUpstreamIds =
		topology?.upstream?.map((e) => e.service.id) ?? [];

	return (
		<div className="space-y-6">
			{/* Upstream Dependencies */}
			<div>
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-sm font-medium">
						Upstream Dependencies ({topology?.upstream?.length ?? 0})
					</h3>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setEditorState({ mode: "add" })}
					>
						<Plus className="h-4 w-4 mr-1" />
						Add Dependency
					</Button>
				</div>

				{editorState && (
					<DependencyEditor
						mode={editorState.mode}
						serviceId={serviceId}
						dependency={editorState.dep}
						existingDependencyIds={existingUpstreamIds}
						onSuccess={() => {
							setEditorState(null);
							onRefresh?.();
						}}
						onCancel={() => setEditorState(null)}
					/>
				)}

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
										<StateChip tone="neutral">{edge.dependencyType}</StateChip>
										<StateChip
											tone={
												edge.criticality === "required"
													? "critical"
													: edge.criticality === "degraded"
														? "medium"
														: "neutral"
											}
										>
											{edge.criticality}
										</StateChip>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 w-7 p-0"
											onClick={() =>
												setEditorState({
													mode: "edit",
													dep: {
														dependencyId: edge.service.id,
														name: edge.service.displayName || edge.service.name,
														type: edge.dependencyType,
														criticality: edge.criticality,
													},
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
						<p className="p-4 text-record text-muted-foreground text-center">
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
										<StateChip tone="neutral">{edge.dependencyType}</StateChip>
										<StateChip
											tone={
												edge.criticality === "required"
													? "critical"
													: edge.criticality === "degraded"
														? "medium"
														: "neutral"
											}
										>
											{edge.criticality}
										</StateChip>
									</div>
								</div>
							))}
						</div>
					) : (
						<p className="p-4 text-record text-muted-foreground text-center">
							No downstream dependents
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
