// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { afterAll, expect } from "vitest";
import { defineProvider } from "../descriptor.ts";
import { conformance } from "./index.ts";

const ran: string[] = [];
const member = (id: `code-host.${string}`, order: number, skip = false) =>
	defineProvider({
		id,
		family: "code-host",
		name: id,
		mark: { letters: "FX" },
		order,
		entryPoints: [],
		...(skip ? { skips: [{ case: "listed", reason: "no screen offers it yet" }] } : {}),
	});

// The kit registers one test per member and case; a skip registers a skipped test instead of running the case.
conformance("code-host", [member("code-host.alpha", 10), member("code-host.beta", 20, true)], [
	{ id: "listed", title: "is listed", run: (p) => void ran.push(`listed ${p.id}`) },
	{ id: "ordered", title: "has an order", run: (p) => void ran.push(`ordered ${p.id}`) },
]);
conformance("agent", [], []);

afterAll(() => {
	expect(ran).toEqual(["listed code-host.alpha", "ordered code-host.alpha", "ordered code-host.beta"]);
});
