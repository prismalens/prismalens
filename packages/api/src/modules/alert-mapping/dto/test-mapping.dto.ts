// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * DTO for testing which service an alert would map to.
 * Reserved for future use.
 */
export class TestMappingDto {
	source?: string;
	labels?: Record<string, string>;
	tags?: string[];
	title: string;
	description?: string;
}
