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

		it("returns refusal for requiresHost on permission ask", () => {
			const res = askRefusal(
				{ kind: "permission", requiresHost: true },
				false,
				false,
			);
			expect(res).toEqual({
				who: "Only the computer running PrismaLens can approve this.",
				why: "A PrismaLens tool asked, and its answers stay on that computer.",
			});
		});

		it("returns refusal for hostOnlyRun on question ask", () => {
			const res = askRefusal(
				{ kind: "question", requiresHost: false },
				false,
				true,
			);
			expect(res).toEqual({
				who: "Only the computer running PrismaLens can answer this.",
				why: "PrismaLens started this run, so its asks stay on that computer.",
			});
		});
	});
});
