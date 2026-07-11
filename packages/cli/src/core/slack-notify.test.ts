// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ConductedOutcome } from "@prismalens/engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSlackMessage, notifyRun } from "./slack-notify.js";

describe("slack-notify", () => {
	describe("buildSlackMessage", () => {
		it("formats a success report with hypotheses", () => {
			const outcome: ConductedOutcome = {
				runId: "run-123",
				failureKind: "none",
				error: null,
				report: {
					summary: "We found the issue.",
					rootCause: "Database is down.",
					hypotheses: [
						{
							statement: "DB process crashed",
							status: "confirmed",
							evidence: [{} as any, {} as any],
						},
					],
				} as any,
			};
			const msg = buildSlackMessage({
				alertname: "TargetDown",
				runId: "run-123",
				outcome,
			});
			expect(msg).toContain("TargetDown");
			expect(msg).toContain("We found the issue.");
			expect(msg).toContain("Root cause: Database is down.");
			expect(msg).toContain("Top hypothesis: DB process crashed (2 evidence)");
			expect(msg).toContain("Run run-123 — pl report run-123");
		});

		it("formats a success report without hypotheses", () => {
			const outcome: ConductedOutcome = {
				runId: "run-124",
				failureKind: "none",
				error: null,
				report: {
					summary: "All good now.",
					rootCause: null,
					hypotheses: [],
				} as any,
			};
			const msg = buildSlackMessage({
				alertname: "CpuHigh",
				runId: "run-124",
				outcome,
			});
			expect(msg).toContain("CpuHigh");
			expect(msg).toContain("All good now.");
			expect(msg).toContain("Root cause: not determined");
			expect(msg).not.toContain("Top hypothesis");
			expect(msg).toContain("Run run-124 — pl report run-124");
		});

		it("formats a no-evidence report", () => {
			const outcome: ConductedOutcome = {
				runId: "run-125",
				failureKind: "no-evidence",
				error: "insufficient data",
				report: null,
			};
			const msg = buildSlackMessage({
				alertname: "API5xx",
				runId: "run-125",
				outcome,
			});
			expect(msg).toContain("API5xx");
			expect(msg).toContain(
				"Investigated — insufficient evidence to determine a cause.",
			);
			expect(msg).toContain("Run run-125 — pl report run-125");
		});

		it("formats an errored report", () => {
			const outcome: ConductedOutcome = {
				runId: "run-126",
				failureKind: "error",
				error: "boom",
				report: null,
			};
			const msg = buildSlackMessage({
				alertname: "OOMKilled",
				runId: "run-126",
				outcome,
			});
			expect(msg).toContain("OOMKilled");
			expect(msg).toContain("Investigation errored: boom");
			expect(msg).toContain("Run run-126 — pl report run-126");
		});

		it("returns empty string for cancelled runs", () => {
			const outcome: ConductedOutcome = {
				runId: "run-127",
				failureKind: "cancelled",
				error: "user abort",
				report: null,
			};
			const msg = buildSlackMessage({
				alertname: "TestAlert",
				runId: "run-127",
				outcome,
			});
			expect(msg).toBe("");
		});
	});

	describe("notifyRun", () => {
		let fetchMock: any;
		let consoleErrorSpy: any;

		beforeEach(() => {
			fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			consoleErrorSpy.mockRestore();
		});

		it("does not post if the run was cancelled", async () => {
			const outcome: ConductedOutcome = {
				runId: "run-127",
				failureKind: "cancelled",
				error: "user abort",
				report: null,
			};
			await notifyRun("http://slack.test", "TestAlert", outcome);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("posts successfully", async () => {
			fetchMock.mockResolvedValueOnce({ ok: true });
			const outcome: ConductedOutcome = {
				runId: "run-128",
				failureKind: "error",
				error: "boom",
				report: null,
			};
			await notifyRun("http://slack.test", "TestAlert", outcome);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).not.toHaveBeenCalled();

			const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe("http://slack.test");
			expect(request.method).toBe("POST");
			expect(request.headers).toEqual({ "Content-Type": "application/json" });
			const parsedBody = JSON.parse(request.body as string);
			expect(parsedBody.text).toBe(
				"TestAlert\nInvestigation errored: boom\nRun run-128 — pl report run-128",
			);
		});

		it("isolates failures (the core invariant)", async () => {
			fetchMock.mockRejectedValueOnce(new Error("network error"));
			const outcome: ConductedOutcome = {
				runId: "run-129",
				failureKind: "error",
				error: "boom",
				report: null,
			};

			// Should not throw
			await notifyRun("http://slack.test", "TestAlert", outcome);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

			const errorLog = consoleErrorSpy.mock.calls[0][0];
			const parsed = JSON.parse(errorLog);
			expect(parsed.event).toBe("slack_delivery_failed");
			expect(parsed.runId).toBe("run-129");
			expect(parsed.error).toContain("network error");
		});

		it("isolates non-2xx failures", async () => {
			fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
			const outcome: ConductedOutcome = {
				runId: "run-130",
				failureKind: "error",
				error: "boom",
				report: null,
			};

			await notifyRun("http://slack.test", "TestAlert", outcome);

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

			const errorLog = consoleErrorSpy.mock.calls[0][0];
			const parsed = JSON.parse(errorLog);
			expect(parsed.event).toBe("slack_delivery_failed");
			expect(parsed.runId).toBe("run-130");
			expect(parsed.error).toContain("Slack webhook returned 500");
		});
	});
});
