// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import { handover, triggered } from "./attention.service.js";

describe("handover and triggered (#1101 categories 3 and 4)", () => {
	describe("handover", () => {
		it("null -> both null", () => {
			expect(handover(null)).toEqual({ cause: null, command: null });
		});

		it("invalid JSON -> both null", () => {
			expect(handover("{invalid-json")).toEqual({
				cause: null,
				command: null,
			});
		});

		it("report with rootCause and nextSteps [{title,detail},{title,detail,command:\"kubectl x\"}] -> {cause, command:\"kubectl x\"}", () => {
			const raw = JSON.stringify({
				rootCause: "Database disk is full",
				nextSteps: [
					{ title: "Check logs", detail: "View stderr output" },
					{
						title: "Clean storage",
						detail: "Run cleanup",
						command: "kubectl x",
					},
				],
			});
			expect(handover(raw)).toEqual({
				cause: "Database disk is full",
				command: "kubectl x",
			});
		});
	});

	describe("triggered", () => {
		it("scheduleId set -> true", () => {
			expect(
				triggered({
					scheduleId: "sched-123",
					triggerType: null,
					incidentId: null,
				}),
			).toBe(true);
		});

		it("triggerType manual -> false", () => {
			expect(
				triggered({
					scheduleId: null,
					triggerType: "manual",
					incidentId: null,
				}),
			).toBe(false);
		});

		it("re_trigger -> false", () => {
			expect(
				triggered({
					scheduleId: null,
					triggerType: "re_trigger",
					incidentId: null,
				}),
			).toBe(false);
		});

		it("auto_critical -> true", () => {
			expect(
				triggered({
					scheduleId: null,
					triggerType: "auto_critical",
					incidentId: null,
				}),
			).toBe(true);
		});

		it("incidentId set with triggerType null -> true", () => {
			expect(
				triggered({
					scheduleId: null,
					triggerType: null,
					incidentId: "inc-123",
				}),
			).toBe(true);
		});

		it("all null -> false", () => {
			expect(
				triggered({
					scheduleId: null,
					triggerType: null,
					incidentId: null,
				}),
			).toBe(false);
		});
	});
});
