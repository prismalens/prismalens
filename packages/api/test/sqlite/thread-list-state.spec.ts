// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ThreadFeed } from "@prismalens/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setAgentTitle } from "../../src/modules/threads/thread-titles.js";
import { ScenarioApp } from "../scenarios/support/scenario-app.js";

// Not a lifecycle scenario: these pin SQL behaviour (quiet days, the 501-row cap) on real
// SQLite, which needs rows at exact past times that no product path writes (#1020).
const pl = new ScenarioApp();
const DAY_MS = 86_400_000;

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

async function thread(title: string, endedAt: Date): Promise<string> {
	const prisma = await pl.prisma();
	const row = await prisma.investigation.create({
		data: {
			kind: "chat",
			status: "completed",
			title,
			lastTurnOutcome: "answered",
			createdAt: endedAt,
			startedAt: endedAt,
			completedAt: endedAt,
		},
	});
	return row.id;
}

async function rowOf(id: string) {
	const feed = await pl.api<ThreadFeed>("/threads/feed?limit=100");
	return feed.units.flatMap((u) => u.threads).find((t) => t.id === id);
}

const search = async (q: string) =>
	(
		await pl.api<ThreadFeed>(
			`/threads/feed?limit=100&search=${encodeURIComponent(q)}`,
		)
	).units.flatMap((u) => u.threads.map((t) => t.title));

describe("Thread list state on SQLite (#1020)", () => {
	it("Given an unseen answer, When it is settled and then undone, Then it is back in Needs you, recent or old", async () => {
		for (const endedAt of [
			new Date(Date.now() - 60_000),
			new Date(Date.now() - 10 * DAY_MS),
		]) {
			const id = await thread(`Unseen ${endedAt.getTime()}`, endedAt);
			expect(await rowOf(id)).toMatchObject({ section: "needs", unseen: true });

			await pl.api(`/threads/${id}/settle`, {
				method: "POST",
				body: { settled: true },
			});
			expect(await rowOf(id)).toMatchObject({
				section: "settled",
				unseen: false,
			});

			await pl.api(`/threads/${id}/settle`, {
				method: "POST",
				body: { settled: false },
			});
			expect(await rowOf(id)).toMatchObject({ section: "needs", unseen: true });
		}
	});

	it("Given an old thread, When it is visited, settled and undone, Then its updatedAt and feed place stay put", async () => {
		const id = await thread("Old read state", new Date(Date.now() - 5 * DAY_MS));
		const prisma = await pl.prisma();
		const before = (await prisma.investigation.findUniqueOrThrow({ where: { id } }))
			.updatedAt;
		await pl.api(`/threads/${id}/visit`, { method: "POST", body: {} });
		await pl.api(`/threads/${id}/settle`, {
			method: "POST",
			body: { settled: true },
		});
		await pl.api(`/threads/${id}/settle`, {
			method: "POST",
			body: { settled: false },
		});
		const after = await prisma.investigation.findUniqueOrThrow({ where: { id } });
		expect(after.lastVisitedAt).not.toBeNull();
		expect(after.updatedAt.getTime()).toBe(before.getTime());
	});

	it("Given titles without wildcards, When the search is % or _, Then nothing matches, and a literal one still does", async () => {
		const now = new Date();
		await thread("plain alpha", now);
		await thread("plain beta", now);
		await thread("cut 100% of retries", now);
		await thread("rename snake_case keys", now);

		expect(await search("%")).toEqual(["cut 100% of retries"]);
		expect(await search("_")).toEqual(["rename snake_case keys"]);
		expect(await search("100%")).toEqual(["cut 100% of retries"]);
		expect(await search("e_c")).toEqual(["rename snake_case keys"]);
		expect(await search("pl%n")).toEqual([]);
	});

	it("Given an agent title, When the user renames, Then later agent titles leave the user's name", async () => {
		const id = await thread("first message text", new Date());
		const prisma = await pl.prisma();
		expect(await setAgentTitle(prisma, id, "Checkout pool too small")).toEqual({
			title: "Checkout pool too small",
			kept: false,
		});
		const renamed = await pl.api<{ title: string }>(`/threads/${id}/title`, {
			method: "POST",
			body: { title: "<b>Pool</b> sizing\u202e" },
		});
		expect(renamed.title).toBe("<b>Pool</b> sizing");
		const [late, sameTime] = await Promise.all([
			setAgentTitle(prisma, id, "Cart leak after deploy"),
			setAgentTitle(prisma, id, "Another agent guess here"),
		]);
		expect(late).toEqual({ title: "<b>Pool</b> sizing", kept: true });
		expect(sameTime.kept).toBe(true);
		expect(await rowOf(id)).toMatchObject({
			title: "<b>Pool</b> sizing",
			titleSetBy: "user",
		});
	});

	it("Given 501 newer threads, When the search is %, Then the older literal match still shows", async () => {
		const prisma = await pl.prisma();
		const old = new Date(Date.now() - 2 * DAY_MS);
		const id = await thread("raise the cap to 80% now", old);
		await prisma.investigation.update({ where: { id }, data: { updatedAt: old } });
		const now = Date.now();
		await prisma.investigation.createMany({
			data: Array.from({ length: 501 }, (_, i) => ({
				kind: "chat",
				status: "completed",
				title: `newer thread at 80 ${i}`,
				createdAt: new Date(now - i * 1000),
				updatedAt: new Date(now - i * 1000),
			})),
		});
		expect(await search("80%")).toEqual(["raise the cap to 80% now"]);
	});

	it("Given 501 incidents, When the incident search is _ or %, Then only literal titles match", async () => {
		const prisma = await pl.prisma();
		const top = await prisma.incident.aggregate({ _max: { number: true } });
		const first = (top._max.number ?? 0) + 1;
		await prisma.incident.createMany({
			data: Array.from({ length: 501 }, (_, i) => ({
				number: first + i,
				title: i === 0 ? "pool_size too small" : `plain incident ${i}`,
			})),
		});
		const titles = async (q: string) =>
			(
				await pl.api<{ data: { title: string }[] }>(
					`/incidents?limit=100&search=${encodeURIComponent(q)}`,
				)
			).data.map((i) => i.title);
		expect(await titles("_")).toEqual(["pool_size too small"]);
		expect(await titles("%")).toEqual([]);
	});
});
