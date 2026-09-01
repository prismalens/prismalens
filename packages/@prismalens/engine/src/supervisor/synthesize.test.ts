// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * Hermetic test for the `reportMode` provenance guard: it is host-stamped
 * run-metadata, exactly like `fidelity` (ADR-0017), so the model must never
 * be able to set its own value. Mocks the `ai` SDK's `generateObject` — no
 * network, no credentials, no real model.
 */
import { generateObject } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeReport } from "./synthesize.js";

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>();
	return {
		...actual,
		generateObject: vi.fn(),
	};
});

// This package's vitest.config.ts sets no clearMocks/mockReset/restoreMocks, so
// the module-level mock above accumulates calls across tests — without this,
// the second test's `mock.calls[0]` would read the FIRST test's invocation.
beforeEach(() => {
	vi.mocked(generateObject).mockClear();
});

const CFG = {
	providerId: "custom" as const,
	model: "stub-model",
	baseURL: "http://localhost:0",
	configured: true,
};

describe("synthesize — reportMode provenance (host-stamped, not model-authored)", () => {
	it("a model returning reportMode:\"raw\" still yields reportMode:\"synthesized\"", async () => {
		vi.mocked(generateObject).mockResolvedValueOnce({
			object: {
				summary: "s",
				rootCause: null,
				rootCauseCategory: null,
				culprit: null,
				hypotheses: [],
				ruledOut: [],
				coverage: { queried: [], notQueried: [] },
				nextSteps: [],
				// A model ignoring/exploiting the schema and emitting its own
				// provenance — this must never survive into the returned report.
				reportMode: "raw",
			},
			usage: { inputTokens: 1, outputTokens: 1 },
			// biome-ignore lint/suspicious/noExplicitAny: minimal AI SDK result stub
		} as any);

		const out = await synthesizeReport("transcript", CFG);

		expect(out.reportMode).toBe("synthesized");
	});

	it("omits reportMode from the schema handed to generateObject", async () => {
		vi.mocked(generateObject).mockResolvedValueOnce({
			object: {
				summary: "s",
				rootCause: null,
				rootCauseCategory: null,
				culprit: null,
				hypotheses: [],
				ruledOut: [],
				coverage: { queried: [], notQueried: [] },
				nextSteps: [],
			},
			usage: { inputTokens: 1, outputTokens: 1 },
			// biome-ignore lint/suspicious/noExplicitAny: minimal AI SDK result stub
		} as any);

		await synthesizeReport("transcript", CFG);

		const call = vi.mocked(generateObject).mock.calls[0]?.[0];
		// biome-ignore lint/suspicious/noExplicitAny: zod internals, test-only introspection
		const schemaShape = (call?.schema as any)?.shape;
		expect(schemaShape).toBeDefined();
		expect(schemaShape.reportMode).toBeUndefined();
		expect(schemaShape.fidelity).toBeUndefined();
	});
});
