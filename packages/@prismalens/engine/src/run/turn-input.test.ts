// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { turnInputOf } from "./turn-input.js";

const TOKEN = "ghp_plantedTokenValue123";

describe("turnInputOf (#1166)", () => {
	it("scrubs a hidden value from the system part, text, link name and link URI, and keeps images by size", () => {
		const body = turnInputOf(
			[
				{ type: "text", text: `use ${TOKEN} to push` },
				{ type: "image", mimeType: "image/png", data: "aGVsbG8=" },
				{
					type: "resource_link",
					name: `${TOKEN}.txt`,
					uri: `file:///tmp/${TOKEN}/a.txt`,
				},
			],
			`brief with ${TOKEN}`,
			[TOKEN],
		);
		expect(JSON.stringify(body)).not.toContain(TOKEN);
		expect(body.parts).toEqual([
			{ type: "system", text: "brief with [redacted]" },
			{ type: "text", text: "use [redacted] to push" },
			{ type: "image", mimeType: "image/png", bytes: 5 },
			{
				type: "link",
				name: "[redacted].txt",
				uri: "file:///tmp/[redacted]/a.txt",
			},
		]);
		expect(body.chars).toBe(
			"brief with [redacted]".length + "use [redacted] to push".length,
		);
	});

	it("has no system part when there is no brief", () => {
		const body = turnInputOf([{ type: "text", text: "hi" }], null, []);
		expect(body.parts.map((p) => p.type)).toEqual(["text"]);
		expect(body.chars).toBe(2);
	});
});
