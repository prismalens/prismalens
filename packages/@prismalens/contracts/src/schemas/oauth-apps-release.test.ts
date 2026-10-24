// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = (name: string) =>
	readFileSync(new URL(`../../../../../.github/workflows/${name}`, import.meta.url), "utf8");

/** Every channel that ships a build writes the PrismaLens app IDs first (#848, OBJ-030). */
describe("release channels carry the shipped OAuth apps", () => {
	for (const name of ["release.yml", "standalone.yml", "desktop.yml"])
		it(`${name} writes the app IDs before pnpm build`, () => {
			const yml = workflow(name);
			const write = yml.indexOf("node scripts/write-oauth-apps.mjs");
			expect(write).toBeGreaterThan(-1);
			expect(write).toBeLessThan(yml.indexOf("run: pnpm build"));
			expect(yml).toContain("OAUTH_APP_GITHUB_CLIENT_ID: ${{ secrets.OAUTH_APP_GITHUB_CLIENT_ID }}");
		});

	it("release.yml passes its secrets to the standalone and desktop builds", () => {
		const yml = workflow("release.yml");
		for (const job of ["standalone.yml", "desktop.yml"]) {
			const at = yml.indexOf(`uses: ./.github/workflows/${job}`);
			const block = yml.slice(at, yml.indexOf("\n\n", at));
			expect(block).toContain("secrets: inherit");
		}
	});
});
