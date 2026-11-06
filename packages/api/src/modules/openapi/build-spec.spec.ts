// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { buildOpenApiSpec } from "./build-spec.js";

describe("the OpenAPI document (#547, #1024)", () => {
	let paths: string[];
	beforeAll(async () => {
		const spec = await buildOpenApiSpec([{ url: "/api", description: "test" }]);
		expect(spec.openapi).toMatch(/^3\./);
		expect(spec.servers).toEqual([{ url: "/api", description: "test" }]);
		paths = Object.keys(spec.paths ?? {});
	}, 60_000);

	it("generates from the contract, known routes included", () => {
		expect(paths.length).toBeGreaterThan(50);
		expect(paths).toEqual(
			expect.arrayContaining([
				"/threads",
				"/settings/about",
				"/drafts/{scope}",
				"/references/search",
				"/investigations/{id}/asks/{askId}",
			]),
		);
	});

	it("W13 removal regression: the routes removed then stay removed", () => {
		expect(paths).not.toContain("/report/github");
		expect(paths).not.toContain("/git/repositories");
		expect(paths).not.toContain("/git/organizations");
		expect(paths).not.toContain("/repositories/batch");
	});
});
