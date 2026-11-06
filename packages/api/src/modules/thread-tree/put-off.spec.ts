// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { PutOff } from "./put-off.js";

describe("PutOff (#1024 spec F)", () => {
	it("skips rows put off in a full pass, and retries them all once a pass runs short", () => {
		const p = new PutOff();
		p.defer("a");
		p.settle(2, 2);
		expect(p.skip()).toEqual(["a"]);
		p.defer("b");
		p.settle(2, 2);
		expect(p.skip().sort()).toEqual(["a", "b"]);
		p.settle(1, 2);
		expect(p.skip()).toEqual([]);
	});

	it("never holds more than its bound", () => {
		const p = new PutOff();
		for (let i = 0; i < 2_001; i++) p.defer(`r${i}`);
		p.settle(50, 50);
		expect(p.skip()).toEqual([]);
	});
});
