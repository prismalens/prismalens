// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { httpUrlOrNull } from "./safe-url.js";

describe("httpUrlOrNull", () => {
	it("keeps http and https", () => {
		expect(httpUrlOrNull("https://prom.internal/graph?g0.expr=up")).toBe(
			"https://prom.internal/graph?g0.expr=up",
		);
		expect(httpUrlOrNull("http://localhost:9090")).toBe("http://localhost:9090/");
	});

	it("drops every other scheme and non-URLs", () => {
		expect(httpUrlOrNull("javascript:alert(1)")).toBeNull();
		expect(httpUrlOrNull("data:text/html,<b>x</b>")).toBeNull();
		expect(httpUrlOrNull("file:///etc/passwd")).toBeNull();
		expect(httpUrlOrNull("not a url")).toBeNull();
		expect(httpUrlOrNull("")).toBeNull();
		expect(httpUrlOrNull(null)).toBeNull();
	});
});
