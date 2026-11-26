// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { Quote } from "@prismalens/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	heldForThread,
	holdForThread,
	type QuoteChip,
	setItemJumper,
	showQuoteSource,
} from "./quote";

const HERE = "11111111-1111-4111-8111-111111111111";
const SOURCE_A = "22222222-2222-4222-8222-222222222222";
const SOURCE_B = "33333333-3333-4333-8333-333333333333";

const chip = (
	threadId: string,
	key: string | undefined,
	text: string,
): QuoteChip => ({
	key: `${threadId}:${key ?? ""}:${text}`,
	quote: {
		source: { threadId, kind: "transcript", ...(key ? { key } : {}) },
		text,
	},
	cut: false,
});

describe("quotes held for a closed thread box (#1195)", () => {
	beforeEach(() => sessionStorage.clear());

	it("keeps two quotes of the same words from different messages, and drops a repeat of one message", () => {
		holdForThread(HERE, chip(SOURCE_A, "main:1", "Approved"));
		holdForThread(HERE, chip(SOURCE_B, "main:1", "Approved"));
		holdForThread(HERE, chip(SOURCE_A, "main:2", "Approved"));
		holdForThread(HERE, chip(SOURCE_A, "main:1", "Approved"));
		expect(
			heldForThread(HERE).map((h) => [
				h.quote.source.threadId,
				h.quote.source.key,
				h.quote.text,
			]),
		).toEqual([
			[SOURCE_A, "main:1", "Approved"],
			[SOURCE_B, "main:1", "Approved"],
			[SOURCE_A, "main:2", "Approved"],
		]);
	});
});

describe("a quote's source on its own thread's page (#1193)", () => {
	const quote = (key?: string): Quote => ({
		source: { threadId: SOURCE_A, kind: "transcript", ...(key ? { key } : {}) },
		text: "Approved",
	});
	beforeEach(() => {
		window.history.pushState({}, "", `/threads/${SOURCE_A}`);
		document.body.innerHTML =
			'<div data-testid="transcript"><p id="first">Approved by one</p><p id="second">Approved by two</p></div>';
	});
	afterEach(() => {
		setItemJumper(null);
		document.body.innerHTML = "";
	});

	it("jumps to the message by its key, not to the first row with the same words", () => {
		const jump = vi.fn();
		const scrolled = vi.fn();
		for (const id of ["first", "second"])
			(document.getElementById(id) as HTMLElement).scrollIntoView = scrolled;
		setItemJumper(jump);
		showQuoteSource(quote("main:7"));
		expect(jump.mock.calls).toEqual([["main:7"]]);
		expect(scrolled).not.toHaveBeenCalled();
	});

	it("finds an older quote with no key by its first line", () => {
		const jump = vi.fn();
		const scrolled = vi.fn();
		(document.getElementById("first") as HTMLElement).scrollIntoView = scrolled;
		setItemJumper(jump);
		showQuoteSource(quote());
		expect(jump).not.toHaveBeenCalled();
		expect(scrolled.mock.calls).toEqual([[{ block: "center" }]]);
	});
});
