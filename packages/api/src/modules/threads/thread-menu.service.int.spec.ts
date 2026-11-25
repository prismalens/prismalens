// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Quote } from "@prismalens/contracts";
import { ScenarioApp } from "../../../test/scenarios/support/scenario-app.js";
import { ThreadMenuService } from "./thread-menu.service.js";
import { ThreadTreeService } from "../thread-tree/thread-tree.service.js";
import { ThreadsService } from "./threads.service.js";

vi.setConfig({ testTimeout: 5_000 }); // slowest test 273 ms; 3x, rounded up to the second, at least 5 s (#1154)

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);

afterAll(async () => {
	await pl.dispose();
});

async function createThread(title = "test thread", status = "completed", over: Record<string, unknown> = {}): Promise<string> {
	const prisma = await pl.prisma();
	const row = await prisma.investigation.create({
		data: {
			kind: "chat",
			status,
			title,
			lastTurnOutcome: "answered",
			...over,
		},
	});
	return row.id;
}

describe("ThreadMenuService (#1101 category 20)", () => {
	it("pin sets and clears pinnedAt without changing updatedAt", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("pin-test-thread", "completed");
		const original = await prisma.investigation.findUnique({
			where: { id: threadId },
		});
		expect(original?.pinnedAt).toBe(null);
		const initialUpdatedAt = original!.updatedAt;

		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;

		// Pin thread
		await menuService.pin(threadId, true);
		const pinnedRow = await prisma.investigation.findUnique({
			where: { id: threadId },
		});
		expect(pinnedRow?.pinnedAt).not.toBe(null);
		expect(pinnedRow?.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());

		// Unpin thread
		await menuService.pin(threadId, false);
		const unpinnedRow = await prisma.investigation.findUnique({
			where: { id: threadId },
		});
		expect(unpinnedRow?.pinnedAt).toBe(null);
		expect(unpinnedRow?.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
	});

	it("archive on a running thread throws CONFLICT", async () => {
		const threadId = await createThread("running-thread", "running");
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;

		await expect(menuService.archive(threadId, true)).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Stop the thread before you archive it.",
		});
	});

	it("archive then feed() leaves it out unless archived:true", async () => {
		const threadId = await createThread("archive-feed-thread", "completed");
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		const threadsService = pl.resolve<ThreadsService>(ThreadsService)!;

		// Archive thread
		await menuService.archive(threadId, true);

		// Default feed call (archived not set / false)
		const normalFeed = await threadsService.feed({ limit: 50, cursor: 0 });
		const foundInNormal = normalFeed.units.some((u: any) =>
			u.threads.some((t: any) => t.id === threadId),
		);
		expect(foundInNormal).toBe(false);

		// Feed with archived: true
		const archivedFeed = await threadsService.feed({ limit: 50, cursor: 0, archived: true });
		const foundInArchived = archivedFeed.units.some((u: any) =>
			u.threads.some((t: any) => t.id === threadId),
		);
		expect(foundInArchived).toBe(true);
	});

	it("unarchive clears archivedAt without changing updatedAt", async () => {
		const prisma = await pl.prisma();
		const threadId = await createThread("unarchive-test-thread", "completed");
		const original = await prisma.investigation.findUnique({
			where: { id: threadId },
		});
		const initialUpdatedAt = original!.updatedAt;

		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		const archived = await menuService.archive(threadId, true);
		expect(archived.id).toBe(threadId);

		const unarchived = await menuService.archive(threadId, false);
		expect(unarchived).toEqual({ id: threadId, at: null });

		const unarchivedRow = await prisma.investigation.findUnique({
			where: { id: threadId },
		});
		expect(unarchivedRow?.archivedAt).toBeNull();
		expect(unarchivedRow?.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
	});

	it("refuses pin on a missing thread with NOT_FOUND", async () => {
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		await expect(
			menuService.pin("00000000-0000-0000-0000-000000000000", true),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Thread not found",
		});
	});

	it("refuses archive on a missing thread with NOT_FOUND", async () => {
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		await expect(
			menuService.archive("00000000-0000-0000-0000-000000000000", true),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Thread not found",
		});
	});
});

describe("ThreadMenuService fork", () => {
	it("refuses fork on a missing thread with NOT_FOUND", async () => {
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		await expect(
			menuService.fork(
				"00000000-0000-0000-0000-000000000000",
				"fork",
				"carry on",
			),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Thread not found",
		});
	});

	it("refuses fork from an incident thread with BAD_REQUEST", async () => {
		const prisma = await pl.prisma();
		const incident = await prisma.incident.create({
			data: { number: 9999, title: "incident title" },
		});
		const parentId = await createThread("incident-parent", "completed", {
			incidentId: incident.id,
		});
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		await expect(
			menuService.fork(parentId, "fork", "carry on"),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "Fork from the incident's own thread page.",
		});
	});

	it("forks a project thread preserving repository, quotes, access level, harness, model, and effort", async () => {
		const prisma = await pl.prisma();
		const repo = await prisma.repository.create({
			data: {
				fullName: `org/r-${randomUUID()}`,
				sourceKind: "url",
				url: `https://example.test/${randomUUID()}.git`,
			},
		});
		const parentId = await createThread("Parent Title", "completed", {
			repositoryId: repo.id,
			accessLevel: "full-access",
			harness: "claude-code",
			model: "opus",
			effort: "high",
		});
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		const threadsService = pl.resolve<ThreadsService>(ThreadsService)!;
		const startSpy = vi.spyOn(threadsService, "start").mockResolvedValueOnce({
			investigationId: "fork-res-1",
			jobId: "job-1",
			queued: false,
		});

		const quoteId = randomUUID();
		const quote: Quote = {
			source: {
				threadId: quoteId,
				kind: "transcript",
			},
			text: "quoted text",
		};
		const text = "First line of fork\nSecond line";
		const res = await menuService.fork(parentId, "fork", text, [quote]);
		expect(res).toEqual({
			investigationId: "fork-res-1",
			jobId: "job-1",
			queued: false,
		});

		expect(startSpy).toHaveBeenCalledTimes(1);
		const [input, tree] = startSpy.mock.calls[0]!;
		expect(input).toEqual({
			subject: { kind: "project", repositoryId: repo.id },
			text: "First line of fork\nSecond line",
			quotes: [quote],
			accessLevel: "full-access",
			harness: "claude-code",
			model: "opus",
			effort: "high",
		});
		expect(tree!.parentId).toBe(parentId);
		expect(tree!.rootId).toBeNull();
		expect(tree!.role).toBe("fork");
		expect(tree!.depth).toBe(0);
		expect(tree!.title).toBe("First line of fork");
		expect(tree!.actionId.length).toBe(36);
	});

	it("starts a side question on a service thread falling back to default title when parent title is whitespace", async () => {
		const prisma = await pl.prisma();
		const service = await prisma.service.create({
			data: { name: `svc-${randomUUID()}` },
		});
		const parentId = await createThread("   ", "completed", {
			serviceId: service.id,
		});
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		const threadsService = pl.resolve<ThreadsService>(ThreadsService)!;
		const startSpy = vi.spyOn(threadsService, "start").mockResolvedValueOnce({
			investigationId: "side-res-1",
			jobId: null,
			queued: true,
		});

		const text = "Single line side question";
		const res = await menuService.fork(parentId, "side", text);
		expect(res).toEqual({
			investigationId: "side-res-1",
			jobId: null,
			queued: true,
		});

		expect(startSpy).toHaveBeenCalledTimes(1);
		const [input, tree] = startSpy.mock.calls[0]!;
		expect(input).toEqual({
			subject: { kind: "service", serviceId: service.id },
			text: "Single line side question",
		});
		expect(tree!.parentId).toBe(parentId);
		expect(tree!.rootId).toBeNull();
		expect(tree!.role).toBe("side question");
		expect(tree!.depth).toBe(0);
		expect(tree!.title).toBe("Single line side question");
		expect(tree!.actionId.length).toBe(36);
	});

	it("forks a thread with no subject and truncates title at eighty characters", async () => {
		const parentId = await createThread("No subject thread", "completed");
		const menuService = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		const threadsService = pl.resolve<ThreadsService>(ThreadsService)!;
		const startSpy = vi.spyOn(threadsService, "start").mockResolvedValueOnce({
			investigationId: "none-res-1",
			jobId: null,
			queued: false,
		});

		const longLine = "a".repeat(100);
		const res = await menuService.fork(parentId, "fork", longLine);
		expect(res).toEqual({
			investigationId: "none-res-1",
			jobId: null,
			queued: false,
		});

		expect(startSpy).toHaveBeenCalledTimes(1);
		const [input, tree] = startSpy.mock.calls[0]!;
		expect(input).toEqual({
			subject: { kind: "none" },
			text: longLine,
		});
		expect(tree!.parentId).toBe(parentId);
		expect(tree!.rootId).toBeNull();
		expect(tree!.role).toBe("fork");
		expect(tree!.depth).toBe(0);
		expect(tree!.title).toBe("a".repeat(80));
		expect(tree!.actionId.length).toBe(36);
	});
});

describe("side questions stay hidden until kept (#1101 sheet §2)", () => {
	const feedIds = async (search: string) => {
		const threads = pl.resolve<ThreadsService>(ThreadsService)!;
		const feed = await threads.feed({ search, cursor: 0, limit: 100 });
		return feed.units.flatMap((u) => u.threads.map((t) => t.id));
	};

	it("leaves a side question out of the list and its thread's started list, and Keep as thread lists it as a sibling forked from it (2cc93e1ad)", async () => {
		const prisma = await pl.prisma();
		const parent = await createThread("aside-parent-thread");
		const side = await createThread("aside-side-thread", "completed", {
			parentId: parent,
			role: "side question",
		});
		const tree = pl.resolve<ThreadTreeService>(ThreadTreeService)!;

		expect(await feedIds("aside-")).toEqual([parent]);
		expect((await tree.links(parent))?.started.map((l) => [l.id, l.via])).toEqual([[side, "side"]]);
		expect((await tree.links(side))?.startedBy).toMatchObject({ id: parent, via: "side" });

		const menu = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		expect(await menu.keep(side)).toEqual({ id: side });
		const kept = await prisma.investigation.findUnique({ where: { id: side } });
		expect(kept?.role).toBe("fork");
		expect((await feedIds("aside-")).sort()).toEqual([parent, side].sort());
		// The Started section lists every child, a kept side question as a fork (#1176 D16).
		expect((await tree.links(parent))?.started.map((l) => [l.id, l.via])).toEqual([[side, "fork"]]);
	});

	it("refuses Keep as thread on a thread that is not a side question", async () => {
		const plain = await createThread("aside-plain-thread");
		const menu = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		await expect(menu.keep(plain)).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "No side question with that id",
		});
	});
});
