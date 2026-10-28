// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitCredentialDisplay,
	Repository,
} from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";
import {
	shownRepoName,
	shownRepoUrl,
	UNSHOWN_REPO,
} from "../../core/harness/git-credential.js";
import { displayNameFor } from "../../core/harness/repo-source.service.js";

/** A legacy row's fullName was derived from its address and may hold the same credential (#938). */
function shownFullName(repo: PrismaRepository, url: string): string {
	if (url === repo.url) return shownRepoName(repo.sourceKind, repo.fullName);
	if (url === UNSHOWN_REPO) return UNSHOWN_REPO;
	try {
		return displayNameFor("url", url);
	} catch {
		return UNSHOWN_REPO;
	}
}

/** A row with the credential its next git call would use, worked out at read time (#673). */
export async function serializeRepository(
	repo: PrismaRepository,
	credentialFor: (repo: PrismaRepository) => Promise<GitCredentialDisplay>,
): Promise<Repository> {
	const url = shownRepoUrl(repo.sourceKind, repo.url);
	return {
		...repo,
		url,
		fullName: shownFullName(repo, url),
		createdAt: repo.createdAt.toISOString(),
		updatedAt: repo.updatedAt.toISOString(),
		syncedAt: repo.syncedAt?.toISOString() ?? null,
		metadata:
			typeof repo.metadata === "string"
				? (JSON.parse(repo.metadata) as Record<string, unknown>)
				: (repo.metadata as Record<string, unknown> | null),
		credential: await credentialFor(repo),
	} as Repository;
}
