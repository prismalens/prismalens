// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTheme } from "@pierre/diffs";
import ts from "typescript";
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

/** Every options object that picks a `themeType`, as `file:line`, with whether it passes `theme: DIFF_THEMES`. */
function viewerOptions(file: string) {
	const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
	const found: { at: string; themed: boolean }[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isObjectLiteralExpression(node)) {
			const prop = (name: string) =>
				node.properties.find(
					(p): p is ts.PropertyAssignment =>
						ts.isPropertyAssignment(p) && p.name.getText(src) === name,
				);
			if (prop("themeType"))
				found.push({
					at: `${file}:${src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1}`,
					themed: prop("theme")?.initializer.getText(src) === "DIFF_THEMES",
				});
		}
		ts.forEachChild(node, visit);
	};
	visit(src);
	return found;
}

// A viewer that sets its own theme type but not DIFF_THEMES draws the library's default colours,
// which fail AA on our surfaces (#1238): the gallery's WorktreeDiff did, after five views were moved.
describe("diff themes", () => {
	it("every @pierre/diffs viewer that picks a theme type takes DIFF_THEMES", () => {
		const viewers = files(SRC)
			.filter((f) => readFileSync(f, "utf8").includes("@pierre/diffs"))
			.flatMap(viewerOptions);
		expect(viewers.length).toBeGreaterThanOrEqual(6);
		expect(viewers.filter((v) => !v.themed).map((v) => v.at)).toEqual([]);
	}, 30_000);

	// The pool resolves its theme names on the main thread and posts the result to its workers,
	// so the palette resolved here is the one a pooled viewer draws with.
	it("the shared worker pool's configured themes resolve to the AA palette", async () => {
		vi.doMock("@pierre/diffs/worker/worker.js?worker", () => ({
			default: class {},
		}));
		const { POOL } = await import("@/components/run/EvidenceFileView");
		const pooled = POOL.highlighterOptions.theme;
		/** Each rule's foreground, keyed by the background it sets ("" for none). */
		const rules = async (name: string) =>
			(await resolveTheme(name)).settings.map(
				(r) =>
					`${r.settings?.background ?? ""}>${r.settings?.foreground ?? ""}`.toLowerCase(),
			);
		const light = await rules(pooled.light);
		const dark = await rules(pooled.dark);
		expect(light).toContain(">#4b535d");
		expect(light).not.toContain(">#66707b");
		expect(dark).toContain("#ff9492>#0a0c10");
		expect(dark).not.toContain("#ff9492>#ffffff");
	});
});
