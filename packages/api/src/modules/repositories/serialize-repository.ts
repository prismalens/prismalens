// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitCredentialDisplay,
	Repository,
} from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";
import { shownRepoUrl } from "../../core/harness/git-credential.js";

/** A row with the credential its next git call would use, worked out at read time (#673). */
export async function serializeRepository(
	repo: PrismaRepository,
	credentialFor: (repo: PrismaRepository) => Promise<GitCredentialDisplay>,
): Promise<Repository> {
	return {
		...repo,
		url: shownRepoUrl(repo.sourceKind, repo.url),
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
