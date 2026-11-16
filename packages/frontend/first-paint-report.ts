// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";
import { FIRST_PAINT } from "./src/lib/first-paint.ts";

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

/** zod itself, which any runtime schema from `@prismalens/contracts` brings along. */
const ZOD =
	/node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?zod[\\/]/;

/** The registry's own files: the collector, the kinds, and every collected declaration. */
const REGISTRY =
	/[\\/]src[\\/](?:registry[\\/]|.*\.(?:actions|blocks|conditions|lenses|settings|surface)\.ts$)/;

/**
 * Writes `<dist>/first-paint.json` from the client build's chunk graph: the gzip bytes each page
 * loads before its first content (entry, the page's chunks, their static imports and CSS), and
 * the registry's share of the shell. `scripts/entry-budget.mjs` holds both to budgets (#1101).
 * Then, after the prerender, gives the served HTML's preloads (`preloadHints`).
 */
export function firstPaintReport(dist: string): Plugin[] {
	const scripts: Record<string, string[]> = {};
	const report: Plugin = {
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
			const pages: Record<
				string,
				{ bytes: number; files: number; zod: number }
			> = {};
			const modules: Record<
				string,
				{ id: string; gzip: number; by: string[]; kept: string[] }[]
			> = {};
			const short = (id: string) =>
				id.replace(/^.*?[\\/](node_modules[\\/]|src[\\/])/, "$1");
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
				scripts[page] = Array.from(files).filter((f) => f.endsWith(".js"));
				// What each module adds, gzipped alone: a ranking, not a sum of the page's bytes.
				modules[page] = Array.from(files)
					.flatMap((f) => {
						const c = byName.get(f);
						return c?.type === "chunk" ? Object.entries(c.modules) : [];
					})
					.map(([id, m]) => ({
						id: short(id),
						gzip: m.code ? gzipSync(m.code).length : 0,
						// Its static importers, to walk back to why a module is on the first paint.
						by: (this.getModuleInfo(id)?.importers ?? []).map(short),
						kept: m.renderedExports,
					}))
					.sort((a, b) => b.gzip - a.gzip);
				// A schema loads with the route that validates with it; the shell holds none (#1130).
				const zod = modules[page]
					.filter((m) => ZOD.test(m.id))
					.reduce((n, m) => n + m.gzip, 0);
				pages[page] = { bytes, files: files.size, zod };
			}
			const shell = chunks.find((c) => c.name === "shell");
			let all = 0;
			let registry = 0;
			for (const [id, m] of Object.entries(shell?.modules ?? {})) {
				all += m.renderedLength;
				if (REGISTRY.test(id)) registry += m.renderedLength;
			}
			mkdirSync(dist, { recursive: true });
			writeFileSync(
				join(dist, "first-paint.json"),
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
			writeFileSync(
				join(dist, "first-paint-modules.json"),
				`${JSON.stringify(modules, null, "\t")}\n`,
			);
			// Every module's static importers, re-exporting barrels included, for tracing a module
			// back to the route that pulls it onto a first paint.
			const graph: Record<string, string[]> = {};
			Array.from(this.getModuleIds()).forEach((id) => {
				graph[short(id)] = (this.getModuleInfo(id)?.importers ?? []).map(short);
			});
			writeFileSync(
				join(dist, "first-paint-graph.json"),
				JSON.stringify(graph),
			);
		},
	};
	// The prerender writes index.html in its own post buildApp hook; this one runs after it.
	const html: Plugin = {
		name: "prismalens:first-paint-preloads",
		apply: "build",
		enforce: "post",
		buildApp: {
			order: "post",
			async handler() {
				const file = join(dist, "client", "index.html");
				if (existsSync(file))
					writeFileSync(
						file,
						preloadHints(readFileSync(file, "utf8"), scripts),
					);
			},
		},
	};
	return [report, html];
}

/**
 * The framework preloads the entry, React and the shell at low priority; on a slow link they are
 * the first paint, so they load at the default. The landing page's own chunks are added by path
 * (`FIRST_PAINT`), so the route's code downloads while the shell evaluates (#1101 category 12).
 */
export function preloadHints(
	html: string,
	scripts: Record<string, readonly string[]>,
): string {
	const head = new Set(
		Array.from(html.matchAll(/rel="modulepreload" href="\/([^"]+)"/g)).map(
			(m) => m[1],
		),
	);
	const byPath = FIRST_PAINT.map((p) => [
		p.path.source,
		(scripts[p.name] ?? []).filter((f) => !head.has(f)).map((f) => `/${f}`),
	]);
	const add = `<script>(function(){var P=${JSON.stringify(byPath)},p=location.pathname+location.search;for(var i=0;i<P.length;i++)if(new RegExp(P[i][0]).test(p)){P[i][1].forEach(function(h){var l=document.createElement('link');l.rel='modulepreload';l.href=h;document.head.appendChild(l);});return;}})();</script>`;
	let out = html.replace(
		/(<link rel="modulepreload" href="[^"]+") fetchPriority="low"\/>/g,
		"$1/>",
	);
	// The landing page's API calls go first: over HTTP/1.1's six connections they otherwise
	// queue behind every script the head asks for (#1101 category 12).
	const early = out.indexOf("window.__plEarly={");
	if (early >= 0) {
		const a = out.lastIndexOf("<script>", early);
		const b = out.indexOf("</script>", early) + "</script>".length;
		const tag = out.slice(a, b);
		const charset = out.indexOf('<meta charSet="utf-8"/>');
		if (a >= 0 && charset >= 0 && charset < a) {
			const at = charset + '<meta charSet="utf-8"/>'.length;
			out = out.slice(0, at) + tag + out.slice(at, a) + out.slice(b);
		}
	}
	const last = out.lastIndexOf('<link rel="modulepreload"');
	const at = last < 0 ? -1 : out.indexOf("/>", last) + 2;
	if (at < 2)
		throw new Error("index.html has no modulepreload links to follow");
	return out.slice(0, at) + add + out.slice(at);
}
