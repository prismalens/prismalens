// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { describe, expect, it } from "vitest";
import {
	annotateModel,
	BUNDLED_MODEL_CATALOGUE,
	type ModelCatalogue,
	parseModelCatalogue,
	pickModelCatalogue,
} from "./model-catalogue.js";

// Synthetic names only: adding a model to the JSON never touches this file.
const base: ModelCatalogue = {
	version: 1,
	updatedAt: "2026-01-01T00:00:00Z",
	harnesses: {
		alpha: {
			models: [
				{ id: "alpha/one", name: "One", status: "current" },
				{ id: "alpha/old", name: "Old", status: "legacy" },
			],
		},
	},
};
const newer = {
	...base,
	updatedAt: "2026-02-01T00:00:00Z",
	harnesses: { alpha: { models: [{ id: "alpha/two", name: "Two", status: "current" }] } },
};

describe("model catalogue (#639)", () => {
	it("the bundled file parses", () => {
		expect(BUNDLED_MODEL_CATALOGUE.version).toBe(1);
	});

	it("updatedAt decides, not which copy was read last", () => {
		expect(pickModelCatalogue(newer, base)).toMatchObject({ source: "operator", catalogue: { updatedAt: newer.updatedAt } });
		expect(pickModelCatalogue(base, newer as ModelCatalogue)).toMatchObject({ source: "bundled", catalogue: { updatedAt: newer.updatedAt } });
		expect(pickModelCatalogue(undefined, base)).toEqual({ catalogue: base, source: "bundled" });
	});

	it("an invalid copy keeps the last good one and says why", () => {
		const picked = pickModelCatalogue({ version: 1, updatedAt: "yesterday", harnesses: {} }, base);
		expect(picked.catalogue).toBe(base);
		expect(picked.warning).toMatch(/updatedAt/);
		expect(pickModelCatalogue("not json at all", base).catalogue).toBe(base);
	});

	it("tolerates fields and status words it does not know", () => {
		const parsed = parseModelCatalogue({
			...newer,
			futureField: true,
			harnesses: { alpha: { models: [{ id: "alpha/x", name: "X", status: "preview", badge: "new" }] } },
		});
		expect("catalogue" in parsed && parsed.catalogue.harnesses.alpha.models[0].status).toBe("preview");
	});

	it("annotates, never rejects", () => {
		expect(annotateModel(base, "alpha", "alpha/old")).toMatchObject({ known: true, entry: { status: "legacy" } });
		expect(annotateModel(base, "alpha", "alpha/typed-by-hand")).toEqual({ known: false });
		expect(annotateModel(base, "beta", "anything")).toEqual({ known: false });
	});
});
