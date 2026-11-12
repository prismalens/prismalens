// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { askRefusal, startedByPrismaLens } from "./ask-refusal";

describe("ask-refusal", () => {
	describe("startedByPrismaLens", () => {
		it("returns true when scheduleId is set or triggerType is not manual", () => {
			expect(startedByPrismaLens({ scheduleId: "sch-1" })).toBe(true);
			expect(startedByPrismaLens({ triggerType: "alert" })).toBe(true);
			expect(startedByPrismaLens({ triggerType: "webhook" })).toBe(true);

			expect(startedByPrismaLens({ triggerType: "manual" })).toBe(false);
			expect(startedByPrismaLens({})).toBe(false);
			expect(
				startedByPrismaLens({ scheduleId: null, triggerType: "manual" }),
			).toBe(false);
		});
	});

	describe("askRefusal", () => {
		it("returns null when onHost is true", () => {
			expect(
				askRefusal(
					{ kind: "permission", requiresHost: true },
					true, // onHost
					true,
				),
			).toBe(null);
		});

		it("returns null when neither requiresHost nor hostOnlyRun is true", () => {
			expect(
				askRefusal(
					{ kind: "permission", requiresHost: false },
					false, // onHost = false
					false, // hostOnlyRun = false
				),
			).toBe(null);
		});

		it("refuses a tool's ask with the toolAsk sentence", () => {
			const res = askRefusal(
				{ kind: "permission", requiresHost: true },
				false,
				false,
			);
			expect(res).toEqual({
				reason: "toolAsk",
				text: "Only the computer running PrismaLens can answer this: a PrismaLens tool asked, and its answers stay on that computer.",
			});
		});

		it("refuses an ask in a run PrismaLens started with its own sentence, never a schedule's", () => {
			const res = askRefusal(
				{ kind: "question", requiresHost: false },
				false,
				true,
			);
			expect(res).toEqual({
				reason: "startedByPrismaLens",
				text: "Only the computer running PrismaLens can answer this: PrismaLens started the run, so its asks stay on that computer.",
			});
		});

		it("refuses a secret on a paired device with the secret sentence", () => {
			expect(
				askRefusal({ kind: "secret", requiresHost: false }, false, false),
			).toEqual({
				reason: "secret",
				text: "Only the computer running PrismaLens can answer this: a secret is typed on that computer, never sent from a paired device.",
			});
		});
	});
});
