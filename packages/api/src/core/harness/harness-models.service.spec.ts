// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_MODEL_CATALOGUE } from "@prismalens/config/harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	HarnessModelsService,
	OPERATOR_CATALOGUE_FILE,
} from "./harness-models.service.js";

describe("HarnessModelsService (#639)", () => {
	let dir: string;
	let service: HarnessModelsService;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pl-models-"));
		service = new HarnessModelsService();
		service.workspaceDir = () => dir;
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const dropIn = (value: unknown) =>
		writeFileSync(
			join(dir, OPERATOR_CATALOGUE_FILE),
			typeof value === "string" ? value : JSON.stringify(value),
		);

	it("uses the bundled catalogue when no drop-in exists", () => {
		expect(service.catalogue()).toBe(BUNDLED_MODEL_CATALOGUE);
		expect(service.modelsFor("opencode").source).toBe("catalogue");
	});

	it("a newer drop-in wins; an older or broken one keeps the bundled catalogue", () => {
		const newer = {
			version: 1,
			updatedAt: "2999-01-01T00:00:00Z",
			harnesses: { opencode: { models: [{ id: "x/synthetic", name: "Synthetic", status: "current" }] } },
		};
		dropIn(newer);
		expect(service.modelsFor("opencode").entries.map((m) => m.id)).toEqual(["x/synthetic"]);
		dropIn({ ...newer, updatedAt: "2000-01-01T00:00:00Z" });
		expect(service.catalogue()).toBe(BUNDLED_MODEL_CATALOGUE);
		dropIn("{ not json");
		expect(service.catalogue()).toBe(BUNDLED_MODEL_CATALOGUE);
	});

	it("the harness's own list wins once a check saw one, and an empty list forgets it", () => {
		service.remember("opencode", [{ id: "x/offered", name: "Offered" }]);
		const models = service.modelsFor("opencode");
		expect(models.source).toBe("harness");
		expect(models.entries).toEqual([{ id: "x/offered", name: "Offered", status: null }]);
		service.remember("opencode", []);
		expect(service.modelsFor("opencode").source).toBe("catalogue");
	});
});
