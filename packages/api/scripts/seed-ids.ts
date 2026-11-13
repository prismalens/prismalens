// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// Stable ids for the dev seeds (#1101): a rerun deletes what the last run of the
// same seed wrote and writes it again, so threads never double.
import { createHash } from "node:crypto";

/** A UUID fixed by the seed's name and the row's key. */
export function seedId(seed: string, key: string): string {
	const h = createHash("sha1")
		.update(`prismalens-seed:${seed}:${key}`)
		.digest("hex");
	const variant = ((Number.parseInt(h[16] as string, 16) & 3) | 8).toString(16);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface SeedDb {
	toolAsk: {
		deleteMany(a: { where: { threadId: { in: string[] } } }): Promise<unknown>;
	};
	investigation: {
		deleteMany(a: {
			where: { id: { in: string[] } };
		}): Promise<{ count: number }>;
	};
	incident: {
		deleteMany(a: { where: { id: { in: string[] } } }): Promise<unknown>;
	};
}

/**
 * Removes a previous run's threads and incidents. Every other row a seed writes
 * hangs off its thread and goes with it (onDelete: Cascade); asks have no relation.
 */
export async function clearSeed(
	prisma: SeedDb,
	threads: string[],
	incidents: string[] = [],
): Promise<number> {
	await prisma.toolAsk.deleteMany({ where: { threadId: { in: threads } } });
	const { count } = await prisma.investigation.deleteMany({
		where: { id: { in: threads } },
	});
	if (incidents.length)
		await prisma.incident.deleteMany({ where: { id: { in: incidents } } });
	return count;
}
