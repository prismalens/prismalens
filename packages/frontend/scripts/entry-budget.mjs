// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The first-paint budget (#1125): the entry chunk, every chunk index.html preloads, and the
// registry chunk the collector loads eagerly, gzipped, against entry-budget.json.
import { readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dir = new URL("../dist/client/", import.meta.url);
const budget = JSON.parse(
	readFileSync(new URL("../entry-budget.json", import.meta.url), "utf8"),
);
const html = readFileSync(new URL("index.html", dir), "utf8");
const entry = html.match(/<script[^>]*src="\/(assets\/[^"]+\.js)"/)?.[1];
if (!entry)
	throw new Error(
		"dist/client/index.html has no entry script; run `pnpm build` first.",
	);
const preloads = [
	...html.matchAll(/modulepreload" href="\/(assets\/[^"]+\.js)"/g),
].map((m) => m[1]);
const gz = (f) => gzipSync(readFileSync(new URL(f, dir))).length;
const registry = readdirSync(new URL("assets/", dir)).filter((f) =>
	/^registry-.*\.js$/.test(f),
);
const measured = {
	entry: gz(entry),
	initial: [...new Set([entry, ...preloads])].reduce((n, f) => n + gz(f), 0),
	registry: registry.reduce((n, f) => n + gz(`assets/${f}`), 0),
};
const FIX = {
	entry: "move what the entry imports behind a lazy route or a dynamic import",
	initial:
		"move a preloaded chunk's code behind a lazy route or a dynamic import",
	registry:
		"switch heavy `run` handlers to a lazy loader (`run: (c) => import(...).then(...)`); L8 keeps feature code out",
};
let over = 0;
for (const [k, n] of Object.entries(measured)) {
	const ok = n <= budget[k];
	if (!ok) over++;
	console.log(
		`${ok ? "ok  " : "OVER"} ${k}: ${n} B gzip of ${budget[k]}${ok ? "" : `. Fix: ${FIX[k]}.`}`,
	);
}
process.exitCode = over ? 1 : 0;
