// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * `report_exported {target}` at its Markdown call site (#602).
 *
 * The event says a report left the app and by which route. The filename, the
 * incident number and the Markdown itself never go with it — that is the whole
 * point of a closed taxonomy, and this asserts the payload rather than trusting
 * the call site to stay honest.
 */

import { ORPCError } from "@orpc/nest";
import { describe, expect, it, vi } from "vitest";
import { telemetryStub } from "../../../test/factories/index.js";
import type { DispatchService } from "../../infrastructure/dispatch/dispatch.service.js";
import { InvestigationsController } from "./investigations.controller.js";
import type { InvestigationsService } from "./investigations.service.js";

const REPORT = {
	summary: "checkout-api exhausted its connection pool after deploy 41.",
	rootCause: "Pool size dropped from 50 to 5 in deploy 41.",
	rootCauseCategory: "config",
	hypotheses: [
		{
			statement: "Pool size misconfigured",
			status: "confirmed",
			evidence: [
				{
					observation: "DB_POOL_SIZE=5 in the new manifest",
					source: "git show 41:deploy.yaml",
					direction: "supports",
					status: "verified",
				},
			],
		},
	],
	ruledOut: [
		{
			statement: "Database outage",
			why: "Primary answered throughout",
			evidence: [
				{
					observation: "No failover events",
					source: "logs",
					direction: "contradicts",
					status: "inferred",
				},
			],
		},
	],
	coverage: { queried: ["git", "logs"], notQueried: ["metrics"] },
	nextSteps: [
		{ title: "Restore pool size", detail: "Set it back to 50", priority: "high" },
	],
	fidelity: {
		harness: "opencode",
		mode: "read-only",
		fidelity: "cooperative",
		mechanism: "permission policy",
	},
};

function exportHandler(investigation: unknown) {
	const telemetry = telemetryStub();
	const controller = new InvestigationsController(
		{ findById: vi.fn(async () => investigation) } as unknown as InvestigationsService,
		{} as DispatchService,
		telemetry,
	);
	const procs = controller.investigations() as unknown as Record<
		string,
		{ "~orpc": { handler: (a: { input: unknown }) => Promise<unknown> } }
	>;
	return { handler: procs.exportMarkdown["~orpc"].handler, telemetry };
}

describe("report_exported on the Markdown route", () => {
	it("counts the export, carrying only the target", async () => {
		const { handler, telemetry } = exportHandler({
			id: "inv-1",
			report: JSON.stringify(REPORT),
			completedAt: new Date("2026-09-01T00:00:00Z"),
			incident: { number: 7, title: "Checkout 500s" },
		});

		await handler({ input: { id: "inv-1" } });

		expect(telemetry.capture).toHaveBeenCalledTimes(1);
		expect(telemetry.capture).toHaveBeenCalledWith("report_exported", {
			target: "markdown",
		});
	});

	it("counts nothing when there is no report to export", async () => {
		const { handler, telemetry } = exportHandler({
			id: "inv-2",
			report: null,
			incident: { number: 8, title: "No report" },
		});

		await expect(handler({ input: { id: "inv-2" } })).rejects.toBeInstanceOf(
			ORPCError,
		);
		expect(telemetry.capture).not.toHaveBeenCalled();
	});
});
