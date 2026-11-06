// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import type { PullRequest } from "@prismalens/database";

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
	return Object.entries(where).every(([k, v]) => {
		if (v && typeof v === "object" && "in" in (v as Row))
			return (v as { in: unknown[] }).in.includes(row[k]);
		return row[k] === v;
	});
}

/** The Prisma calls the PR service and link resolver make, over arrays. */
export function fakeDb(seed: {
	repositories?: Row[];
	investigations?: Row[];
	settings?: Row[];
	incidents?: Row[];
	events?: Row[];
}) {
	const prs: PullRequest[] = [];
	const repositories = seed.repositories ?? [];
	const investigations = seed.investigations ?? [];
	const settings = seed.settings ?? [];
	const incidents = seed.incidents ?? [];
	const events = seed.events ?? [];
	const db = {
		prs,
		repository: { findMany: async () => repositories },
		incident: {
			findUnique: async ({ where }: { where: Row }) =>
				incidents.find((r) => matches(r, where)) ?? null,
		},
		investigation: {
			findUnique: async ({ where }: { where: Row }) =>
				investigations.find((r) => matches(r, where)) ?? null,
			updateMany: async ({ where, data }: { where: Row; data: Row }) => {
				let count = 0;
				for (const r of investigations)
					if (matches(r, where)) {
						Object.assign(r, data);
						count++;
					}
				return { count };
			},
		},
		investigationEvent: {
			findMany: async ({ where }: { where: { investigationId: string } }) =>
				events.filter((e) => e.investigationId === where.investigationId),
		},
		setting: {
			findUnique: async ({ where }: { where: Row }) =>
				settings.find((r) => r.key === where.key) ?? null,
		},
		pullRequest: {
			findUnique: async ({
				where,
			}: {
				where: {
					investigationId_url: { investigationId: string; url: string };
				};
			}) =>
				prs.find(
					(p) =>
						p.investigationId === where.investigationId_url.investigationId &&
						p.url === where.investigationId_url.url,
				) ?? null,
			findFirst: async ({ where }: { where: Row }) =>
				prs.find((p) => matches(p as unknown as Row, where)) ?? null,
			findMany: async ({
				where,
				orderBy,
			}: {
				where: Row;
				orderBy?: { createdAt: "asc" | "desc" };
			}) => {
				const out = prs.filter((p) => matches(p as unknown as Row, where));
				return orderBy?.createdAt === "desc" ? [...out].reverse() : out;
			},
			create: async ({ data }: { data: Partial<PullRequest> }) => {
				const row = {
					id: randomUUID(),
					repositoryId: null,
					title: null,
					state: "unknown",
					review: "unknown",
					checks: null,
					conflicts: null,
					detail: null,
					etag: null,
					fetchedAt: null,
					createdAt: new Date(Date.now() + prs.length),
					updatedAt: new Date(),
					...data,
				} as PullRequest;
				prs.push(row);
				return row;
			},
			update: async ({ where, data }: { where: { id: string }; data: Row }) => {
				const row = prs.find((p) => p.id === where.id);
				if (!row) throw new Error("no row");
				Object.assign(row, data);
				return row;
			},
			deleteMany: async ({ where }: { where: Row }) => {
				const before = prs.length;
				for (let i = prs.length - 1; i >= 0; i--)
					if (matches(prs[i] as unknown as Row, where)) prs.splice(i, 1);
				return { count: before - prs.length };
			},
		},
	};
	return db;
}
