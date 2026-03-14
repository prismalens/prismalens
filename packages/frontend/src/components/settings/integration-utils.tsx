"use client";

import {
	AlertCircle,
	CheckCircle,
	Github,
	Link2,
	MessageSquare,
	Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Shared utilities for Integrations and Connections settings tabs.
 */

// Template icon helper — uses template.id
export function getTemplateIcon(templateId: string) {
	if (templateId.startsWith("github"))
		return <Github className="h-5 w-5" />;
	if (templateId.startsWith("slack"))
		return <MessageSquare className="h-5 w-5" />;
	if (templateId.startsWith("prometheus"))
		return <Zap className="h-5 w-5" />;
	return <Link2 className="h-5 w-5" />;
}

// Connection status badge
export function ConnectionStatusBadge({ status }: { status: string }) {
	switch (status) {
		case "ACTIVE":
			return (
				<Badge variant="secondary">
					<CheckCircle className="h-3 w-3 mr-1" />
					Connected
				</Badge>
			);
		case "TOKEN_EXPIRED":
			return (
				<Badge variant="secondary">
					<AlertCircle className="h-3 w-3 mr-1" />
					Token Expired
				</Badge>
			);
		case "REFRESH_FAILED":
		case "CREDENTIALS_INVALID":
		case "REVOKED":
		case "ERROR":
			return (
				<Badge variant="destructive">
					<AlertCircle className="h-3 w-3 mr-1" />
					{status.replace(/_/g, " ")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

