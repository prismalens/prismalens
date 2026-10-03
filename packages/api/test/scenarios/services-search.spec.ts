// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioApp } from "./support/scenario-app.js";

const pl = new ScenarioApp();

beforeAll(async () => {
	await pl.boot();
}, 60_000);
afterAll(async () => {
	await pl.dispose();
});

describe("Services filter on SQLite", () => {
	it("Given a service, When the list is searched in another case, Then it is found and nothing 500s", async () => {
		await pl.api("/services", {
			method: "POST",
			body: { name: "booklogr-api", displayName: "Booklogr API" },
		});
		const found = await pl.api<{ data: Array<{ name: string }> }>(
			"/services?search=BOOKLOGR",
		);
		expect(found.data.map((s) => s.name)).toContain("booklogr-api");
		const none = await pl.api<{ data: unknown[] }>("/services?search=nothing-here");
		expect(none.data).toEqual([]);
	});
});
