"use client";

import type { TimelineEntryType, TimelineSource } from "@prismalens/contracts";
import { formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	Bell,
	Bot,
	CheckCircle,
	FileText,
	type LucideIcon,
	MessageSquare,
	MinusCircle,
	PenLine,
	RefreshCw,
	UserPlus,
	Wrench,
	XCircle,
	Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TimelineEntryProps {
	id: string;
	type: TimelineEntryType;
	title: string;
	description?: string | null;
	source: TimelineSource;
	occurredAt: string;
	user?: {
		id: string;
		email: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
	compact?: boolean;
	className?: string;
}

interface EntryStyle {
	icon: LucideIcon;
	color: string;
	bgColor: string;
	borderColor: string;
}

const entryStyles: Record<TimelineEntryType, EntryStyle> = {
	incident_created: {
		icon: Zap,
		color: "text-amber-600",
		bgColor: "bg-amber-50",
		borderColor: "border-amber-200",
	},
	alert_added: {
		icon: Bell,
		color: "text-blue-600",
		bgColor: "bg-blue-50",
		borderColor: "border-blue-200",
	},
	alert_removed: {
		icon: MinusCircle,
		color: "text-zinc-500",
		bgColor: "bg-zinc-50",
		borderColor: "border-zinc-200",
	},
	status_changed: {
		icon: RefreshCw,
		color: "text-purple-600",
		bgColor: "bg-purple-50",
		borderColor: "border-purple-200",
	},
	severity_changed: {
		icon: AlertCircle,
		color: "text-orange-600",
		bgColor: "bg-orange-50",
		borderColor: "border-orange-200",
	},
	assigned: {
		icon: UserPlus,
		color: "text-indigo-600",
		bgColor: "bg-indigo-50",
		borderColor: "border-indigo-200",
	},
	investigation_started: {
		icon: RefreshCw,
		color: "text-purple-600",
		bgColor: "bg-purple-50",
		borderColor: "border-purple-200",
	},
	investigation_completed: {
		icon: Bot,
		color: "text-green-600",
		bgColor: "bg-green-50",
		borderColor: "border-green-200",
	},
	recommendation_added: {
		icon: Wrench,
		color: "text-yellow-600",
		bgColor: "bg-yellow-50",
		borderColor: "border-yellow-200",
	},
	recommendation_completed: {
		icon: CheckCircle,
		color: "text-green-600",
		bgColor: "bg-green-50",
		borderColor: "border-green-200",
	},
	comment: {
		icon: MessageSquare,
		color: "text-zinc-600",
		bgColor: "bg-zinc-50",
		borderColor: "border-zinc-200",
	},
	postmortem_created: {
		icon: FileText,
		color: "text-teal-600",
		bgColor: "bg-teal-50",
		borderColor: "border-teal-200",
	},
	custom: {
		icon: PenLine,
		color: "text-zinc-600",
		bgColor: "bg-zinc-50",
		borderColor: "border-zinc-200",
	},
};

const sourceLabels: Record<TimelineSource, string> = {
	system: "system",
	user: "user",
	ai_worker: "ai",
};

const sourceBadgeVariants: Record<TimelineSource, "default" | "secondary" | "outline"> = {
	system: "secondary",
	user: "default",
	ai_worker: "outline",
};

function formatTime(dateString: string): string {
	const date = new Date(dateString);
	return date.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function getUserDisplayName(user: TimelineEntryProps["user"]): string {
	if (!user) return "";
	if (user.firstName || user.lastName) {
		return `@${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
	}
	return `@${user.email.split("@")[0]}`;
}

export function TimelineEntry({
	type,
	title,
	description,
	source,
	occurredAt,
	user,
	compact = false,
	className,
}: TimelineEntryProps) {
	const style = entryStyles[type];
	const Icon = style.icon;

	if (compact) {
		return (
			<div className={cn("flex items-center gap-3 py-2", className)}>
				<span className="text-xs text-muted-foreground w-12 shrink-0">
					{formatTime(occurredAt)}
				</span>
				<div
					className={cn(
						"w-6 h-6 rounded-full flex items-center justify-center shrink-0",
						style.bgColor
					)}
				>
					<Icon className={cn("w-3.5 h-3.5", style.color)} />
				</div>
				<span className="text-sm flex-1 truncate">{title}</span>
				<Badge variant={sourceBadgeVariants[source]} className="text-xs shrink-0">
					{source === "user" && user ? getUserDisplayName(user) : sourceLabels[source]}
				</Badge>
			</div>
		);
	}

	return (
		<div className={cn("flex gap-4 py-3", className)}>
			<div className="flex flex-col items-center">
				<span className="text-xs text-muted-foreground mb-2">
					{formatTime(occurredAt)}
				</span>
				<div
					className={cn(
						"w-8 h-8 rounded-full flex items-center justify-center",
						style.bgColor,
						"border",
						style.borderColor
					)}
				>
					<Icon className={cn("w-4 h-4", style.color)} />
				</div>
				<div className="flex-1 w-px bg-border mt-2" />
			</div>
			<div className="flex-1 pt-0.5 pb-4">
				<div className="flex items-center justify-between gap-2">
					<span className="font-medium">{title}</span>
					<Badge variant={sourceBadgeVariants[source]} className="text-xs">
						{source === "user" && user ? getUserDisplayName(user) : sourceLabels[source]}
					</Badge>
				</div>
				{description && (
					<p className="text-sm text-muted-foreground mt-1">{description}</p>
				)}
				<span className="text-xs text-muted-foreground mt-2 block">
					{formatDistanceToNow(new Date(occurredAt), { addSuffix: true })}
				</span>
			</div>
		</div>
	);
}
