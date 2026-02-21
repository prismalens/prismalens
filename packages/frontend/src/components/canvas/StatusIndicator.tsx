/**
 * Status Indicator Component
 *
 * Shows visual status for canvas nodes (spinner, check, error)
 */

import type { ExecutionStatus } from "@prismalens/contracts";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatusIndicatorProps {
	status: ExecutionStatus | "pending";
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizeClasses = {
	sm: "w-3 h-3",
	md: "w-4 h-4",
	lg: "w-5 h-5",
};

export function StatusIndicator({
	status,
	size = "md",
	className,
}: StatusIndicatorProps) {
	const sizeClass = sizeClasses[size];

	switch (status) {
		case "completed":
			return (
				<CheckCircle
					className={cn(sizeClass, "text-green-500", className)}
				/>
			);
		case "running":
			return (
				<Loader2
					className={cn(sizeClass, "text-blue-500 animate-spin", className)}
				/>
			);
		case "failed":
			return (
				<XCircle
					className={cn(sizeClass, "text-red-500", className)}
				/>
			);
		case "pending":
		default:
			return (
				<Circle
					className={cn(sizeClass, "text-zinc-400", className)}
				/>
			);
	}
}
