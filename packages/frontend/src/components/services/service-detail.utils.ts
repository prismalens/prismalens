import {
	Box,
	Cloud,
	Database,
	ExternalLink,
	Globe,
	Server,
	Zap,
} from "lucide-react";
import { createElement } from "react";

export const serviceTypeIcons: Record<string, React.ReactNode> = {
	service: createElement(Server, { className: "h-5 w-5" }),
	database: createElement(Database, { className: "h-5 w-5" }),
	queue: createElement(Zap, { className: "h-5 w-5" }),
	cache: createElement(Box, { className: "h-5 w-5" }),
	gateway: createElement(Globe, { className: "h-5 w-5" }),
	external: createElement(ExternalLink, { className: "h-5 w-5" }),
	infrastructure: createElement(Server, { className: "h-5 w-5" }),
};

export const tierLabels: Record<string, string> = {
	tier_1: "Critical",
	tier_2: "High",
	tier_3: "Medium",
	tier_4: "Low",
};

export function DeploymentStatusIndicator({ status }: { status: string | null }) {
	const colors: Record<string, string> = {
		live: "text-green-500",
		active: "text-green-500",
		running: "text-green-500",
		suspended: "text-yellow-500",
		paused: "text-yellow-500",
		stopped: "text-red-500",
		failed: "text-red-500",
		error: "text-red-500",
	};
	const colorClass = status ? (colors[status.toLowerCase()] ?? "text-muted-foreground") : "text-muted-foreground";
	return createElement(Cloud, { className: `h-3 w-3 flex-shrink-0 ${colorClass}` });
}

export function formatTimeAgo(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d ago`;
	return date.toLocaleDateString();
}
