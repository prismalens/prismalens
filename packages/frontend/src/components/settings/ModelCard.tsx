"use client";

import type { ModelMetadata } from "@prismalens/contracts";
import { Check, Sparkles, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ModelCardProps {
	model: ModelMetadata;
	selected: boolean;
	disabled?: boolean;
	onClick: () => void;
}

/**
 * Check if a model was released in the last 30 days
 */
function isNewModel(releaseDate?: string): boolean {
	if (!releaseDate) return false;
	const release = new Date(releaseDate);
	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
	return release > thirtyDaysAgo;
}

/**
 * Format context size for display (e.g., 200K, 1M)
 */
function formatContextSize(size: number): string {
	if (size >= 1_000_000) {
		return `${(size / 1_000_000).toFixed(size % 1_000_000 === 0 ? 0 : 1)}M`;
	}
	if (size >= 1_000) {
		return `${Math.round(size / 1_000)}K`;
	}
	return size.toString();
}

export function ModelCard({
	model,
	selected,
	disabled = false,
	onClick,
}: ModelCardProps) {
	const isNew = isNewModel(model.releaseDate);
	const contextSize = formatContextSize(model.limit.context);

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"w-full text-left px-3 py-2.5 rounded-md transition-colors",
				"flex items-start gap-3",
				selected && !disabled && "bg-primary/10 border border-primary/30",
				!selected && !disabled && "hover:bg-accent/50",
				disabled && "opacity-50 cursor-not-allowed"
			)}
		>
			{/* Selection indicator */}
			<div
				className={cn(
					"w-4 h-4 rounded-full border-2 mt-0.5 flex-shrink-0 flex items-center justify-center",
					selected && !disabled
						? "border-primary bg-primary"
						: "border-muted-foreground/40"
				)}
			>
				{selected && !disabled && (
					<Check className="h-2.5 w-2.5 text-primary-foreground" />
				)}
			</div>

			{/* Model info */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span
						className={cn(
							"font-medium text-sm truncate",
							disabled && "text-muted-foreground"
						)}
					>
						{model.name}
					</span>
					{isNew && (
						<Badge
							variant="default"
							className="text-[10px] px-1.5 py-0 h-4 bg-green-500 hover:bg-green-500 flex-shrink-0"
						>
							NEW
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-2 mt-0.5">
					<span className="text-xs text-muted-foreground">
						{contextSize} context
					</span>
					{model.toolCall && (
						<Badge
							variant="secondary"
							className={cn(
								"text-[10px] px-1.5 py-0 h-4",
								disabled && "opacity-50"
							)}
						>
							<Wrench className="h-2.5 w-2.5 mr-0.5" />
							Tools
						</Badge>
					)}
					{model.reasoning && (
						<Badge
							variant="secondary"
							className={cn(
								"text-[10px] px-1.5 py-0 h-4",
								disabled && "opacity-50"
							)}
						>
							<Sparkles className="h-2.5 w-2.5 mr-0.5" />
							Reason
						</Badge>
					)}
				</div>
			</div>
		</button>
	);
}
