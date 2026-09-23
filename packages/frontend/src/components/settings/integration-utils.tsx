// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

"use client";

import { Link2 } from "lucide-react";
import { GithubIcon } from "@/components/icons/github-icon";
import { type ChipTone, StateChip } from "@/components/shared/StateChip";

/**
 * Shared utilities for Integrations and Connections settings tabs.
 */

// Template icon helper — uses template.id
export function getTemplateIcon(templateId: string) {
	if (templateId.startsWith("github"))
		return <GithubIcon className="h-5 w-5" />;
	return <Link2 className="h-5 w-5" />;
}

// Connection status badge rendered via StateChip primitive
export function ConnectionStatusBadge({ status }: { status: string }) {
	const s = status.toUpperCase();
	let tone: ChipTone = "neutral";
	let label = status.replace(/_/g, " ").toLowerCase();

	if (s === "ACTIVE") {
		tone = "done";
		label = "connected";
	} else if (
		s.includes("FAIL") ||
		s === "ERROR" ||
		s === "CREDENTIALS_INVALID" ||
		s === "REVOKED"
	) {
		tone = "failed";
	} else if (s === "PENDING" || s === "INACTIVE" || s === "TOKEN_EXPIRED") {
		tone = "neutral";
	}

	return <StateChip tone={tone}>{label}</StateChip>;
}
