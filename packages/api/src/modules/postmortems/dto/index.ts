// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Postmortem DTOs
 */

export interface CreatePostmortemDto {
	incidentId: string;
	title?: string;
	autoPopulate?: boolean;
}

export interface UpdatePostmortemDto {
	title?: string;
	summary?: string;
	timeline?: string;
	whatHappened?: string;
	whyItHappened?: string;
	whatWeLearned?: string;
	actionItems?: string;
	customerImpact?: string;
	financialImpact?: number;
	status?: "draft" | "in_review" | "published" | "archived";
}
