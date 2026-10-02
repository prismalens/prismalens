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
});
