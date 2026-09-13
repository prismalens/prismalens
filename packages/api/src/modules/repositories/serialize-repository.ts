// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Repository } from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";

export function serializeRepository(repo: PrismaRepository): Repository {
	return {
		...repo,
		createdAt: repo.createdAt.toISOString(),
		updatedAt: repo.updatedAt.toISOString(),
		syncedAt: repo.syncedAt?.toISOString() ?? null,
		metadata:
			typeof repo.metadata === "string"
				? (JSON.parse(repo.metadata) as Record<string, unknown>)
				: (repo.metadata as Record<string, unknown> | null),
	} as Repository;
}
