// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Template ids 0.5.0 could store and 0.5.1 no longer ships; rows survive, nothing runs them (#673). */
export const LEGACY_TEMPLATE_IDS = ["github-app"] as const;

export const isLegacyTemplateId = (id: string): boolean =>
	(LEGACY_TEMPLATE_IDS as readonly string[]).includes(id);
