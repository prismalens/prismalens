// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { type SlowLinkHandle, slowLink } from "../journeys/slow-link";
import { firstPaint } from "../steps/product";

/**
 * The bar checks' kit (#1101 Scores, "Bar checks take the testing off the judges"): each
 * check proves one checked bar item on a running `pnpm sim up --profile all` and returns
 * pass or fail with the value it measured. checks/cat-NN.ts files hold them.
 */

export interface SimRow {
	id: string;
	ok: boolean;
	links: string[];
	live: string;
}

export interface Sim {
	/** The app, direct; the slow link is added per page by CDP. */
	url: string;
	rows: SimRow[];
	/** The path of a condition's (or `seed: <id>`'s) n-th thread link, e.g. `/threads/<id>`. */
	thread(condition: string, n?: number): string;
	/** What the sheet says is live for a condition. */
	live(condition: string): string;
}

export interface Result {
	pass: boolean;
	/** What was measured, in a few words: "3 of 40 rows lack a status word: …". */
	value: string;
}

export interface Ctx {
	page: Page;
	context: BrowserContext;
	browser: Browser;
	sim: Sim;
	/** The slow link on `page`, or null under BAR_FAST=1. */
	slow: SlowLinkHandle | null;
	/** Navigates and waits for the page's first-paint frame (`home`, `thread-page`, …). */
	open(path: string, frame?: string): Promise<void>;
	/** A second paired device (own context), e.g. a 390 px phone, on the slow link too. */
	device(opts?: { width?: number; height?: number }): Promise<Page>;
	/** Saves a screenshot of `page` under the failure folder; returns its path. */
	shot(name?: string): Promise<string>;
}

export interface BarCheck {
	/** The bar item id from registry/closed/bar-item.ts, e.g. "7.k1". */
	item: string;
	run(ctx: Ctx): Promise<Result>;
}

/** Every check of a category file; the spec collects the files by name. */
export const defineChecks = (checks: BarCheck[]): BarCheck[] => checks;

/** Pass when `fails` is empty; the value names what was measured either way. */
export const verdict = (fails: string[], okValue: string): Result =>
	fails.length
		? { pass: false, value: fails.join("; ").slice(0, 400) }
		: { pass: true, value: okValue };

export function readSim(dir: string): Sim {
	const f = join(dir, "sheet.json");
	if (!existsSync(f))
		throw new Error(
			`no sim sheet at ${f}: run \`PRISMALENS_SIM_DIR=${dir} pnpm sim up --profile all --mode built\``,
		);
	const sheet = JSON.parse(readFileSync(f, "utf8")) as {
		url: string;
		rows: SimRow[];
	};
	const row = (id: string) => {
		const r = sheet.rows.find((x) => x.id === id);
		if (!r) throw new Error(`the sim sheet has no row ${id}`);
		if (!r.ok) throw new Error(`the sim did not stage ${id}`);
		return r;
	};
	return {
		url: sheet.url,
		rows: sheet.rows,
		thread(id, n = 0) {
			const link = row(id).links[n];
			if (!link) throw new Error(`the sim sheet's ${id} row has no link ${n}`);
			return new URL(link).pathname;
		},
		live: (id) => row(id).live,
	};
}

export async function makeCtx(
	page: Page,
	browser: Browser,
	sim: Sim,
	opts: { fast: boolean; storageState: string; shots: string; item: string },
): Promise<Ctx> {
	const slow = opts.fast ? null : await slowLink(page);
	let n = 0;
	return {
		page,
		context: page.context(),
		browser,
		sim,
		slow,
		async open(path, frame) {
			await page.goto(path);
			await firstPaint(page, frame);
		},
		async device(d = {}) {
			const ctx = await browser.newContext({
				baseURL: sim.url,
				storageState: opts.storageState,
				viewport: { width: d.width ?? 390, height: d.height ?? 844 },
			});
			const p = await ctx.newPage();
			if (!opts.fast) await slowLink(p);
			return p;
		},
		async shot(name) {
			const file = join(
				opts.shots,
				`${opts.item.replace(/\./g, "-")}${name ? `-${name}` : ""}-${n++}.png`,
			);
			await page.screenshot({ path: file });
			return file;
		},
	};
}
