// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// No shipped model id appears in this file; adding a model to the JSON never touches a test.

import { describe, expect, it } from "vitest";
import { HARNESS_IDS } from "./harness.js";
import {
	annotateModel,
	catalogueModels,
	loadModelCatalogue,
	MODEL_CATALOGUE,
} from "./model-catalogue.js";

const validFixture = {
	updatedAt: "2026-09-20",
	harnesses: {
		opencode: {
			idFormat: "test-format",
			models: [
				{
					id: "test/synthetic-a",
					label: "Synthetic A",
					status: "current" as const,
					note: "first test model",
				},
				{
					id: "test/synthetic-b",
					label: "Synthetic B",
					status: "legacy" as const,
				},
			],
		},
		"claude-code": {
			idFormat: "test-format",
			models: [],
		},
		codex: {
			idFormat: "test-format",
			models: [],
		},
		gemini: {
			idFormat: "test-format",
			models: [],
		},
		deepagents: {
			idFormat: "test-format",
			models: [],
		},
	},
};

describe("loadModelCatalogue", () => {
	it("parses a valid fixture and catalogueModels returns its entries in file order", () => {
		const fx = loadModelCatalogue(validFixture);
		const models = catalogueModels("opencode", fx);
		expect(models).toHaveLength(2);
		expect(models[0].id).toBe("test/synthetic-a");
		expect(models[1].id).toBe("test/synthetic-b");
		expect(models).toEqual(validFixture.harnesses.opencode.models);
	});

	it("fails when a fixture is missing a harness key", () => {
		const { deepagents: _, ...missingHarness } = validFixture.harnesses;
		const invalid = { ...validFixture, harnesses: missingHarness };
		expect(() => loadModelCatalogue(invalid)).toThrow();
	});

	it("fails when a model has an unknown status", () => {
		const invalid = {
			...validFixture,
			harnesses: {
				...validFixture.harnesses,
				opencode: {
					...validFixture.harnesses.opencode,
					models: [
						{
							id: "test/synthetic-c",
							label: "Synthetic C",
							status: "deprecated",
						},
					],
				},
			},
		};
		expect(() => loadModelCatalogue(invalid)).toThrow();
	});

	it("fails when duplicate model ids exist within one harness", () => {
		const invalid = {
			...validFixture,
			harnesses: {
				...validFixture.harnesses,
				opencode: {
					...validFixture.harnesses.opencode,
					models: [
						{
							id: "test/synthetic-d",
							label: "Synthetic D First",
							status: "current",
						},
						{
							id: "test/synthetic-d",
							label: "Synthetic D Duplicate",
							status: "legacy",
						},
					],
				},
			},
		};
		expect(() => loadModelCatalogue(invalid)).toThrow();
	});

	it('fails when updatedAt does not match regex (e.g. "2026-9-1")', () => {
		const invalid = {
			...validFixture,
			updatedAt: "2026-9-1",
		};
		expect(() => loadModelCatalogue(invalid)).toThrow();
	});
});

describe("annotateModel", () => {
	const fx = loadModelCatalogue(validFixture);

	it("annotates a listed model with listed: true and the entry", () => {
		const result = annotateModel("opencode", "test/synthetic-a", fx);
		expect(result).toEqual({
			listed: true,
			entry: validFixture.harnesses.opencode.models[0],
			catalogueAt: "2026-09-20",
		});
	});

	it("annotates an unlisted model on a harness with entries with listed: false", () => {
		const result = annotateModel("opencode", "test/synthetic-z", fx);
		expect(result).toEqual({
			listed: false,
			catalogueAt: "2026-09-20",
		});
	});

	it("returns listed: null for any id on a harness with models: []", () => {
		const result = annotateModel("claude-code", "test/synthetic-a", fx);
		expect(result).toEqual({
			listed: null,
			catalogueAt: "2026-09-20",
		});
	});

	it('returns listed: null for whitespace-only id ("  ")', () => {
		const result = annotateModel("opencode", "  ", fx);
		expect(result).toEqual({
			listed: null,
			catalogueAt: "2026-09-20",
		});
	});

	it("treats case differences as unlisted (exact match)", () => {
		const result = annotateModel("opencode", "test/SYNTHETIC-A", fx);
		expect(result).toEqual({
			listed: false,
			catalogueAt: "2026-09-20",
		});
	});
});

describe("shipped MODEL_CATALOGUE", () => {
	it("loads and matches the date regex and catalogue shape without asserting model names", () => {
		expect(MODEL_CATALOGUE).toBeDefined();
		expect(MODEL_CATALOGUE.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(MODEL_CATALOGUE.harnesses).toBeDefined();
		for (const harnessId of HARNESS_IDS) {
			expect(MODEL_CATALOGUE.harnesses[harnessId]).toBeDefined();
			expect(typeof MODEL_CATALOGUE.harnesses[harnessId].idFormat).toBe("string");
			expect(Array.isArray(MODEL_CATALOGUE.harnesses[harnessId].models)).toBe(true);
		}
	});
});
