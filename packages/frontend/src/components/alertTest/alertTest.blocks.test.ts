// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { alertTestCurl, genericCurl } from "./alertTest.blocks";

describe("alertTest.curl", () => {
	it("copies the exact generic webhook call, with the token as a placeholder", () => {
		const text = genericCurl("http://localhost:3000/api/webhooks/generic", "demo-proj");

		expect(alertTestCurl.text({ text })).toBe(
			[
				"curl -X POST http://localhost:3000/api/webhooks/generic \\",
				'  -H "Authorization: Bearer <TOKEN>" \\',
				'  -H "Content-Type: application/json" \\',
				`  -d '{"title":"Checkout is failing","severity":"high","serviceName":"demo-proj"}'`,
			].join("\n"),
		);
	});

	it("closes and reopens the single quote around an apostrophe in the service name", () => {
		const text = genericCurl("http://localhost:3000/api/webhooks/generic", "O'Brien");

		expect(text.split("\n").at(-1)).toBe(
			`  -d '{"title":"Checkout is failing","severity":"high","serviceName":"O'\\''Brien"}'`,
		);
	});
});
