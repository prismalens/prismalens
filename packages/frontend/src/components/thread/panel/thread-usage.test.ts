// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { contextWords, costWords, sessionWord, tokenWords } from "./thread-usage";

describe("thread-usage (#1176)", () => {
	describe("contextWords", () => {
		it('returns "Not reported" when usage or context is missing or size <= 0', () => {
			expect(contextWords(undefined)).toEqual({
				text: "Not reported",
				tone: undefined,
			});
			expect(
				contextWords({
					context: null,
					turns: 0,
					tokens: { total: 0 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "Not reported",
				tone: undefined,
			});
			expect(
				contextWords({
					context: { used: 100, size: 0 } as any,
					turns: 1,
					tokens: { total: 100 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "Not reported",
				tone: undefined,
			});
		});

		it("formats context words without tone below 80%", () => {
			expect(
				contextWords({
					context: { used: 79_000, size: 100_000 } as any,
					turns: 1,
					tokens: { total: 79_000 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "79K of 100K",
				tone: undefined,
			});
		});

		it("returns warn tone at 80% to below 90%", () => {
			expect(
				contextWords({
					context: { used: 80_000, size: 100_000 } as any,
					turns: 1,
					tokens: { total: 80_000 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "80K of 100K",
				tone: "warn",
			});
			expect(
				contextWords({
					context: { used: 89_999, size: 100_000 } as any,
					turns: 1,
					tokens: { total: 89_999 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "90K of 100K",
				tone: "warn",
			});
		});

		it("returns danger tone at 90% or above", () => {
			expect(
				contextWords({
					context: { used: 90_000, size: 100_000 } as any,
					turns: 1,
					tokens: { total: 90_000 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "90K of 100K",
				tone: "danger",
			});
			expect(
				contextWords({
					context: { used: 95_000, size: 100_000 } as any,
					turns: 1,
					tokens: { total: 95_000 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "95K of 100K",
				tone: "danger",
			});
		});
	});

	describe("tokenWords", () => {
		it("returns null when usage is undefined or turns === 0", () => {
			expect(tokenWords(undefined)).toBeNull();
			expect(
				tokenWords({
					context: null,
					turns: 0,
					tokens: { total: 0 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toBeNull();
		});

		it("formats singular turn and plural turns", () => {
			expect(
				tokenWords({
					context: null,
					turns: 1,
					tokens: { total: 840 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toBe("840, 1 turn");

			expect(
				tokenWords({
					context: null,
					turns: 5,
					tokens: { total: 2_200 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toBe("2.2K, 5 turns");
		});
	});

	describe("costWords", () => {
		it("returns null at 0 turns or undefined", () => {
			expect(costWords(undefined)).toBeNull();
			expect(
				costWords({
					context: null,
					turns: 0,
					tokens: { total: 0 } as any,
					costs: [],
					unpricedTurns: 0,
				}),
			).toBeNull();
		});

		it('returns "Not priced" when no costs or all turns are unpriced', () => {
			expect(
				costWords({
					context: null,
					turns: 3,
					tokens: { total: 500 } as any,
					costs: [],
					unpricedTurns: 3,
				}),
			).toEqual({
				text: "Not priced",
				hint: "3 turns sent no cost.",
			});

			expect(
				costWords({
					context: null,
					turns: 2,
					tokens: { total: 500 } as any,
					costs: [{ amount: 0.1, currency: "USD" }],
					unpricedTurns: 2,
				}),
			).toEqual({
				text: "Not priced",
				hint: "2 turns sent no cost.",
			});
		});

		it("formats mixed currencies listed and joins them with plus", () => {
			expect(
				costWords({
					context: null,
					turns: 4,
					tokens: { total: 500 } as any,
					costs: [
						{ amount: 0.15, currency: "USD" },
						{ amount: 1, currency: "EUR" },
					],
					unpricedTurns: 1,
				}),
			).toEqual({
				text: "0.15 USD + 1.00 EUR",
				hint: "1 turn sent no cost.",
			});

			expect(
				costWords({
					context: null,
					turns: 2,
					tokens: { total: 500 } as any,
					costs: [{ amount: 2.5, currency: "USD" }],
					unpricedTurns: 0,
				}),
			).toEqual({
				text: "2.50 USD",
				hint: null,
			});
		});
	});

	describe("sessionWord", () => {
		it('returns "Not recorded" when session is null or undefined', () => {
			expect(sessionWord(undefined)).toBe("Not recorded");
			expect(sessionWord(null)).toBe("Not recorded");
		});

		it('returns "Same session" for resume or load', () => {
			expect(sessionWord({ how: "resume" } as any)).toBe("Same session");
			expect(sessionWord({ how: "load" } as any)).toBe("Same session");
		});

		it('returns "New session" for other kinds', () => {
			expect(sessionWord({ how: "new" } as any)).toBe("New session");
			expect(sessionWord({ how: "fork" } as any)).toBe("New session");
		});
	});
});
