// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { test } from "../steps/fixtures";
import { visit } from "../steps/product";
import { liveStreamOnce, seedLongThread } from "./long-thread-fixtures";

/**
 * A 5,000-item thread over Slow 3G with one drop (#1101 categories 12-14): it opens
 * in one round trip with a bounded DOM, pages in as the reader scrolls without
 * moving them, a failed page retries in place, the rail jumps into an unloaded
 * region, find counts the whole thread, and a dropped stream reconnects in place.
 */

/** DevTools' Slow 3G: 400 ms RTT times its 5x factor, 500 kbit/s times 0.8. */
const SLOW_3G = {
	offline: false,
	latency: 2000,
	downloadThroughput: 50_000,
	uploadThroughput: 50_000,
};

/** Slow 3G on this page; the returned switch drops and restores it, as one CDP session must. */
async function throttle(page: Page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.emulateNetworkConditions", SLOW_3G);
	return (offline: boolean) =>
		cdp.send("Network.emulateNetworkConditions", { ...SLOW_3G, offline });
}

/** The row under the viewport's top edge, by its text and top: a prepend must leave it put. */
const firstVisibleRow = (page: Page) =>
	page.evaluate(() => {
		const box = document
			.querySelector("[data-testid=transcript-scroller]")
			?.getBoundingClientRect();
		// Below the rows' top padding, so the point is inside a row.
		const y = (box?.top ?? 0) + 30;
		const row = Array.from(
			document.querySelectorAll<HTMLElement>(
				"[data-testid=transcript] [data-at]",
			),
		).find((r) => {
			const b = r.getBoundingClientRect();
			return b.top <= y && b.bottom > y;
		});
		return {
			text: (row?.textContent ?? "").trim().slice(0, 200),
			top: row?.getBoundingClientRect().top ?? -1,
		};
	});

const topOfText = (page: Page, text: string) =>
	page.evaluate(
		(t) =>
			Array.from(
				document.querySelectorAll<HTMLElement>(
					"[data-testid=transcript] [data-at]",
				),
			)
				.find((r) => (r.textContent ?? "").trim().startsWith(t))
				?.getBoundingClientRect().top ?? -999,
		text,
	);

const rowsInDom = (page: Page) =>
	page.locator("[data-testid=transcript] [data-at]").count();

test("A 5,000-item thread over Slow 3G with one drop: windowed, paged, jumpable, findable", async ({
	page,
}) => {
	test.setTimeout(300_000);
	const { id, root } = seedLongThread();
	const opens: string[] = [];
	const wholeHistory: string[] = [];
	page.on("request", (r) => {
		const url = new URL(r.url());
		if (url.pathname === `/api/investigations/${id}/window`)
			opens.push(url.search);
		if (url.pathname === `/api/investigations/${id}/events`)
			wholeHistory.push(url.search);
	});
	// The dev server's modules load unthrottled on another thread; only this thread's data rides Slow 3G.
	await visit(page, `/threads/${root}`, "thread-page");
	const network = await throttle(page);

	// 12.1: one round trip at the tail; 12.2: the DOM stays bounded.
	await page.getByTestId("nav-search").click();
	await page.getByTestId("thread-search-input").fill("Long thread (5,000");
	await page.getByTestId("thread-search-result").first().click();
	await expect(page.getByText("Turn 242:").first()).toBeVisible({
		timeout: 60_000,
	});
	expect(opens).toHaveLength(1);
	expect(wholeHistory).toEqual([]);
	expect(await rowsInDom(page)).toBeLessThan(120);

	// 14.1/14.2: the rail covers the whole thread from its index, marks included.
	await expect(
		page.getByTestId("rail-mark-usage_limit").first(),
	).toBeAttached();
	await expect(page.getByTestId("rail-mark-compaction").first()).toBeAttached();
	await expect(page.getByTestId("rail-mark-auth").first()).toBeAttached();
	await expect(page.getByTestId("rail-mark-restart").first()).toBeAttached();

	// 12.2: an older page prepends while the row the reader looks at stays put.
	const scroller = page.getByTestId("transcript-scroller");
	const prepended = page.waitForResponse(
		(r) =>
			r.url().includes(`/api/investigations/${id}/window/page`) &&
			r.url().includes("before="),
		{ timeout: 60_000 },
	);
	await scroller.evaluate((el) => {
		el.scrollTop = 200;
	});
	// The rows at the new offset render on the next frames; the page is 2 s away on Slow 3G.
	await page.waitForTimeout(300);
	const seen = await firstVisibleRow(page);
	expect(seen.text).not.toBe("");
	await prepended;
	await page.waitForTimeout(800);
	expect(Math.abs((await topOfText(page, seen.text)) - seen.top)).toBeLessThan(
		40,
	);
	expect(await rowsInDom(page)).toBeLessThan(120);

	// The one drop: a page asked for offline fails in place and Retry loads it.
	await network(true);
	for (let i = 0; i < 60; i++) {
		await scroller.evaluate((el) => {
			el.scrollTop = 0;
		});
		if (
			(await page
				.getByTestId("transcript-edge-before")
				.getAttribute("data-state")) === "error"
		)
			break;
		await page.waitForTimeout(500);
	}
	const edge = page.getByTestId("transcript-edge-before");
	await expect(edge).toHaveAttribute("data-state", "error");
	await expect(edge.getByText("Couldn't load earlier messages.")).toBeVisible();
	await network(false);
	await edge.getByRole("button", { name: "Retry" }).click();
	await expect(edge).not.toHaveAttribute("data-state", "error", {
		timeout: 30_000,
	});

	// 14.2: a jump into an unloaded region loads the page around it and lands there.
	const around = page.waitForRequest(
		(r) =>
			r.url().includes(`/api/investigations/${id}/window/page`) &&
			r.url().includes("around="),
	);
	await page.getByTestId("rail-mark-usage_limit").first().click();
	await around;
	await expect(page.getByText("Turn 70:").first()).toBeInViewport({
		timeout: 30_000,
	});

	// 13.1-13.4: find counts the whole thread on the server and moves to a hit.
	await page.keyboard.press("Control+f");
	await page.getByTestId("find-input").fill("Turn 5:");
	await expect(page.getByTestId("find-count")).toHaveText("1/1", {
		timeout: 30_000,
	});
	await expect(page.getByText("Turn 5:").first()).toBeInViewport({
		timeout: 30_000,
	});
	await page.getByTestId("find-input").fill("zzz-no-such-text");
	await expect(page.getByTestId("find-count")).toHaveText("0/0", {
		timeout: 30_000,
	});
	await page.keyboard.press("Escape");
	await expect(page.getByTestId("find-bar")).toHaveCount(0);
	// The seeded thread kept no workspace, so its box is disabled and cannot take focus.
	await expect(page.getByTestId("composer-input")).toBeDisabled();
	expect(
		await page.evaluate(() =>
			document.activeElement?.getAttribute("data-testid"),
		),
	).not.toBe("find-input");
});

test("A live thread's dropped stream shows a reconnect line, and new messages below the reader show as N new", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const { id } = seedLongThread();
	// The seed's thread is finished; read it as live so the page holds a stream.
	const live = await liveStreamOnce(
		page,
		id,
		"A new answer arrived while you read.",
	);
	await visit(page, `/threads/${id}`, "thread-page");
	await expect(page.getByText("Turn 242:").first()).toBeVisible({
		timeout: 60_000,
	});
	await page
		.getByTestId("transcript-scroller")
		.evaluate((el) => el.scrollBy(0, -1500));
	await expect(page.getByTestId("transcript-to-end")).toBeVisible();
	live.release();
	await expect(page.getByTestId("transcript-new")).toHaveText("1 new", {
		timeout: 30_000,
	});
	await expect(page.getByTestId("transcript-reconnecting")).toBeVisible({
		timeout: 30_000,
	});
	await page.getByTestId("transcript-new").click();
	await expect(
		page.getByText("A new answer arrived while you read."),
	).toBeInViewport({ timeout: 30_000 });
});
