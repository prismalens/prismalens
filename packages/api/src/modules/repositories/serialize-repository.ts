// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitCredentialDisplay,
	Repository,
} from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";

/** A row with the credential its next git call would use, worked out at read time (#673). */
export async function serializeRepository(
	repo: PrismaRepository,
	credentialFor: (repo: PrismaRepository) => Promise<GitCredentialDisplay>,
): Promise<Repository> {
	return {
		...repo,
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
