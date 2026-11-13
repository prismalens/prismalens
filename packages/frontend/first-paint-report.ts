// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** The modules each page's first paint renders from: its layout, its route, and parts it opens at once. */
const PAGES: Record<string, readonly RegExp[]> = {
	home: [
		/[\\/]routes[\\/]_authenticated\.tsx\?tsr-split=component$/,
		/[\\/]_authenticated[\\/]index\.tsx\?tsr-split=component$/,
		/[\\/]_authenticated[\\/]new\.tsx\?tsr-split=component$/,
	],
	thread: [
		/[\\/]routes[\\/]_authenticated\.tsx\?tsr-split=component$/,
		/[\\/]threads[\\/]\$id\.tsx\?tsr-split=component$/,
	],
	diff: [
		/[\\/]routes[\\/]_authenticated\.tsx\?tsr-split=component$/,
		/[\\/]threads[\\/]\$id\.tsx\?tsr-split=component$/,
		/[\\/]thread[\\/]diff[\\/]DiffSurface\.tsx$/,
	],
};

/** The registry's own files: the collector, the kinds, and every collected declaration. */
const REGISTRY =
	/[\\/]src[\\/](?:registry[\\/]|.*\.(?:actions|blocks|conditions|lenses|settings|surface)\.ts$)/;

/**
 * Writes `dist/first-paint.json` from the client build's chunk graph: the gzip bytes each page
 * loads before its first content (entry, the page's chunks, their static imports and CSS), and
 * the registry's share of the shell. `scripts/entry-budget.mjs` holds both to budgets (#1101).
 */
export function firstPaintReport(outFile: string): Plugin {
	return {
		name: "prismalens:first-paint-report",
		apply: "build",
		applyToEnvironment: (env) => env.name === "client",
		generateBundle(_options, bundle) {
			const chunks = Object.values(bundle).filter((o) => o.type === "chunk");
			const byName = new Map(Object.values(bundle).map((o) => [o.fileName, o]));
			const gz = new Map<string, number>();
			const size = (fileName: string) => {
				let n = gz.get(fileName);
				if (n === undefined) {
					const o = byName.get(fileName);
					const body = !o ? "" : o.type === "chunk" ? o.code : o.source;
					n = gzipSync(body).length;
					gz.set(fileName, n);
				}
				return n;
			};
			const pages: Record<string, { bytes: number; files: number }> = {};
			for (const [page, roots] of Object.entries(PAGES)) {
				const files = new Set<string>();
				const queue = chunks
					.filter(
						(c) =>
							c.isEntry ||
							c.moduleIds.some((id) => roots.some((r) => r.test(id))),
					)
					.map((c) => c.fileName);
				for (let f = queue.pop(); f !== undefined; f = queue.pop()) {
					if (files.has(f)) continue;
					files.add(f);
					const c = byName.get(f);
					if (c?.type !== "chunk") continue;
					queue.push(...c.imports);
					c.viteMetadata?.importedCss.forEach((css) => {
						files.add(css);
					});
				}
				let bytes = 0;
				files.forEach((f) => {
					bytes += size(f);
				});
				pages[page] = { bytes, files: files.size };
			}
			const shell = chunks.find((c) => c.name === "shell");
			let all = 0;
			let registry = 0;
			for (const [id, m] of Object.entries(shell?.modules ?? {})) {
				all += m.renderedLength;
				if (REGISTRY.test(id)) registry += m.renderedLength;
			}
			mkdirSync(dirname(outFile), { recursive: true });
			writeFileSync(
				outFile,
				`${JSON.stringify(
					{
						pages,
						registryShareOfShell: all
							? Math.round((registry / all) * 1000) / 1000
							: 0,
						registryBytes: registry,
						shellBytes: all,
					},
					null,
					"\t",
				)}\n`,
			);
		},
	};
}

export const FIRST_PAINT_REPORT = join("dist", "first-paint.json");
