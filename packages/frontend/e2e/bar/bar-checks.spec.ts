// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "@playwright/test";
import { type BarCheck, makeCtx, readSim } from "./bar";
import { ALL } from "./checks";

/**
 * One test per checked bar item (#1101 Scores), against the sim in BAR_SIM_DIR. Each
 * writes BAR_OUT/results/<item>.json, so a run cut off by its hard timeout keeps what it
 * reached; `pnpm sim judge-evidence` turns them into checks.md. BAR_ONLY=1,7 picks categories.
 * Cases: @cond:host.rewind-interrupted (bar 16.12 restores its cut-off rewind, #1193).
 */
const SIM_DIR = resolve(process.env.BAR_SIM_DIR ?? "../../.sim-checks");
const OUT = resolve(process.env.BAR_OUT ?? "test-results/bar");
const FAST = process.env.BAR_FAST === "1";
const ONLY = process.env.BAR_ONLY?.split(",").filter(Boolean) ?? [];
const STATE = join(OUT, "paired-state.json");
const RESULTS = join(OUT, "results");
const SHOTS = join(OUT, "shots");

const manifest = JSON.parse(
	readFileSync(
		resolve(import.meta.dirname, "../../src/registry/registry.manifest.json"),
		"utf8",
	),
) as {
	closed: {
		barItem: {
			members: Record<string, { category: string; mark: string }>;
		};
	};
};
const items = Object.entries(manifest.closed.barItem.members).filter(
	([, v]) =>
		v.mark === "checked" && (!ONLY.length || ONLY.includes(v.category)),
);

const checks = new Map<string, BarCheck>();
for (const c of ALL) {
	if (checks.has(c.item)) throw new Error(`two checks for bar item ${c.item}`);
	if (manifest.closed.barItem.members[c.item]?.mark !== "checked")
		throw new Error(`a check names ${c.item}, which is no checked bar item`);
	checks.set(c.item, c);
}

const sim = readSim(SIM_DIR);
mkdirSync(RESULTS, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const save = (item: string, r: object) =>
	writeFileSync(
		join(RESULTS, `${item}.json`),
		`${JSON.stringify({ item, ...r }, null, 2)}\n`,
	);

test.use({
	baseURL: sim.url,
	storageState: STATE,
	viewport: { width: 1440, height: 900 },
});
test.describe.configure({ mode: "default" });

// A check cut off by the test timeout still leaves its row, with the page it stopped on.
test.afterEach(async ({ page }, info) => {
	const item = info.title.replace(/^bar /, "");
	if (
		info.status === "timedOut" &&
		!existsSync(join(RESULTS, `${item}.json`))
	) {
		const shot = join(SHOTS, `${item.replace(/\./g, "-")}-timeout.png`);
		await page.screenshot({ path: shot }).catch(() => undefined);
		save(item, {
			status: "fail",
			value: `check timed out after ${info.timeout / 1000} s`,
			shot,
		});
	}
});

for (const [item] of items) {
	const check = checks.get(item);
	test(`bar ${item}`, async ({ page, browser }) => {
		if (!check) save(item, { status: "no check" });
		test.skip(!check, `bar item ${item} has no check yet`);
		const ctx = await makeCtx(page, browser, sim, {
			fast: FAST,
			storageState: STATE,
			shots: SHOTS,
			item,
		});
		let r: { pass: boolean | null; value: string };
		try {
			r = await (check as BarCheck).run(ctx);
		} catch (e) {
			const msg = (e instanceof Error ? e.message : String(e))
				.split("\n")[0]
				?.slice(0, 300);
			const shot = await ctx.shot("error").catch(() => undefined);
			save(item, { status: "fail", value: `check threw: ${msg}`, shot });
			await ctx.dispose();
			throw e;
		}
		const status = r.pass === null ? "not set up" : r.pass ? "pass" : "fail";
		const shot = r.pass === false ? await ctx.shot("fail") : undefined;
		await ctx.dispose();
		save(item, { status, value: r.value, shot });
		test.skip(r.pass === null, `bar ${item} could not set up: ${r.value}`);
		if (r.pass === false) throw new Error(`bar ${item} failed: ${r.value}`);
	});
}
