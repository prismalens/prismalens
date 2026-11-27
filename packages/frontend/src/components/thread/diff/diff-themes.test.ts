// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DIFF_THEMES } from "./diff-themes";

const SRC = join(__dirname, "../../..");
const files = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? files(join(dir, e.name))
			: /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
				? [join(dir, e.name)]
				: [],
	);

// A view that sets its own theme type but not DIFF_THEMES draws the library's default colours,
// which fail AA on our surfaces (#1238): the gallery's WorktreeDiff did, after five views were moved.
describe("diff themes", () => {
	it("every @pierre/diffs view that picks a theme type takes DIFF_THEMES", () => {
		const views = files(SRC).filter((f) => {
			const src = readFileSync(f, "utf8");
			return src.includes("@pierre/diffs") && /\bthemeType:/.test(src);
		});
		const missing = views.filter(
			(f) => !readFileSync(f, "utf8").includes("theme: DIFF_THEMES"),
		);
		expect(views.length).toBeGreaterThanOrEqual(6);
		expect(missing).toEqual([]);
	});

	it("the shared worker pool draws with DIFF_THEMES", async () => {
		vi.doMock("@pierre/diffs/worker/worker.js?worker", () => ({
			default: class {},
		}));
		const { POOL } = await import("@/components/run/EvidenceFileView");
		expect(POOL.highlighterOptions).toMatchObject({ theme: DIFF_THEMES });
	});
});
