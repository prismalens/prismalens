// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { LiveChanges } from "./live-changes.js";

async function firstChange(live: LiveChanges, act: () => void) {
	const controller = new AbortController();
	const stream = live.subscribe(controller.signal);
	const next = stream.next();
	act();
	const { value } = await next;
	controller.abort();
	await stream.return(undefined);
	return value;
}

describe("LiveChanges (walk f27)", () => {
	it("sends one hint for a burst of writes, naming each list once", async () => {
		const live = new LiveChanges(10);
		const change = await firstChange(live, () => {
			live.noteWrite("Alert", "create");
			live.noteWrite("Incident", "create");
			live.noteWrite("TimelineEntry", "create");
			live.noteWrite("Investigation", "update");
		});
		expect(change?.topics.sort()).toEqual([
			"alerts",
			"incidents",
			"investigations",
		]);
	});

	it("ignores reads and models no list shows", async () => {
		const live = new LiveChanges(10);
		const change = await firstChange(live, () => {
			live.noteWrite("Incident", "findMany");
			live.noteWrite("Setting", "update");
			live.noteWrite("Incident", "update");
		});
		expect(change?.topics).toEqual(["incidents"]);
	});

	it("ends a subscription quietly when the browser goes away", async () => {
		const live = new LiveChanges(10);
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal);
		const next = stream.next();
		controller.abort();
		await expect(next).resolves.toEqual({ done: true, value: undefined });
	});

	it("keeps one merged hint for a subscriber that has not read yet", async () => {
		const live = new LiveChanges(1);
		const controller = new AbortController();
		const stream = live.subscribe(controller.signal);
		const first = stream.next();
		live.noteWrite("Alert", "create");
		await first;
		for (const model of ["Incident", "Alert", "Investigation", "Incident"]) {
			live.noteWrite(model, "update");
			await new Promise((r) => setTimeout(r, 5));
		}
		const { value } = await stream.next();
		expect(value?.topics.sort()).toEqual(["alerts", "incidents", "investigations"]);
		controller.abort();
		await expect(stream.next()).resolves.toEqual({ done: true, value: undefined });
	});

	it("sends a transaction's hints only after it commits, and none on rollback", async () => {
		const live = new LiveChanges(1);
		const seen: string[][] = [];
		const controller = new AbortController();
		const reader = (async () => {
			for await (const change of live.subscribe(controller.signal)) seen.push(change.topics);
		})();
		await expect(
			live.afterCommit(async () => {
				live.noteWrite("Alert", "update");
				throw new Error("rolled back");
			}),
		).rejects.toThrow("rolled back");
		await live.afterCommit(async () => {
			live.noteWrite("Incident", "update");
			await new Promise((r) => setTimeout(r, 20));
			expect(seen).toEqual([]);
		});
		await new Promise((r) => setTimeout(r, 20));
		expect(seen).toEqual([["incidents"]]);
		controller.abort();
		await reader;
	});
});
