// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { activeTrigger, removeTrigger } from "./trigger";

describe("activeTrigger and removeTrigger (#1024)", () => {
	it("/ opens only at the start of a line", () => {
		expect(activeTrigger("/rev", 4)).toEqual({
			trigger: "/",
			query: "rev",
			start: 0,
			end: 4,
		});
		expect(activeTrigger("a /rev", 6)).toBeNull();
		expect(activeTrigger("a\n/rev", 6)).toEqual({
			trigger: "/",
			query: "rev",
			start: 2,
			end: 6,
		});
	});

	it("@ and # open at the start or after whitespace", () => {
		expect(activeTrigger("hi @PR", 6)).toEqual({
			trigger: "@",
			query: "PR",
			start: 3,
			end: 6,
		});
		expect(activeTrigger("a@b", 3)).toBeNull();
	});

	it("operator rule: @sam and more words with the caret at the end yields null", () => {
		const text = "@sam and more words";
		expect(activeTrigger(text, text.length)).toBeNull();
	});

	it("removeTrigger removes the trigger and query cleanly", () => {
		expect(removeTrigger("ask @PRd now", { start: 4, end: 8 })).toEqual({
			text: "ask now",
			caret: 4,
		});
	});
});
