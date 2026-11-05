// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	REFERENCE_SNAPSHOT_MAX_CHARS,
	REFERENCE_SNAPSHOTS_MAX_CHARS,
} from "@prismalens/contracts";
import { type ReferenceProvider, SourceUnavailable } from "./reference-provider.js";
import { ReferencesService } from "./references.service.js";

const RUN = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "0b3c2f1e-1111-4222-8333-444455556666";
const INC = "8c8b1c0e-0d55-4f27-9f0a-3e7d1d1b6b11";

function prisma(over: Record<string, unknown> = {}) {
	const threads: Record<string, Record<string, unknown>> = {
		[RUN]: {
			id: RUN,
			title: "Checkout slow",
			status: "running",
			incidentId: INC,
			repositoryId: null,
			serviceId: null,
			scheduleId: null,
			workspace: null,
			harness: "claude-code",
			agentCommands: JSON.stringify([{ name: "review", description: "Review the diff" }]),
			summary: null,
		},
		[OTHER]: {
			id: OTHER,
			title: "Unrelated",
			status: "completed",
			incidentId: null,
			repositoryId: null,
			serviceId: null,
			summary: "x".repeat(10_000),
		},
	};
	return {
		investigation: {
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => threads[where.id] ?? null),
			findMany: vi.fn(async () => []),
		},
		incident: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
		service: { findMany: vi.fn(async () => []) },
		repository: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
		schedule: { findMany: vi.fn(async () => []) },
		attachment: { findMany: vi.fn(async () => []) },
		alert: { findMany: vi.fn(async () => []) },
		investigationEvent: { findMany: vi.fn(async () => []) },
		referenceUse: { findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
		setting: { findUnique: vi.fn(async () => null) },
		...over,
	};
}

describe("ReferencesService (#1024)", () => {
	it("a thread outside the run's scope goes as its bounded snapshot only, with no read tool", async () => {
		const svc = new ReferencesService(prisma() as never);
		const [snap] = await svc.snapshots(
			[{ kind: "thread", id: OTHER, label: "Unrelated" }],
			{ threadId: RUN },
		);
		expect(snap?.outOfScope).toBe(true);
		expect(snap?.readTool).toBeUndefined();
		expect(snap?.text.length).toBeLessThanOrEqual(REFERENCE_SNAPSHOT_MAX_CHARS);
	});

	it("a message's references stay within 20,000 characters; the rest are named as left out", async () => {
		const svc = new ReferencesService(prisma() as never);
		const refs = Array.from({ length: 8 }, () => ({
			kind: "thread" as const,
			id: OTHER,
			label: "Unrelated",
		}));
		const ctx = await svc.compose({ references: refs }, { threadId: RUN });
		const addendum = ctx?.addendum ?? "";
		expect(addendum.length).toBeLessThanOrEqual(REFERENCE_SNAPSHOTS_MAX_CHARS + 2000);
		expect(addendum).toContain("left out");
		expect(addendum).toContain("outside this run's scope");
		expect(ctx?.references).toHaveLength(8);
	});

	it("a quote reaches the agent as a blockquote with its source line", async () => {
		const svc = new ReferencesService(prisma() as never);
		const ctx = await svc.compose(
			{ quotes: [{ source: { threadId: RUN, seq: 7, kind: "report" }, text: "pool exhausted" }] },
			{ threadId: RUN },
		);
		expect(ctx?.addendum).toBe(
			'> pool exhausted\n> — from the report of thread "Checkout slow", event 7',
		);
		expect(await svc.compose({}, { threadId: RUN })).toBeUndefined();
	});

	it("`/` lists PrismaLens actions and the agent's commands, marked apart", async () => {
		const svc = new ReferencesService(prisma() as never);
		const { hits } = await svc.search({ q: "", trigger: "/", threadId: RUN, limit: 20 });
		expect(hits.filter((h) => h.source === "app").map((h) => h.ref.label)).toEqual(
			expect.arrayContaining(["/investigate", "/ask"]),
		);
		expect(hits.find((h) => h.source === "agent")).toMatchObject({
			ref: { label: "/review" },
			detail: "Review the diff",
		});
	});

	it("a source that cannot answer shows one line and never blocks the others", async () => {
		const down: ReferenceProvider = {
			source: "GitLab",
			kinds: ["issue", "pull_request"],
			search: async () => [],
			byNumber: async () => {
				throw new SourceUnavailable("GitLab", "no token for gitlab.example.com");
			},
			snapshot: async () => null,
		};
		const up: ReferenceProvider = {
			source: "GitHub · acme/shop",
			kinds: ["pull_request"],
			search: async () => [],
			byNumber: async (n) => [
				{ ref: { kind: "pull_request", id: `acme/shop#${n}`, label: `#${n} Fix pool` } },
			],
			snapshot: async () => null,
		};
		const svc = new ReferencesService(prisma() as never, [down, up]);
		const result = await svc.search({ q: "#12", trigger: "#", threadId: RUN, limit: 20 });
		expect(result.unavailable).toEqual([
			{ source: "GitLab", message: "no token for gitlab.example.com" },
		]);
		expect(result.hits.map((h) => [h.ref.id, h.group])).toEqual([
			["acme/shop#12", "GitHub · acme/shop"],
		]);
	});
});
