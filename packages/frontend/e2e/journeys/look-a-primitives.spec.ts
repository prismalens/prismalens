// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import { hideQueryDevtools, setTheme } from "./live-stream-fixtures";

/**
 * Look pass PR A: the primitives behave as the look ruling §2 and §3 say, in
 * the real app. The package has no DOM renderer, so what a unit test cannot
 * reach is pinned here: Hint, Select, Tabs, Segmented, the breathing clock's
 * CSS, the dialog height lock.
 */
test.beforeEach(({ page }) => hideQueryDevtools(page));

test.describe("Hint: the only tooltip", () => {
	test("opens on hover, never catches the pointer, and the trigger has no native title", async ({
		page,
	}) => {
		await page.goto("/incidents");
		const create = page
			.getByTestId("page-header")
			.getByTestId("create-incident-button");
		await expect(create).toBeVisible();
		expect(await create.getAttribute("title")).toBeNull();
		await create.hover();
		const hint = page.getByTestId("hint");
		await expect(hint).toBeVisible();
		await expect(hint).toHaveCSS("pointer-events", "none");
		await expect(hint).toHaveAttribute("data-float", "tip");
	});

	test("the shell carries no DOM title attribute anywhere", async ({
		page,
	}) => {
		for (const path of ["/incidents", "/alerts", "/services", "/settings"]) {
			await page.goto(path);
			await expect(page.getByTestId("sidebar")).toBeVisible();
			const titled = await page
				.locator(
					"[data-testid=sidebar] [title], [data-testid=page-header] [title]",
				)
				.count();
			expect(titled, `${path}: elements with a title attribute`).toBe(0);
		}
	});

	test.describe("on a touch device", () => {
		test.use({ hasTouch: true, isMobile: true });

		test("does not open: tooltips render only where (hover: hover)", async ({
			page,
		}) => {
			await page.goto("/incidents");
			expect(
				await page.evaluate(() => matchMedia("(hover: hover)").matches),
			).toBe(false);
			const create = page.getByTestId("create-incident-button").first();
			await expect(create).toBeVisible();
			const hint = page.getByTestId("hint");
			// Radix opens it on keyboard focus; hover-less media keeps it unseen.
			// Hydration may land after the first focus, so focus again until it opens.
			await expect(async () => {
				await create.blur();
				await create.focus();
				await expect(hint).toBeAttached({ timeout: 1000 });
			}).toPass({ timeout: 10_000 });
			await expect(hint).toHaveCSS("display", "none");
		});
	});
});

test.describe("Select: keyboard", () => {
	// The Create-incident dialog's Severity: a Select on a screen that does not
	// redirect or re-render under the test.
	async function openDialog(page: import("@playwright/test").Page) {
		await page.goto("/incidents");
		await page
			.getByTestId("page-header")
			.getByTestId("create-incident-button")
			.click();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
		return page.locator("#incident-severity");
	}

	test("Enter opens, arrows move, Enter chooses, Esc closes without changing", async ({
		page,
	}) => {
		const trigger = await openDialog(page);
		await expect(trigger).toHaveAttribute("role", "combobox");
		const initial = (await trigger.innerText()).trim();

		await trigger.focus();
		await page.keyboard.press("Enter");
		const list = page.getByRole("listbox");
		await expect(list).toBeVisible();
		const options = list.getByRole("option");
		const names = (await options.allInnerTexts()).map((t) => t.trim());
		expect(names.length).toBeGreaterThan(2);
		const at = names.indexOf(initial);
		expect(at).toBeGreaterThanOrEqual(0);
		expect(at).toBeLessThan(names.length - 1);
		await expect(options.nth(at)).toBeFocused();

		await page.keyboard.press("ArrowDown");
		await expect(options.nth(at + 1)).toBeFocused();
		await page.keyboard.press("ArrowUp");
		await expect(options.nth(at)).toBeFocused();

		await page.keyboard.press("ArrowDown");
		await expect(options.nth(at + 1)).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(list).toBeHidden();
		await expect(trigger).toHaveText(names[at + 1] ?? "");
		await expect(trigger).toBeFocused();

		await page.keyboard.press("Enter");
		await expect(list).toBeVisible();
		await page.keyboard.press("ArrowDown");
		await expect(options.nth(at + 2)).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(list).toBeHidden();
		await expect(trigger).toHaveText(names[at + 1] ?? "");
		await expect(trigger).toBeFocused();
		await expect(page.getByTestId("create-incident-dialog")).toBeVisible();
	});

	test("typeahead jumps to the option that starts with the typed letters", async ({
		page,
	}) => {
		const trigger = await openDialog(page);
		await trigger.focus();
		await page.keyboard.press("Enter");
		const list = page.getByRole("listbox");
		await expect(list).toBeVisible();
		const names = (await list.getByRole("option").allInnerTexts()).map((t) =>
			t.trim(),
		);
		const target = names.find((n) => n !== (names[0] ?? "")) ?? "";
		await page.keyboard.type(target.slice(0, 2).toLowerCase());
		await expect(list.getByRole("option", { name: target })).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(trigger).toHaveText(target);
	});

	test("the trigger is a button with a combobox role, never a native select", async ({
		page,
	}) => {
		const trigger = await openDialog(page);
		await expect(trigger).toHaveJSProperty("tagName", "BUTTON");
		// Radix keeps an aria-hidden form twin; the dialog has no other native select.
		const native = page
			.getByTestId("create-incident-dialog")
			.locator("select:not([aria-hidden=true])");
		expect(await native.count()).toBe(0);
	});
});

test.describe("Tabs", () => {
	test("one tab stop, arrows move and select, the underline follows", async ({
		page,
	}) => {
		await page.goto("/alerts");
		const all = page.getByRole("tab", { name: "All alerts" });
		const unmapped = page.getByRole("tab", { name: "Unmapped" });
		await expect(all).toHaveAttribute("aria-selected", "true");
		await expect(unmapped).toHaveAttribute("aria-selected", "false");
		await expect(unmapped).toHaveAttribute("tabindex", "-1");

		const underline = page.getByTestId("tab-underline");
		const under = async () => (await underline.boundingBox())?.x ?? -1;
		const x0 = await under();
		expect(x0).toBeGreaterThan(0);

		await all.focus();
		await expect(all).toHaveAttribute("tabindex", "0");
		await expect(unmapped).toHaveAttribute("tabindex", "-1");
		await page.keyboard.press("ArrowRight");
		await expect(unmapped).toBeFocused();
		await expect(unmapped).toHaveAttribute("aria-selected", "true");
		await expect(all).toHaveAttribute("aria-selected", "false");
		await expect(unmapped).toHaveAttribute("tabindex", "0");
		await expect(all).toHaveAttribute("tabindex", "-1");
		await expect.poll(under).toBeGreaterThan(x0);
		expect(await underline.count()).toBe(1);

		await page.keyboard.press("ArrowLeft");
		await expect(all).toBeFocused();
		await expect(all).toHaveAttribute("aria-selected", "true");
		await expect.poll(under).toBeCloseTo(x0, 0);

		await page.keyboard.press("End");
		await expect(unmapped).toHaveAttribute("aria-selected", "true");
		await page.keyboard.press("Home");
		await expect(all).toHaveAttribute("aria-selected", "true");
	});
});

test.describe("Segmented", () => {
	test("a labelled group of two buttons, one pressed; a click moves the pressed state", async ({
		page,
	}) => {
		await page.goto("/incidents");
		const view = page.getByTestId("incidents-view");
		await expect(view).toBeVisible();
		await expect(view).toHaveAccessibleName("View");
		const board = page.getByTestId("incidents-view-board");
		const analytics = page.getByTestId("incidents-view-analytics");
		await expect(board).toHaveAttribute("aria-pressed", "true");
		await expect(analytics).toHaveAttribute("aria-pressed", "false");

		await analytics.click();
		await expect(analytics).toHaveAttribute("aria-pressed", "true");
		await expect(board).toHaveAttribute("aria-pressed", "false");

		await board.focus();
		await page.keyboard.press("Enter");
		await expect(board).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("Tab");
		await expect(analytics).toBeFocused();
	});
});

test.describe("the breathing clock", () => {
	const breathing = async (page: import("@playwright/test").Page) =>
		page.evaluate(() => {
			const el = document.createElement("span");
			el.className = "breathe";
			el.id = "probe-breathe";
			el.textContent = "x";
			document.body.append(el);
		});

	test("the shell sets one phase from performance.now() % 2400, and a breathing element uses it", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await expect(page.getByTestId("sidebar")).toBeVisible();
		const read = () =>
			page.evaluate(() =>
				document.documentElement.style.getPropertyValue("--breathe-phase"),
			);
		await expect.poll(read).not.toBe("");
		const phase = await read();
		const ms = Number.parseFloat(phase);
		expect(phase).toMatch(/^-[\d.]+ms$/);
		expect(ms).toBeGreaterThan(-2400);
		const now = await page.evaluate(() => performance.now());
		expect(-ms).toBeLessThanOrEqual(now);
		await breathing(page);
		const probe = page.locator("#probe-breathe");
		await expect(probe).toHaveCSS("animation-name", "pl-breathe");
		await expect(probe).toHaveCSS("animation-duration", "2.4s");
		const delayMs = await probe.evaluate(
			(el) => Number.parseFloat(getComputedStyle(el).animationDelay) * 1000,
		);
		expect(delayMs).toBeCloseTo(ms, 0);
	});

	test("every loop is paused while data-reconnecting is set", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await expect(page.getByTestId("sidebar")).toBeVisible();
		await breathing(page);
		const probe = page.locator("#probe-breathe");
		await expect(probe).toHaveCSS("animation-play-state", "running");
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-reconnecting", ""),
		);
		await expect(probe).toHaveCSS("animation-play-state", "paused");
		await page.evaluate(() =>
			document.documentElement.removeAttribute("data-reconnecting"),
		);
		await expect(probe).toHaveCSS("animation-play-state", "running");
	});

	test.describe("reduced motion", () => {
		test.use({ reducedMotion: "reduce" });

		test("breathing stops", async ({ page }) => {
			await page.goto("/incidents");
			await expect(page.getByTestId("sidebar")).toBeVisible();
			await breathing(page);
			await expect(page.locator("#probe-breathe")).toHaveCSS(
				"animation-name",
				"none",
			);
		});
	});
});

test.describe("dialog height lock", () => {
	test("a dialog grows with its content and never shrinks back while open", async ({
		page,
	}) => {
		await page.goto("/incidents");
		await page
			.getByTestId("page-header")
			.getByTestId("create-incident-button")
			.click();
		const dialog = page.getByTestId("create-incident-dialog");
		await expect(dialog).toBeVisible();
		const height = async () => (await dialog.boundingBox())?.height ?? 0;
		await expect.poll(height).toBeGreaterThan(100);
		const before = await height();

		await dialog.evaluate((el) => {
			const filler = document.createElement("div");
			filler.id = "probe-filler";
			filler.style.height = "90px";
			el.append(filler);
		});
		await expect.poll(height).toBeGreaterThan(before + 40);
		await page.waitForTimeout(300);
		const grown = await height();

		await dialog.evaluate(() =>
			document.getElementById("probe-filler")?.remove(),
		);
		await page.waitForTimeout(300);
		expect(await height()).toBeGreaterThanOrEqual(grown - 0.5);
	});
});

for (const theme of ["dark", "light"] as const) {
	test(`${theme}: keyboard focus draws one solid accent outline`, async ({
		page,
	}) => {
		await page.goto("/incidents");
		await setTheme(page, theme);
		const accent = await page.evaluate(() => {
			const probe = document.createElement("i");
			probe.style.color = "var(--accent)";
			document.body.append(probe);
			const c = getComputedStyle(probe).color;
			probe.remove();
			return c;
		});
		await page.getByTestId("incidents-view-board").focus();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		const board = page.getByTestId("incidents-view-board");
		await expect(board).toHaveCSS("outline-style", "solid");
		await expect(board).toHaveCSS("outline-width", "2px");
		// The colour eases in over a transition; wait for it.
		await expect(board).toHaveCSS("outline-color", accent);
	});
}
