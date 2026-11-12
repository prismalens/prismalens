// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { test } from "../steps/fixtures";
import { visit } from "../steps/product";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const SAM_THREAD_HIT = {
	hits: [
		{
			ref: {
				kind: "thread",
				id: "00000000-0000-4000-8000-000000000001",
				label: "Sam's thread",
			},
			why: "used",
			score: 1,
			group: "Threads",
		},
	],
	truncated: false,
	unavailable: [],
};

/** TipTap puts its editor on the contenteditable it renders. */
type WithEditor = HTMLElement & { editor?: Editor };

async function getEditorState(page: Page) {
	return page.evaluate(() => {
		const v = (
			document.querySelector(
				'[data-testid="composer-input"]',
			) as WithEditor | null
		)?.editor?.view;
		if (!v) return null;
		const s = v.state.selection;
		return {
			type: s.toJSON().type as string,
			from: s.from as number,
			to: s.to as number,
			text: v.state.doc.textContent as string,
		};
	});
}

async function pasteText(page: Page, text: string) {
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

async function pasteImage(page: Page, fileName = "screenshot.png") {
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

async function dropFile(
	page: Page,
	fileName = "test-doc.txt",
	fileType = "text/plain",
) {
	const box = await page.getByTestId("composer-input").boundingBox();
	if (!box) throw new Error("composer-input bounding box not found");
	await page.getByTestId("composer-input").evaluate(
		(el, { name, type, x, y }) => {
			const dt = new DataTransfer();
			const file = new File(["test file content"], name, { type });
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
		{ name: fileName, type: fileType, x: box.x, y: box.y },
	);
}

async function visitComposer(page: Page) {
	await visit(page, "/new");
	await page.evaluate(() => {
		for (let i = window.localStorage.length - 1; i >= 0; i--) {
			const key = window.localStorage.key(i);
			if (key?.startsWith("pl.draft.")) {
				window.localStorage.removeItem(key);
			}
		}
		const ed = (
			document.querySelector('[data-testid="composer-input"]') as
				| (HTMLElement & {
						editor?: {
							isEmpty: boolean;
							commands: { clearContent: () => void };
						};
				  })
				| null
		)?.editor;
		if (ed && !ed.isEmpty) {
			ed.commands.clearContent();
		}
	});
	const input = page.getByTestId("composer-input");
	await expect(input).toBeVisible();
	return input;
}

async function pickSam(page: Page) {
	const input = page.getByTestId("composer-input");
	await input.focus();
	await input.pressSequentially("@sam");
	const menu = page.getByTestId("composer-menu");
	await expect(menu).toBeVisible();
	const row = page
		.getByTestId("composer-menu-row")
		.filter({ hasText: "Sam's thread" });
	await expect(row).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(menu).toHaveCount(0);
	const chip = page.getByTestId("composer-ref");
	await expect(chip).toBeVisible();
	return chip;
}

test.describe("Composer key list (#1101 category 7)", () => {
	// The stack is shared with the design matrix: drop every draft a case left behind.
	test.afterEach(async ({ page }) => {
		const scopes = await page.evaluate(() =>
			Object.keys(window.localStorage)
				.filter((k) => k.startsWith("pl.draft."))
				.map((k) => k.slice("pl.draft.".length)),
		);
		for (const scope of Array.from(new Set([...scopes, "new:home"])))
			await page.request.delete(`/api/drafts/${encodeURIComponent(scope)}`);
	});
	test.beforeEach(async ({ page }) => {
		await page.route("**/api/references/search*", async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: SAM_THREAD_HIT,
			});
		});
		await page.route("**/api/drafts/*", async (route) => {
			if (route.request().method() === "GET") {
				await route.fulfill({
					contentType: "application/json",
					json: null,
				});
			} else {
				await route.fulfill({
					contentType: "application/json",
					json: { ok: true },
				});
			}
		});
		await page.route("**/api/threads*", async (route) => {
			if (route.request().method() === "POST") {
				await route.fulfill({
					contentType: "application/json",
					json: {
						investigationId: "00000000-0000-4000-8000-000000000001",
						jobId: null,
						queued: false,
					},
				});
			} else {
				await route.continue();
			}
		});
	});

	test("Backspace after a chip selects it, a second press deletes it, and a pasted link's chip reverts to its URL", async ({
		page,
	}) => {
		await page.route("**/api/references/resolve*", async (route) => {
			await route.fulfill({
				contentType: "application/json",
				json: {
					results: [
						{
							url: "https://example.com/item/1",
							ref: {
								kind: "pull_request",
								id: "00000000-0000-4000-8000-000000000002",
								label: "#1 fix bug",
							},
							tone: "open",
							group: "GitHub",
							why: "match",
							score: 1,
						},
					],
				},
			});
		});

		await visitComposer(page);

		// Part 1: regular chip
		const chip = await pickSam(page);
		// Caret is after the space following the chip. Backspace removes the space.
		await page.keyboard.press("Backspace");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(2);

		// First Backspace after chip: selects it
		await page.keyboard.press("Backspace");
		await expect
			.poll(async () => (await getEditorState(page))?.type)
			.toBe("node");
		await expect(chip).toHaveAttribute("data-selected", "");

		// Second Backspace: deletes it
		await page.keyboard.press("Backspace");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);

		// Part 2: pasted link chip reverts to URL
		await pasteText(page, "https://example.com/item/1");
		const linkChip = page.getByTestId("composer-link");
		await expect(linkChip).toBeVisible();

		// Remove trailing space after the pasted link chip
		await page.keyboard.press("Backspace");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(2);

		// Backspace after chip selects it
		await page.keyboard.press("Backspace");
		await expect
			.poll(async () => (await getEditorState(page))?.type)
			.toBe("node");
		await expect(linkChip).toHaveAttribute("data-selected", "");

		// Second press reverts to its URL
		await page.keyboard.press("Backspace");
		await expect(page.getByTestId("composer-link")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("https://example.com/item/1");
	});

	test("Delete before a chip selects it, and a second press deletes it", async ({
		page,
	}) => {
		await visitComposer(page);
		const chip = await pickSam(page);

		// Move caret to before the chip
		await page.keyboard.press("Home");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(1);

		// First press of Delete before chip: selects it
		await page.keyboard.press("Delete");
		await expect
			.poll(async () => (await getEditorState(page))?.type)
			.toBe("node");
		await expect(chip).toHaveAttribute("data-selected", "");

		// Second press of Delete: deletes it
		await page.keyboard.press("Delete");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
	});

	test("Ctrl+Z restores a removed chip in place, and undoing a pick restores @sam with the caret after it", async ({
		page,
	}) => {
		await visitComposer(page);
		const chip = await pickSam(page);

		// Remove chip via its remove button (one discrete step)
		await chip.getByTestId("composer-chip-remove").click();
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);

		// Ctrl+Z restores removed chip in place
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);

		// Undoing the pick restores @sam with caret after it
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("@sam");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(5);
		await expect.poll(async () => (await getEditorState(page))?.to).toBe(5);
	});

	test("Ctrl+Shift+Z and Ctrl+Y redo, and redo of a pick re-adds the chip", async ({
		page,
	}) => {
		await visitComposer(page);
		await pickSam(page);

		// Undo the pick
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("@sam");

		// Ctrl+Shift+Z redoes, re-adding the chip
		await page.keyboard.press("Control+Shift+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);

		// Undo again
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("@sam");

		// Ctrl+Y redoes, re-adding the chip
		await page.keyboard.press("Control+y");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);
	});

	test("A typing run is one undo step; paste, cut, pick, chip delete and drop are each their own", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// 1. Typing run is one undo step
		await input.pressSequentially("typing run");
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("typing run");
		await page.keyboard.press("Control+z");
		await expect.poll(async () => (await getEditorState(page))?.text).toBe("");

		// 2. Paste is its own undo step
		await input.pressSequentially("A");
		await pasteText(page, "B");
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("AB");
		await page.keyboard.press("Control+z");
		await expect.poll(async () => (await getEditorState(page))?.text).toBe("A");
		await page.keyboard.press("Backspace");

		// 3. Cut is its own undo step
		await input.pressSequentially("CD");
		await page.keyboard.press("Shift+ArrowLeft");
		await page.keyboard.press("Control+x");
		await expect.poll(async () => (await getEditorState(page))?.text).toBe("C");
		await page.keyboard.press("Control+z");
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("CD");
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");

		// 4. Pick is its own undo step
		await input.pressSequentially("@sam");
		await expect(page.getByTestId("composer-menu")).toBeVisible();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("@sam");
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");

		// 5. Chip delete is its own undo step
		const chip = await pickSam(page);
		await chip.getByTestId("composer-chip-remove").click();
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");

		// 6. Drop is its own undo step
		await dropFile(page, "dropped.txt");
		await expect(page.getByTestId("composer-file")).toHaveCount(1);
		await page.keyboard.press("Control+z");
		await expect(page.getByTestId("composer-file")).toHaveCount(0);
	});

	test("Left and Right move over a chip as one unit, Home and End reach the line ends, Ctrl+arrows move by word, Shift+arrows select across chips", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// Construct: "hi " + chip + "there"
		await input.pressSequentially("hi ");
		await pickSam(page);
		await input.pressSequentially("there");

		// Home and End reach the line ends
		await page.keyboard.press("Home");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(1);

		await page.keyboard.press("End");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(11);

		// Ctrl+arrows move by word
		await page.keyboard.press("Control+ArrowLeft");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(6);

		// Left moves over a chip as one unit
		await page.keyboard.press("ArrowLeft"); // pos 5 (after chip)
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(5);
		await page.keyboard.press("ArrowLeft"); // moves over chip as one unit to pos 4
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(4);

		// Right moves over a chip as one unit
		await page.keyboard.press("ArrowRight"); // moves over chip as one unit to pos 5
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(5);

		// Shift+arrows select across chips
		await page.keyboard.press("Shift+ArrowLeft");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(4);
		await expect.poll(async () => (await getEditorState(page))?.to).toBe(5);
	});

	test("Ctrl+A selects text and chips, and Delete removes them all", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		await input.pressSequentially("start ");
		await pickSam(page);
		await input.pressSequentially("end");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);

		await page.keyboard.press("Control+a");
		await expect.poll(async () => (await getEditorState(page))?.from).toBe(0);
		await expect.poll(async () => (await getEditorState(page))?.to).toBe(13);

		await page.keyboard.press("Delete");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect.poll(async () => (await getEditorState(page))?.text).toBe("");
	});

	test("Copy and cut keep chips when pasted back, and the plain-text clipboard reads #Sam's thread", async ({
		page,
	}) => {
		await visitComposer(page);
		await pickSam(page);

		// Delete trailing space and select chip
		await page.keyboard.press("Backspace");
		await page.keyboard.press("Backspace");
		await expect
			.poll(async () => (await getEditorState(page))?.type)
			.toBe("node");

		// Copy chip
		await page.keyboard.press("Control+c");
		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText(),
		);
		expect(clipboardText).toBe("#Sam's thread");

		// Delete chip and paste back
		await page.keyboard.press("Delete");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await page.keyboard.press("Control+v");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);

		// Cut chip
		await page.keyboard.press("Backspace"); // select chip
		await expect
			.poll(async () => (await getEditorState(page))?.type)
			.toBe("node");
		await page.keyboard.press("Control+x");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);

		// Paste cut chip back
		await page.keyboard.press("Control+v");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);
	});

	test("A pasted image becomes a thumbnail chip, a long paste becomes Pasted text, N lines that expands and pastes back as text, and Ctrl+Shift+V pastes raw text", async ({
		page,
	}) => {
		await visitComposer(page);

		// 1. Pasted image becomes a thumbnail chip
		await pasteImage(page, "sample.png");
		const thumb = page.getByTestId("composer-thumb");
		await expect(thumb).toBeVisible();
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");
		await expect(thumb).toHaveCount(0);

		// 2. Long paste becomes Pasted text, N lines
		const linesCount = 45;
		const longText = Array.from(
			{ length: linesCount },
			(_, i) => `line ${i + 1}`,
		).join("\n");
		await pasteText(page, longText);
		const pasteChip = page.getByTestId("composer-paste-chip");
		await expect(pasteChip).toBeVisible();
		await expect(pasteChip).toContainText("Pasted text, 45 lines");

		// 3. Expands
		await pasteChip.click();
		const detail = page.getByTestId("composer-chip-detail");
		await expect(detail).toBeVisible();

		// 4. Pastes back as text
		const pasteAsTextBtn = page.getByTestId("composer-paste-as-text");
		await expect(pasteAsTextBtn).toBeVisible();
		await pasteAsTextBtn.click();
		await expect(page.getByTestId("composer-paste-chip")).toHaveCount(0);
		const stateText = (await getEditorState(page))?.text ?? "";
		expect(stateText).toContain("line 1");
		expect(stateText).toContain("line 45");

		// 5. Ctrl+Shift+V pastes raw text
		await page.keyboard.press("Control+a");
		await page.keyboard.press("Delete");
		await page.getByTestId("composer-input").evaluate((el, text) => {
			// Trigger Ctrl+Shift+V keydown to set rawPaste.current = true
			el.dispatchEvent(
				new KeyboardEvent("keydown", {
					code: "KeyV",
					key: "V",
					ctrlKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			// Followed by paste event
			const dt = new DataTransfer();
			dt.setData("text/plain", text);
			el.dispatchEvent(
				new ClipboardEvent("paste", {
					clipboardData: dt,
					bubbles: true,
					cancelable: true,
				}),
			);
		}, longText);
		await expect(page.getByTestId("composer-paste-chip")).toHaveCount(0);
		const rawTextState = (await getEditorState(page))?.text ?? "";
		expect(rawTextState).toContain("line 1");
		expect(rawTextState).toContain("line 45");
	});

	test("Enter sends, Shift+Enter adds a line, and Enter during IME composition does nothing", async ({
		page,
		context,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// Shift+Enter adds a line
		await input.pressSequentially("first line");
		await page.keyboard.press("Shift+Enter");
		await input.pressSequentially("second line");
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const v = (
						document.querySelector(
							'[data-testid="composer-input"]',
						) as WithEditor | null
					)?.editor?.view;
					let hasBreak = false;
					v?.state.doc.descendants((node) => {
						if (node.type.name === "hardBreak") hasBreak = true;
					});
					return hasBreak;
				}),
			)
			.toBe(true);

		// Enter sends
		const sendPromise = page.waitForRequest(
			(req) => req.url().includes("/api/threads") && req.method() === "POST",
		);
		await page.keyboard.press("Enter");
		const sendReq = await sendPromise;
		const body = sendReq.postDataJSON();
		expect(body.text).toBe("first line\nsecond line");

		// Enter during IME composition does nothing
		await visitComposer(page);
		const newInput = page.getByTestId("composer-input");
		await newInput.focus();

		let threadPostCount = 0;
		page.on("request", (req) => {
			if (req.url().includes("/api/threads") && req.method() === "POST")
				threadPostCount++;
		});

		const cdp = await context.newCDPSession(page);
		await cdp.send("Input.imeSetComposition", {
			text: "@composing",
			selectionStart: 10,
			selectionEnd: 10,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "rawKeyDown",
			windowsVirtualKeyCode: 229,
			code: "Enter",
			key: "Enter",
		});

		// Assert no send request occurred and menu stays closed while composing
		expect(threadPostCount).toBe(0);
		await expect(page.getByTestId("composer-menu")).toHaveCount(0);
	});

	test("Tab picks a menu row, and with no menu it moves focus to the next control", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// Tab picks a menu row
		await input.pressSequentially("@");
		await expect(page.getByTestId("composer-menu")).toBeVisible();
		await page.keyboard.press("Tab");
		await expect(page.getByTestId("composer-menu")).toHaveCount(0);
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);

		// With no menu it moves focus to the next control
		await page.keyboard.press("Tab");
		await expect(input).not.toBeFocused();
		const focusedTestId = await page.evaluate(
			() =>
				document.activeElement?.getAttribute("data-testid") ||
				document.activeElement?.tagName,
		);
		expect(focusedTestId).toBeTruthy();
	});

	test("Escape closes the menu and keeps the text; with no menu it leaves the box and the draft stays", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// Escape closes the menu and keeps the text
		await input.pressSequentially("Hello @sam");
		await expect(page.getByTestId("composer-menu")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByTestId("composer-menu")).toHaveCount(0);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("Hello @sam");

		// With no menu it leaves the box and the draft stays
		await page.keyboard.press("Escape");
		await expect(input).not.toBeFocused();
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toBe("Hello @sam");
	});

	test("Up on an empty box recalls the last sent message with its chips, and Down returns to the draft", async ({
		page,
	}) => {
		await visitComposer(page);
		const input = page.getByTestId("composer-input");
		await input.focus();

		// Send one message with a chip first
		await pickSam(page);
		await input.pressSequentially("check this");

		const sendResPromise = page.waitForResponse(
			(res) =>
				res.url().includes("/api/threads") &&
				res.request().method() === "POST" &&
				res.status() === 200,
		);
		await page.keyboard.press("Enter");
		await sendResPromise;
		await expect(page).toHaveURL(/\/threads\//);

		// Re-visit /new with an empty box
		await visitComposer(page);
		const emptyInput = page.getByTestId("composer-input");
		await expect(emptyInput).toHaveText("");
		await emptyInput.focus();

		// Up on an empty box recalls the last sent message with its chips
		await page.keyboard.press("ArrowUp");
		await expect(page.getByTestId("composer-ref")).toHaveCount(1);
		await expect
			.poll(async () => (await getEditorState(page))?.text)
			.toContain("check this");

		// Down returns to the draft
		await page.keyboard.press("ArrowDown");
		await expect(page.getByTestId("composer-ref")).toHaveCount(0);
		await expect.poll(async () => (await getEditorState(page))?.text).toBe("");
	});

	test("A selected chip shows a focus ring, Enter opens its detail, and its remove button is labelled Remove <label>", async ({
		page,
	}) => {
		await visitComposer(page);
		const chip = await pickSam(page);

		// Delete trailing space and select chip
		await page.keyboard.press("Backspace");
		await page.keyboard.press("Backspace");
		await expect(chip).toHaveAttribute("data-selected", "");

		// Focus ring
		const ringSpan = chip.locator("span").first();
		await expect(ringSpan).toHaveClass(/ring-2/);
		await expect(ringSpan).toHaveClass(/ring-accent/);

		// Enter opens its detail
		await page.keyboard.press("Enter");
		const detail = page.getByTestId("composer-chip-detail");
		await expect(detail).toBeVisible();

		// Remove button is labelled Remove <label>
		const removeBtn = chip.getByTestId("composer-chip-remove");
		await expect(removeBtn).toHaveAttribute(
			"aria-label",
			"Remove Sam's thread",
		);
	});

	test("Dropping a file adds a file chip", async ({ page }) => {
		await visitComposer(page);
		await dropFile(page, "dropped-file.txt");
		const fileChip = page.getByTestId("composer-file");
		await expect(fileChip).toBeVisible();
		await expect(fileChip).toContainText("dropped-file.txt");
	});
});
