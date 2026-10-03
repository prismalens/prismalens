// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	SERVICE_TIER_METADATA,
	SERVICE_TYPE_LABEL,
	type ServiceTier,
	type ServiceType,
	type ServiceWithRelations,
} from "@prismalens/contracts";

/** `Tier 1`, the meta word a row and the band show; its meaning in the title. */
export function tierWord(tier: string): string {
	return /^tier_\d$/.test(tier) ? tier.replace("tier_", "Tier ") : tier;
}

export function tierMeaning(tier: string): string {
	return SERVICE_TIER_METADATA[tier as ServiceTier]?.description ?? "";
}

/** `Service`, `Database`, `Gateway`: the kind of thing a service is (decision 1). */
export function kindWord(type: string): string {
	return SERVICE_TYPE_LABEL[type as ServiceType] ?? type;
}

/** Where its code is: a folder path, or host/owner/repo for a git URL. */
export function codeWhere(service: ServiceWithRelations): string | null {
	const repo =
		service.repositories?.find((r) => r.isPrimary) ?? service.repositories?.[0];
	if (!repo) return null;
	const r = repo.repository;
	if (r.sourceKind === "folder")
		return repo.subPath ? `${r.url}/${repo.subPath}` : r.url;
	return r.url
		.replace(/^(https?:\/\/|git@)/, "")
		.replace(/\.git$/, "")
		.replace(":", "/");
}
