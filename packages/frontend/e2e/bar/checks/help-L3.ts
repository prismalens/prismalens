// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";

export interface EditorState {
	type: string;
	from: number;
	to: number;
	text: string;
}

export async function getEditorState(page: Page): Promise<EditorState | null> {
	return page.evaluate(() => {
		const el = document.querySelector('[data-testid="composer-input"]') as
			| (HTMLElement & {
					editor?: {
						view: {
							state: {
								selection: {
									from: number;
									to: number;
									toJSON: () => { type: string };
								};
								doc: {
									textContent: string;
								};
							};
						};
					};
			  })
			| null;
		const v = el?.editor?.view;
		if (!v) return null;
		const s = v.state.selection;
		return {
			type: s.toJSON().type,
			from: s.from,
			to: s.to,
			text: v.state.doc.textContent,
		};
	});
}

export async function clearComposer(page: Page): Promise<void> {
	await page.request.delete("/api/drafts/new%3Ahome").catch(() => undefined);
	await page.evaluate(() => {
		for (let i = window.localStorage.length - 1; i >= 0; i--) {
			const k = window.localStorage.key(i);
			if (k?.startsWith("pl.draft.")) window.localStorage.removeItem(k);
		}
		const el = document.querySelector('[data-testid="composer-input"]') as
			| (HTMLElement & {
					editor?: {
						commands: { clearContent: () => void; focus: () => void };
					};
			  })
			| null;
		el?.editor?.commands.clearContent();
		el?.editor?.commands.focus();
	});
	const input = page.getByTestId("composer-input");
	await input.focus();
}

export async function visitComposer(
	page: Page,
	open: (p: string) => Promise<void>,
): Promise<Locator> {
	await page.request.delete("/api/drafts/new%3Ahome").catch(() => undefined);
	await open("/new");
	await page.evaluate(() => {
		for (let i = window.localStorage.length - 1; i >= 0; i--) {
			const k = window.localStorage.key(i);
			if (k?.startsWith("pl.draft.")) window.localStorage.removeItem(k);
		}
		const el = document.querySelector('[data-testid="composer-input"]') as
			| (HTMLElement & {
					editor?: {
						commands: { clearContent: () => void };
					};
			  })
			| null;
		el?.editor?.commands.clearContent();
	});
	const input = page.getByTestId("composer-input");
	await expect(input).toBeVisible();
	await input.focus();
	return input;
}

export async function pickFirstHit(
	page: Page,
	trigger = "@",
): Promise<Locator> {
	const input = page.getByTestId("composer-input");
	await input.focus();
	await input.pressSequentially(trigger);
	const menu = page.getByTestId("composer-menu");
	await expect(menu).toBeVisible();
	const firstRow = menu.getByTestId("composer-menu-row").first();
	await expect(firstRow).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(menu).toHaveCount(0);
	const chip = page.locator(".composer-chip").first();
	await expect(chip).toBeVisible();
	return chip;
}

export async function pasteText(page: Page, text: string): Promise<void> {
	await page.getByTestId("composer-input").evaluate((el, t) => {
		const dt = new DataTransfer();
		dt.setData("text/plain", t);
		el.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: dt,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, text);
}

export async function pasteImage(
	page: Page,
	fileName = "screenshot.png",
): Promise<void> {
	await page.getByTestId("composer-input").evaluate((el, name) => {
		const pngBytes = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
			0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
			0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
			0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
			0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
			0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
		]);
		const file = new File([pngBytes], name, { type: "image/png" });
		const dt = new DataTransfer();
		dt.items.add(file);
		el.dispatchEvent(
			new ClipboardEvent("paste", {
				clipboardData: dt,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, fileName);
}

export async function dropFile(
	page: Page,
	fileName = "test-doc.txt",
	fileType = "text/plain",
	content = "test file content",
): Promise<void> {
	const box = await page.getByTestId("composer-input").boundingBox();
	if (!box) throw new Error("composer-input bounding box not found");
	await page.getByTestId("composer-input").evaluate(
		(el, { name, type, body, x, y }) => {
			const dt = new DataTransfer();
			const file = new File([body], name, { type });
			dt.items.add(file);
			const dropEvent = new DragEvent("drop", {
				bubbles: true,
				cancelable: true,
				clientX: x + 10,
				clientY: y + 10,
				dataTransfer: dt,
			});
			el.dispatchEvent(dropEvent);
		},
		{ name: fileName, type: fileType, body: content, x: box.x, y: box.y },
	);
}

/** The menu once its rows stop changing: the search answered and its list has settled (a first answer can be partial). */
export async function settledRows(page: Page): Promise<Locator> {
	const menu = page.getByTestId("composer-menu");
	await expect(menu).toBeVisible();
	await expect(menu.getByTestId("composer-menu-loading")).toHaveCount(0);
	const rows = menu.getByTestId("composer-menu-row");
	let last = -1;
	for (let i = 0; i < 20; i++) {
		const n = await rows.count();
		if (n === last) break;
		last = n;
		await page.waitForTimeout(400);
	}
	return rows;
}
