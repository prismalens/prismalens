// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import type { DeletionImpact } from "@prismalens/contracts";
import { ChevronRight, FolderGit2, Server } from "lucide-react";
import { type ReactNode, useState } from "react";
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
							className="flex items-center gap-2 text-meta text-text-1"
						>
							<span className="shrink-0 text-text-3">{icon}</span>
							<span>{item.label}</span>
							{item.badge && <span className="text-text-3">{item.badge}</span>}
						</div>
					))}
				</div>
			) : (
				<>
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded((v) => !v)}
						className="flex w-full items-center gap-1.5 text-left text-body text-text-1"
					>
						<span className="flex-shrink-0">{icon}</span>
						<span>
							{count} {count === 1 ? singular : plural}
						</span>
						<ChevronRight
							className={cn(
								"ml-auto size-3 text-text-3 transition-transform duration-(--dur-fast)",
								expanded && "rotate-90",
							)}
						/>
					</button>
					{expanded && (
						<div className="ml-5 space-y-0.5 text-meta text-text-2">
							{items.slice(0, EXPANDED_LIMIT).map((item) => (
								<div key={item.id} className="flex items-center gap-2">
									<span>{item.label}</span>
									{item.badge && (
										<span className="text-text-3">{item.badge}</span>
									)}
								</div>
							))}
							{count > EXPANDED_LIMIT && (
								<div className="text-text-3">
									and {count - EXPANDED_LIMIT} more
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
	impact: DeletionImpact;
	showConnections?: boolean;
}

export function DeletionImpactSection({
	impact,
	showConnections = true,
}: DeletionImpactSectionProps) {
	const hasResources =
		impact.repositories.length > 0 || impact.affectedServices.length > 0;

	return (
		<div className="space-y-2 py-2 text-body">
			{showConnections && impact.connections.length > 0 && (
				<div className="text-body font-medium">
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
				<p className="pt-1 text-meta text-danger">This cannot be undone.</p>
			)}
		</div>
	);
}
