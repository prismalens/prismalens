// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "../../../test/scenarios/support/scenario-app.js";
import { ThreadMenuService } from "./thread-menu.service.js";
import { ThreadTreeService } from "../thread-tree/thread-tree.service.js";
import { ThreadsService } from "./threads.service.js";

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
		expect((await tree.links(parent))?.started).toEqual([]);
		expect((await tree.links(side))?.startedBy).toMatchObject({ id: parent, via: "fork" });

		const menu = pl.resolve<ThreadMenuService>(ThreadMenuService)!;
		expect(await menu.keep(side)).toEqual({ id: side });
		const kept = await prisma.investigation.findUnique({ where: { id: side } });
		expect(kept?.role).toBe("fork");
		expect((await feedIds("aside-")).sort()).toEqual([parent, side].sort());
		// A fork is a sibling, never a thread its source started.
		expect((await tree.links(parent))?.started).toEqual([]);
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
