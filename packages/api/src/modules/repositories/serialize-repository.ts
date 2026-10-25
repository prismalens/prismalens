// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	GitCredentialDisplay,
	Repository,
} from "@prismalens/contracts/schemas";
import type { Repository as PrismaRepository } from "@prismalens/database";
import { redactAddress } from "../integrations/source-query.js";

/** A stored scheme URL from before saves refused userinfo and a query comes back without them; scp and folders as saved (#848). */
function shownUrl(repo: PrismaRepository): string {
	if (repo.sourceKind !== "url" || !/^[a-z]+:\/\//i.test(repo.url))
		return repo.url;
	try {
		const u = new URL(repo.url);
		const secret =
			u.password ||
			u.search ||
			u.hash ||
			(/^https?:$/.test(u.protocol) && u.username);
		return secret ? redactAddress(repo.url) : repo.url;
	} catch {
		return redactAddress(repo.url);
	}
}

/** A row with the credential its next git call would use, worked out at read time (#673). */
export async function serializeRepository(
	repo: PrismaRepository,
	credentialFor: (repo: PrismaRepository) => Promise<GitCredentialDisplay>,
): Promise<Repository> {
	return {
		...repo,
		url: shownUrl(repo),
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
