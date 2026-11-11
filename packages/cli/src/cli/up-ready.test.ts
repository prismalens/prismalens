// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { readyLine } from "./up.js";

describe("readyLine", () => {
	it("names a nightly build and its version, and leaves a stable build's line as it was", () => {
		expect(readyLine("0.5.6-nightly.20261111.1", "http://127.0.0.1:6473")).toBe(
			"PrismaLens nightly 0.5.6-nightly.20261111.1 is ready at http://127.0.0.1:6473",
		);
		expect(readyLine("0.5.5", "http://127.0.0.1:6473")).toBe(
			"PrismaLens is ready at http://127.0.0.1:6473",
		);
	});
});
