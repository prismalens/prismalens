// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The first-paint budget (#1125, #1101 category 12), against entry-budget.json after `vite build`:
// - `initial`: every chunk index.html preloads, gzipped;
// - `home`, `thread`, `diff`: what each page loads before its first content, from the build's
//   chunk graph (`first-paint-report.ts` writes dist/first-paint.json);
// - `registryShare`: the registry's own modules as a share of the shell chunk they load in.
// Each budget ratchets: `--write` lowers it to 2% over a lower measure and never raises it;
// a raise is the operator's call (the registry label check reads this file as a budget).
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dir = new URL("../dist/client/", import.meta.url);
const budgetFile = new URL("../entry-budget.json", import.meta.url);
const budget = JSON.parse(readFileSync(budgetFile, "utf8"));
const HEADROOM = 1.02;
/** The budget a measure earns: 2% over it, bytes whole and the share to three places. */
const earned = (k, n) =>
	k === "registryShare"
		? Math.ceil(n * HEADROOM * 1000) / 1000
		: Math.ceil(n * HEADROOM);
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
const report = JSON.parse(
	readFileSync(new URL("../dist/first-paint.json", import.meta.url), "utf8"),
);
const measured = {
	initial: [...new Set([entry, ...preloads])].reduce((n, f) => n + gz(f), 0),
	home: report.pages.home.bytes,
	thread: report.pages.thread.bytes,
	diff: report.pages.diff.bytes,
	registryShare: report.registryShareOfShell,
};
const PAGE_FIX =
	"move what the page does not show at first paint behind a lazy part (lib/lazy.tsx) or a dynamic import";
const FIX = {
	initial:
		"move a preloaded chunk's code behind a lazy route or a dynamic import",
	home: PAGE_FIX,
	thread: PAGE_FIX,
	diff: PAGE_FIX,
	registryShare:
		"switch heavy `run` handlers to a lazy loader (`run: (c) => import(...).then(...)`); L8 keeps feature code out",
};
const unit = (k) => (k === "registryShare" ? "of the shell" : "B gzip");
let over = 0;
for (const [k, n] of Object.entries(measured)) {
	const ok = n <= budget[k];
	if (!ok) over++;
	console.log(
		`${ok ? "ok  " : "OVER"} ${k}: ${n} ${unit(k)}, budget ${budget[k]}${ok ? "" : `. Fix: ${FIX[k]}.`}`,
	);
}
if (process.argv.includes("--write")) {
	let lowered = 0;
	for (const [k, n] of Object.entries(measured)) {
		const next = earned(k, n);
		if (next < budget[k]) {
			console.log(`lowered ${k}: ${budget[k]} -> ${next}`);
			budget[k] = next;
			lowered++;
		}
	}
	if (lowered)
		writeFileSync(budgetFile, `${JSON.stringify(budget, null, "\t")}\n`);
}
process.exitCode = over ? 1 : 0;
