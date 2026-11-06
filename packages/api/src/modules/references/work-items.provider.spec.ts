// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { WorkItem } from "@prismalens/contracts";
import { describe, expect, it, vi } from "vitest";
import { ReferencesService } from "./references.service.js";
import { WorkItemsProvider, type WorkItemsSource } from "./work-items.provider.js";

const RUN = "6a3b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const item = (over: Partial<WorkItem>): WorkItem => ({
	kind: "pull_request",
	number: 12,
	title: "Fix pool",
	state: "open",
	tone: "open",
	url: "https://github.com/acme/shop/pull/12",
	...over,
});

function source(byRepo: Record<string, WorkItem[] | Error>): WorkItemsSource {
	const read = async (id: string) => {
		const v = byRepo[id];
		if (v instanceof Error) throw v;
		return v ?? [];
	};
	return {
		remotes: async () => [
			{ repositoryId: "r1", host: "github.com", repo: "acme/shop" },
			{ repositoryId: "r2", host: "gitlab.example.com", repo: "acme/api" },
		],
		findWorkItems: vi.fn(async (id: string, n: number) => (await read(id)).filter((w) => w.number === n)),
		searchWorkItems: vi.fn(async (id: string, q: string) => (await read(id)).filter((w) => w.title.toLowerCase().includes(q.toLowerCase()))),
	};
}

const ctx = { root: null, kinds: ["pull_request", "issue"] as never, limit: 20 };

describe("Issues and pull requests under # (#1024 spec B)", () => {
	it("Given #12, Then each repository's item by that number is a hit in its host's group, and a snapshot reads it again", async () => {
		const p = new WorkItemsProvider(() =>
			source({ r1: [item({})], r2: [item({ kind: "issue", number: 12, title: "Pool leaks", url: "https://gitlab.example.com/acme/api/-/issues/12" })] }),
		);
		const hits = await p.byNumber(12, { ...ctx, mergeRequest: false });
		expect(hits.map((h) => [h.ref.kind, h.ref.id, h.ref.label, h.group]).sort()).toEqual([
			["issue", "r2:issue:12", "#12 Pool leaks", "GitLab · acme/api"],
			["pull_request", "r1:pull_request:12", "#12 Fix pool", "GitHub · acme/shop"],
		]);
		expect((await p.byNumber(12, { ...ctx, mergeRequest: true })).map((h) => h.ref.kind)).toEqual(["pull_request"]);
		const snap = await p.snapshot({ kind: "pull_request", id: "r1:pull_request:12", label: "#12 Fix pool" });
		expect(snap?.text).toBe('Pull request #12 "Fix pool", open. https://github.com/acme/shop/pull/12');
		expect(await p.snapshot({ kind: "issue", id: "r1:issue:99", label: "x" })).toBeNull();
	});

	it("Given a project thread, Then only its repository is searched; words search titles", async () => {
		const src = source({ r1: [item({})], r2: [item({ title: "Fix api" })] });
		const p = new WorkItemsProvider(() => src);
		expect((await p.search("fix", { ...ctx, repositoryId: "r1" })).map((h) => h.ref.id)).toEqual(["r1:pull_request:12"]);
		expect(await p.search("", ctx)).toEqual([]);
	});

	it("Given a host with no credential and one that answers, Then the menu has the answer and no line; with only the failing one, one line", async () => {
		const svcWith = (byRepo: Record<string, WorkItem[] | Error>) => {
			const prisma = new Proxy({ investigation: { findUnique: vi.fn(async () => ({ id: RUN, incidentId: null, repositoryId: null, serviceId: null, scheduleId: null, workspace: null, harness: null, agentCommands: null })), findMany: vi.fn(async () => []) } } as Record<string, unknown>, {
				get: (t, k: string) => t[k] ?? { findMany: async () => [], findUnique: async () => null, findFirst: async () => null },
			});
			return new ReferencesService(prisma as never, [new WorkItemsProvider(() => source(byRepo))]);
		};
		const mixed = await svcWith({ r1: [item({})], r2: new Error("no token for gitlab.example.com") }).search({ q: "#12", trigger: "#", threadId: RUN, limit: 20 });
		expect(mixed.hits.map((h) => h.ref.id)).toContain("r1:pull_request:12");
		const down = await svcWith({ r1: new Error("no token for github.com"), r2: new Error("connect ECONNREFUSED") }).search({ q: "#12", trigger: "#", threadId: RUN, limit: 20 });
		expect(down.unavailable).toEqual([
			{ source: "Git host", message: expect.stringMatching(/^(GitHub · acme\/shop|GitLab · acme\/api): /) },
		]);
	});

	it("Given no pull requests service, Then it answers nothing rather than failing", async () => {
		const p = new WorkItemsProvider(() => null);
		expect(await p.byNumber(1, { ...ctx, mergeRequest: false })).toEqual([]);
		expect(await p.snapshot({ kind: "issue", id: "r1:issue:1", label: "x" })).toBeNull();
	});
});
