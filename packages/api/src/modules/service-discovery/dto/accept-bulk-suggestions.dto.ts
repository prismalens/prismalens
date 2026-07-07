// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * DTO for bulk accepting service suggestions.
 */
export class AcceptBulkSuggestionsDto {
	// Array of suggestion IDs to accept
	suggestionIds: string[];

	// Optional overrides applied to all accepted suggestions
	overrides?: {
		type?: string;
		team?: string;
	};
}
