// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic parse round-trip for the structured honest-fidelity sandbox field
 * (ADR-0017 honest fidelity + ADR-0020 Sandbox port, B.1.1 follow-up):
 * `RunFidelitySchema.sandbox` is ADDITIVE — a run with no boundary wired must
 * still parse, and a run with one wired must round-trip losslessly. No
 * network/LLM.
 */
import { describe, expect, it } from "vitest";
import {
	CulpritSchema,
	InvestigationReportSchema,
	InvestigationSchema,
	RunFidelitySchema,
} from "./investigation.js";

describe("RunFidelitySchema (ADR-0017/ADR-0020 sandbox field)", () => {
	it("parses without a sandbox (no boundary wired — e.g. the in-process harness)", () => {
		const input = {
			harness: "claude-code",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism: "native permission flags",
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed.sandbox).toBeUndefined();
		expect(parsed).toEqual(input);
	});

	it("round-trips with a sandbox — requested === actual (no degrade)", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism:
				"native permission flags · sandbox=process-floor (cooperative)",
			sandbox: {
				requested: "process",
				actual: "process-floor",
				fidelity: "cooperative",
			},
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed).toEqual(input);
	});

	it("round-trips with a sandbox — requested !== actual (the auto-degrade case)", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism:
				"native permission flags · sandbox=process-floor (cooperative)",
			sandbox: {
				requested: "auto",
				actual: "process-floor",
				fidelity: "cooperative",
			},
		};
		const parsed = RunFidelitySchema.parse(input);
		expect(parsed).toEqual(input);
		expect(parsed.sandbox?.requested).not.toBe(parsed.sandbox?.actual);
	});

	it("rejects an unknown sandbox.fidelity value (only enforced|cooperative — no 'advisory')", () => {
		const input = {
			harness: "deepagents",
			mode: "read-only",
			fidelity: "cooperative",
			mechanism: "x",
			sandbox: { requested: "auto", actual: "srt", fidelity: "advisory" },
		};
		expect(() => RunFidelitySchema.parse(input)).toThrow();
	});
});

describe("CulpritSchema and InvestigationReportSchema culprit (ADR-0026)", () => {
	it("culprit round-trip (present, partial-null, absent)", () => {
		const baseReport = {
			summary: "Investigation summary",
			rootCause: "Database pool exhausted",
			rootCauseCategory: "infrastructure" as const,
			hypotheses: [],
			ruledOut: [],
			coverage: { queried: ["prometheus"], notQueried: [] },
			nextSteps: [],
		};

		// 1. Present with all fields filled
		const reportWithFullCulprit = {
			...baseReport,
			culprit: {
				service: "payment-service",
				changeRef: "deploy-v1.4.2",
				mechanism: "connection-pool exhaustion",
			},
		};
		const parsedFull = InvestigationReportSchema.parse(reportWithFullCulprit);
		expect(parsedFull.culprit).toEqual({
			service: "payment-service",
			changeRef: "deploy-v1.4.2",
			mechanism: "connection-pool exhaustion",
		});

		// 2. Partial-null culprit
		const reportWithPartialCulprit = {
			...baseReport,
			culprit: {
				service: "payment-service",
				changeRef: null,
				mechanism: null,
			},
		};
		const parsedPartial =
			InvestigationReportSchema.parse(reportWithPartialCulprit);
		expect(parsedPartial.culprit).toEqual({
			service: "payment-service",
			changeRef: null,
			mechanism: null,
		});

		// 3. Explicit null culprit is preserved
		const parsedNull = InvestigationReportSchema.parse({
			...baseReport,
			culprit: null,
		});
		expect(parsedNull.culprit).toBeNull();

		// 4. Omitted nullable properties default to null
		const parsedDefaults = CulpritSchema.parse({ service: "payment-service" });
		expect(parsedDefaults).toEqual({
			service: "payment-service",
			changeRef: null,
			mechanism: null,
		});

		// 5. Absent culprit
		const parsedAbsent = InvestigationReportSchema.parse(baseReport);
		expect(parsedAbsent.culprit).toBeUndefined();
	});
});

describe("InvestigationSchema envelope record identity stamps (ADR-0026)", () => {
	const validUUID1 = "123e4567-e89b-12d3-a456-426614174000";
	const validUUID2 = "123e4567-e89b-12d3-a456-426614174001";

	it("defaults schemaVersion to 1 and origin to 'local'", () => {
		const rawRecord = {
			id: validUUID1,
			incidentId: validUUID2,
			status: "completed",
			startedAt: "2026-07-31T00:00:00.000Z",
			completedAt: "2026-07-31T00:05:00.000Z",
			summary: "Done",
			rootCause: null,
			rootCauseCategory: null,
			error: null,
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:05:00.000Z",
		};
		const parsed = InvestigationSchema.parse(rawRecord);
		expect(parsed.origin).toBe("local");
		expect(parsed.schemaVersion).toBe(1);
	});

	it("preserves explicit origin and schemaVersion when provided", () => {
		const rawRecord = {
			id: validUUID1,
			incidentId: validUUID2,
			status: "completed",
			startedAt: null,
			completedAt: null,
			summary: null,
			rootCause: null,
			rootCauseCategory: null,
			error: null,
			origin: "cloud-cluster-us-east",
			schemaVersion: 2,
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:05:00.000Z",
		};
		const parsed = InvestigationSchema.parse(rawRecord);
		expect(parsed.origin).toBe("cloud-cluster-us-east");
		expect(parsed.schemaVersion).toBe(2);
	});

	it("old-shaped record without new fields still parses (back-compat)", () => {
		const oldRecord = {
			id: validUUID1,
			incidentId: validUUID2,
			status: "pending",
			startedAt: null,
			completedAt: null,
			summary: null,
			rootCause: null,
			rootCauseCategory: null,
			error: null,
			createdAt: "2026-07-31T00:00:00.000Z",
			updatedAt: "2026-07-31T00:00:00.000Z",
		};
		expect(() => InvestigationSchema.parse(oldRecord)).not.toThrow();
	});
});
