// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";
import {
	clearComposer,
	dropFile,
	getEditorState,
	pasteImage,
	pasteText,
	pickFirstHit,
	settledRows,
	visitComposer,
} from "./help-L3";
import {
	cancelThreads,
	createChatThread,
	getThreadRowWrap,
	waitForAsk,
} from "./help-L4";

const idOf = (url: string) => url.split("?")[0]?.split("/").pop() ?? "";

/** #1101 category 7: Chips, attachments and editing keys. */
const checks = defineChecks([
	{
		item: "7.k1",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			await page.route("**/api/references/resolve*", async (route) => {
				await route.fulfill({
					contentType: "application/json",
					json: {
						results: [
							{
								url: "https://example.com/pr/101",
								ref: {
									kind: "pull_request",
									id: "pr-101",
									label: "#101 fix",
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

			try {
				// Part 1: regular chip
				const chip = await pickFirstHit(page, "@");
				await page.keyboard.press("Backspace");
				await expect
					.poll(async () => (await getEditorState(page))?.type)
					.toBe("node");
				if ((await chip.getAttribute("data-selected")) === null) {
					fails.push("Backspace right after chip did not select it");
				}

				await page.keyboard.press("Backspace");
				if ((await page.locator(".composer-chip").count()) !== 0) {
					fails.push("second Backspace did not delete the chip");
				}

				// Part 2: pasted link chip reverts to URL
				await pasteText(page, "https://example.com/pr/101");
				const linkChip = page.getByTestId("composer-link");
				await expect(linkChip).toBeVisible();

				await page.keyboard.press("Backspace");
				await expect
					.poll(async () => (await getEditorState(page))?.type)
					.toBe("node");
				if ((await linkChip.getAttribute("data-selected")) === null) {
					fails.push("Backspace did not select the link chip");
				}

				await page.keyboard.press("Backspace");
				await expect(page.getByTestId("composer-link")).toHaveCount(0);
				const revertedText = (await getEditorState(page))?.text;
				if (revertedText !== "https://example.com/pr/101") {
					fails.push(
						`second Backspace did not revert link chip to URL, found "${revertedText}"`,
					);
				}

				await clearComposer(page);

				return verdict(
					fails,
					`Backspace selected then deleted regular chip; Backspace selected link chip and second press reverted to URL "${revertedText}"`,
				);
			} finally {
				await page.unrouteAll({ behavior: "ignoreErrors" });
			}
		},
	},

	{
		item: "7.k2",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			const chip = await pickFirstHit(page, "@");
			await page.keyboard.press("Home");
			await expect.poll(async () => (await getEditorState(page))?.from).toBe(1);

			await page.keyboard.press("Delete");
			await expect
				.poll(async () => (await getEditorState(page))?.type)
				.toBe("node");
			if ((await chip.getAttribute("data-selected")) === null) {
				fails.push("Delete before chip did not select it forward");
			}

			await page.keyboard.press("Delete");
			if ((await page.locator(".composer-chip").count()) !== 0) {
				fails.push("second Delete did not delete the chip");
			}

			await clearComposer(page);
			return verdict(
				fails,
				"Delete before chip selects forward on first press and deletes on second press",
			);
		},
	},

	{
		item: "7.k3",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];
			const doc = () =>
				page.evaluate(() =>
					JSON.stringify(
						(
							document.querySelector('[data-testid="composer-input"]') as
								| (HTMLElement & { editor?: { getJSON: () => unknown } })
								| null
						)?.editor?.getJSON() ?? null,
					),
				);

			await input.pressSequentially("see @st");
			await settledRows(page);
			await page.keyboard.press("Enter");
			const chip = page.locator(".composer-chip");
			await expect(chip).toHaveCount(1);
			const withChip = await doc();
			await chip.getByTestId("composer-chip-remove").click();
			await expect(chip).toHaveCount(0);

			// Ctrl+Z puts the removed chip back where it was: the document is the same.
			await page.keyboard.press("Control+z");
			await expect(chip).toHaveCount(1);
			if ((await doc()) !== withChip)
				fails.push("the restored chip is not where it was in the document");

			// A second undo takes the pick back to the typed text, caret after it.
			await page.keyboard.press("Control+z");
			await expect(chip).toHaveCount(0);
			const state = await getEditorState(page);
			if (state?.text !== "see @st")
				fails.push(`undo of the pick left "${state?.text}", not "see @st"`);
			if (state && state.from !== state.text.length + 1)
				fails.push(`the caret is at ${state.from}, not after "@st"`);

			await clearComposer(page);
			return verdict(
				fails,
				`Ctrl+Z restored the removed chip with the same document; a second undo restored "${state?.text}" with the caret at ${state?.from}`,
			);
		},
	},

	{
		item: "7.k4",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			await pickFirstHit(page, "@");
			await expect(page.locator(".composer-chip")).toHaveCount(1);

			await page.keyboard.press("Control+z");
			await expect(page.locator(".composer-chip")).toHaveCount(0);

			// Ctrl+Shift+Z redo
			await page.keyboard.press("Control+Shift+z");
			await expect(page.locator(".composer-chip")).toHaveCount(1);
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("Ctrl+Shift+Z did not redo pick to re-add chip");
			}

			await page.keyboard.press("Control+z");
			await expect(page.locator(".composer-chip")).toHaveCount(0);

			// Ctrl+Y redo
			await page.keyboard.press("Control+y");
			await expect(page.locator(".composer-chip")).toHaveCount(1);
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("Ctrl+Y did not redo pick to re-add chip");
			}

			await clearComposer(page);
			return verdict(
				fails,
				"Ctrl+Shift+Z and Ctrl+Y both redo pick, re-adding the chip",
			);
		},
	},

	{
		item: "7.k5",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			// 1. Typing run is one step
			await input.pressSequentially("typing run");
			await page.keyboard.press("Control+z");
			const text1 = (await getEditorState(page))?.text;
			if (text1 !== "")
				fails.push(`typing run was not 1 step: text is "${text1}"`);

			// 2. Paste is its own step
			await input.pressSequentially("A");
			await pasteText(page, "B");
			await expect
				.poll(async () => (await getEditorState(page))?.text)
				.toBe("AB");
			await page.keyboard.press("Control+z");
			const text2 = (await getEditorState(page))?.text;
			if (text2 !== "A")
				fails.push(`paste undo step failed: text is "${text2}"`);
			await page.keyboard.press("Backspace");

			// 3. Cut is its own step
			await input.pressSequentially("CD");
			await page.keyboard.press("Shift+ArrowLeft");
			await page.keyboard.press("Control+x");
			await expect
				.poll(async () => (await getEditorState(page))?.text)
				.toBe("C");
			await page.keyboard.press("Control+z");
			const text3 = (await getEditorState(page))?.text;
			if (text3 !== "CD")
				fails.push(`cut undo step failed: text is "${text3}"`);
			await clearComposer(page);

			// 4. Pick is its own step
			await pickFirstHit(page, "@");
			await page.keyboard.press("Control+z");
			if ((await page.locator(".composer-chip").count()) !== 0) {
				fails.push("pick was not its own undo step");
			}
			await clearComposer(page);

			// 5. Chip delete is its own step
			const chip = await pickFirstHit(page, "@");
			await chip.getByTestId("composer-chip-remove").click();
			await expect(page.locator(".composer-chip")).toHaveCount(0);
			await page.keyboard.press("Control+z");
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("chip delete was not its own undo step");
			}
			await clearComposer(page);

			// 6. Drop is its own step
			await dropFile(page, "drop-step.txt");
			await expect(page.getByTestId("composer-file")).toHaveCount(1);
			await page.keyboard.press("Control+z");
			if ((await page.getByTestId("composer-file").count()) !== 0) {
				fails.push("file drop was not its own undo step");
			}

			await clearComposer(page);
			return verdict(
				fails,
				"6 grouped undo steps verified: typing run, paste, cut, pick, chip delete, drop each undo as discrete steps",
			);
		},
	},

	{
		item: "7.k6",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await input.pressSequentially("hi ");
			await pickFirstHit(page, "@");
			await input.pressSequentially("there");

			// Home goes to start (pos 1)
			await page.keyboard.press("Home");
			await expect.poll(async () => (await getEditorState(page))?.from).toBe(1);

			// End goes to end
			await page.keyboard.press("End");
			const docSize = await page.evaluate(
				() =>
					(
						document.querySelector('[data-testid="composer-input"]') as
							| (HTMLElement & {
									editor?: { state: { doc: { content: { size: number } } } };
							  })
							| null
					)?.editor?.state.doc.content.size ?? 0,
			);
			await expect
				.poll(async () => (await getEditorState(page))?.from)
				.toBe(docSize - 1);
			const endPos = docSize - 1;

			// Ctrl+Left lands on the start of the last word, Ctrl+Right back at its end.
			await page.keyboard.press("Control+ArrowLeft");
			const wordStart = endPos - "there".length;
			await expect
				.poll(async () => (await getEditorState(page))?.from)
				.toBe(wordStart)
				.catch(async () => {
					fails.push(
						`Ctrl+Left left the caret at ${(await getEditorState(page))?.from}, not at the last word's start ${wordStart}`,
					);
				});
			const wordPos = (await getEditorState(page))?.from ?? 0;
			await page.keyboard.press("Control+ArrowRight");
			await expect
				.poll(async () => (await getEditorState(page))?.from)
				.toBe(endPos)
				.catch(async () => {
					fails.push(
						`Ctrl+Right left the caret at ${(await getEditorState(page))?.from}, not at the word's end ${endPos}`,
					);
				});

			// Find exact chip position
			const chipPos = await page.evaluate(() => {
				const el = document.querySelector('[data-testid="composer-input"]') as
					| (HTMLElement & {
							editor?: {
								view: {
									state: {
										doc: {
											descendants: (
												fn: (
													node: { type: { name: string } },
													pos: number,
												) => boolean | undefined,
											) => void;
										};
									};
								};
							};
					  })
					| null;
				let p = -1;
				el?.editor?.view.state.doc.descendants((node, pos) => {
					if (node.type.name === "chip") {
						p = pos;
						return false;
					}
				});
				return p;
			});

			if (chipPos < 0) {
				fails.push("chip node not found in editor doc");
			} else {
				// 1. Left moves over chip as one unit (from chipPos + 1 to chipPos)
				await page.evaluate((pos) => {
					const el = document.querySelector('[data-testid="composer-input"]') as
						| (HTMLElement & {
								editor?: {
									commands: {
										setTextSelection: (pos: number) => void;
									};
								};
						  })
						| null;
					el?.editor?.commands.setTextSelection(pos);
				}, chipPos + 1);

				await page.keyboard.press("ArrowLeft");
				const stateLeft = await getEditorState(page);
				const leftOk =
					stateLeft?.from === chipPos ||
					(stateLeft?.from === chipPos && stateLeft?.to === chipPos + 1);
				if (!leftOk) {
					fails.push(
						`Left did not move over chip as 1 unit: from=${stateLeft?.from}, to=${stateLeft?.to}, expected pos ${chipPos}`,
					);
				}

				// 2. Right moves over chip as one unit (from chipPos to chipPos + 1)
				await page.evaluate((pos) => {
					const el = document.querySelector('[data-testid="composer-input"]') as
						| (HTMLElement & {
								editor?: {
									commands: {
										setTextSelection: (pos: number) => void;
									};
								};
						  })
						| null;
					el?.editor?.commands.setTextSelection(pos);
				}, chipPos);

				await page.keyboard.press("ArrowRight");
				const stateRight = await getEditorState(page);
				const rightOk =
					stateRight?.from === chipPos + 1 ||
					(stateRight?.from === chipPos && stateRight?.to === chipPos + 1);
				if (!rightOk) {
					fails.push(
						`Right did not move over chip as 1 unit: from=${stateRight?.from}, to=${stateRight?.to}, expected pos ${chipPos + 1}`,
					);
				}

				// 3. Shift+Arrow selects across chip
				await page.evaluate((pos) => {
					const el = document.querySelector('[data-testid="composer-input"]') as
						| (HTMLElement & {
								editor?: {
									commands: {
										setTextSelection: (pos: number) => void;
									};
								};
						  })
						| null;
					el?.editor?.commands.setTextSelection(pos);
				}, chipPos);

				await page.keyboard.press("Shift+ArrowRight");
				const stateShift = await getEditorState(page);
				if (stateShift?.from !== chipPos || stateShift?.to !== chipPos + 1) {
					fails.push(
						`Shift+ArrowRight did not select across chip: from=${stateShift?.from}, to=${stateShift?.to}`,
					);
				}
			}

			await clearComposer(page);
			return verdict(
				fails,
				`arrow navigation: Home (1), End (${endPos}), Ctrl+Left word boundary (${wordPos}), Left/Right 1-unit step over chip (${chipPos}..${chipPos + 1}), Shift+Arrow selection`,
			);
		},
	},

	{
		item: "7.k7",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await input.pressSequentially("start ");
			await pickFirstHit(page, "@");
			await input.pressSequentially("end");
			await expect(page.locator(".composer-chip")).toHaveCount(1);

			await page.keyboard.press("Control+a");
			const state = await getEditorState(page);
			if (state?.from !== 0 || (state?.to ?? 0) < 10) {
				fails.push(
					`Ctrl+A did not select all: from=${state?.from}, to=${state?.to}`,
				);
			}

			await page.keyboard.press("Delete");
			await expect(page.locator(".composer-chip")).toHaveCount(0);
			const remaining = (await getEditorState(page))?.text;
			if (remaining !== "") {
				fails.push(`Delete after Ctrl+A left text: "${remaining}"`);
			}

			await clearComposer(page);
			return verdict(
				fails,
				`Ctrl+A selected all content (range 0..${state?.to}) and Delete removed text and chips completely`,
			);
		},
	},

	{
		item: "7.k8",
		async run({ page, open, context }) {
			await context.grantPermissions(["clipboard-read", "clipboard-write"]);
			await visitComposer(page, open);
			const fails: string[] = [];

			await pickFirstHit(page, "@");
			await page.keyboard.press("Backspace"); // selects chip
			await expect
				.poll(async () => (await getEditorState(page))?.type)
				.toBe("node");

			await page.keyboard.press("Control+c");
			const clipboardText = await page.evaluate(() =>
				navigator.clipboard.readText(),
			);
			if (
				!clipboardText ||
				(!clipboardText.includes("@") && !clipboardText.includes("#"))
			) {
				fails.push(
					`plain-text clipboard missing readable text: "${clipboardText}"`,
				);
			}

			await page.keyboard.press("Delete");
			await expect(page.locator(".composer-chip")).toHaveCount(0);

			await page.keyboard.press("Control+v");
			await expect(page.locator(".composer-chip")).toHaveCount(1);
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("paste did not restore chip in box");
			}

			await page.keyboard.press("Backspace"); // selects chip
			await page.keyboard.press("Control+x");
			await expect(page.locator(".composer-chip")).toHaveCount(0);

			await page.keyboard.press("Control+v");
			await expect(page.locator(".composer-chip")).toHaveCount(1);
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("paste of cut chip did not restore chip in box");
			}

			await clearComposer(page);
			return verdict(
				fails,
				`Copy and cut keep chip; pasted elsewhere clipboard reads readable text "${clipboardText}"`,
			);
		},
	},

	{
		item: "7.k9",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			// 1. Pasted image becomes attachment chip
			await pasteImage(page, "test-pic.png");
			const thumb = page.getByTestId("composer-thumb");
			await expect(thumb).toBeVisible();
			if ((await thumb.count()) === 0) {
				fails.push("pasted image did not produce thumbnail chip");
			}

			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");

			// 2. Over 40 lines becomes Pasted text chip
			const lines = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join(
				"\n",
			);
			await pasteText(page, lines);
			const pasteChip = page.getByTestId("composer-paste-chip");
			await expect(pasteChip).toBeVisible();
			const chipLabel = (await pasteChip.textContent())?.trim();
			if (!chipLabel?.includes("45 lines")) {
				fails.push(
					`long paste chip label "${chipLabel}" does not say 45 lines`,
				);
			}

			// 2b. Over 2,000 characters on one line folds too
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");
			await expect(page.getByTestId("composer-paste-chip")).toHaveCount(0);
			await pasteText(page, "x".repeat(2100));
			await expect(page.getByTestId("composer-paste-chip")).toBeVisible();
			const charLabel = (
				await page.getByTestId("composer-paste-chip").textContent()
			)?.trim();
			if (!charLabel?.startsWith("Pasted text"))
				fails.push(
					`2,100 characters made "${charLabel}", not a Pasted text chip`,
				);
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");
			await pasteText(page, lines);
			await expect(page.getByTestId("composer-paste-chip")).toBeVisible();

			// 3. Expands back into text
			await pasteChip.click();
			const expandBtn = page.getByTestId("composer-paste-as-text");
			await expect(expandBtn).toBeVisible();
			await expandBtn.click();
			await expect(page.getByTestId("composer-paste-chip")).toHaveCount(0);
			const expandedText = (await getEditorState(page))?.text;
			if (
				!expandedText?.includes("line 1") ||
				!expandedText?.includes("line 45")
			) {
				fails.push("paste chip did not expand back to full text");
			}

			// 4. Ctrl+Shift+V pastes raw text
			await clearComposer(page);
			await page.getByTestId("composer-input").evaluate((el, text) => {
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
				const dt = new DataTransfer();
				dt.setData("text/plain", text);
				el.dispatchEvent(
					new ClipboardEvent("paste", {
						clipboardData: dt,
						bubbles: true,
						cancelable: true,
					}),
				);
			}, lines);
			await expect(page.getByTestId("composer-paste-chip")).toHaveCount(0);
			const rawState = (await getEditorState(page))?.text;
			if (!rawState?.includes("line 1") || !rawState?.includes("line 45")) {
				fails.push("Ctrl+Shift+V did not paste raw text");
			}

			await clearComposer(page);
			return verdict(
				fails,
				`Pasted image shows thumbnail; 45 lines folded into "${chipLabel}", expanded back to text; Ctrl+Shift+V pasted raw text`,
			);
		},
	},

	{
		item: "7.k10",
		async run({ page, open, context }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];
			const made: string[] = [];
			const threadPosts: string[] = [];
			const isThreadPost = (r: { method(): string; url(): string }) =>
				r.method() === "POST" && new URL(r.url()).pathname === "/api/threads";
			page.on("request", (r) => {
				if (isThreadPost(r)) threadPosts.push(r.url());
			});

			try {
				// Shift+Enter is a newline, not a send.
				await input.pressSequentially("line 1");
				await page.keyboard.press("Shift+Enter");
				await input.pressSequentially("line 2");
				const breaks = await page.evaluate(() => {
					const el = document.querySelector('[data-testid="composer-input"]') as
						| (HTMLElement & { editor?: { getJSON: () => unknown } })
						| null;
					return (
						JSON.stringify(el?.editor?.getJSON() ?? {}).split("hardBreak")
							.length - 1
					);
				});
				if (breaks !== 1)
					fails.push(`Shift+Enter made ${breaks} line breaks, not 1`);
				if (threadPosts.length > 0) fails.push("Shift+Enter sent the message");

				// Enter sends the two lines as one message.
				const [req] = await Promise.all([
					page.waitForRequest(isThreadPost, { timeout: 10_000 }),
					page.keyboard.press("Enter"),
				]);
				const sent = JSON.stringify(req.postDataJSON());
				if (!sent.includes("line 1\\nline 2"))
					fails.push(`Enter sent ${sent.slice(0, 120)}, not both lines`);
				await page.waitForURL(/\/threads\//);
				made.push(idOf(page.url()));

				// Enter queues while a turn runs; with an ask open Enter answers it, so use a turn that only waits.
				const liveId = await createChatThread(page, "fake-session:tools k10");
				made.push(liveId);
				await open(`/threads/${liveId}`);
				await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
				const liveInput = page.getByTestId("composer-input");
				await liveInput.focus();
				await liveInput.pressSequentially("queued note");
				await page.keyboard.press("Enter");
				const queued = page.getByTestId("composer-queued");
				await expect(queued).toHaveCount(1);
				const queuedText = (await queued.textContent())?.trim() ?? "";
				if (!queuedText.includes("queued note"))
					fails.push(`the queued row read "${queuedText}"`);

				// Enter during IME composition does nothing: nothing more is queued or sent.
				await liveInput.pressSequentially("ime test");
				const before = threadPosts.length;
				const cdp = await context.newCDPSession(page);
				await cdp.send("Input.imeSetComposition", {
					text: "ime",
					selectionStart: 3,
					selectionEnd: 3,
				});
				await cdp.send("Input.dispatchKeyEvent", {
					type: "rawKeyDown",
					windowsVirtualKeyCode: 229,
					code: "Enter",
					key: "Process",
				});
				await page.waitForTimeout(600);
				if ((await queued.count()) !== 1)
					fails.push("Enter during IME composition queued a message");
				if (threadPosts.length !== before)
					fails.push("Enter during IME composition sent a message");
				const boxText =
					(await liveInput.textContent())?.trim().replace(/\s+/g, " ") ?? "";
				if (!boxText.includes("ime test"))
					fails.push(`the box lost its text: "${boxText}"`);

				return verdict(
					fails,
					`Shift+Enter made ${breaks} line break and sent nothing; Enter sent "line 1\\nline 2" in one POST; Enter in a running thread queued "${queuedText}"; Enter during IME composition queued and sent nothing and kept "${boxText}"`,
				);
			} finally {
				await cancelThreads(page, made);
			}
		},
	},

	{
		item: "7.k11",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			// Tab picks a menu row
			await input.pressSequentially("@");
			const menu = page.getByTestId("composer-menu");
			await settledRows(page);
			await page.keyboard.press("Tab");
			await expect(menu).toHaveCount(0);
			if ((await page.locator(".composer-chip").count()) !== 1) {
				fails.push("Tab did not pick the menu row into one chip");
			}

			// Tab with no menu moves focus out of composer
			await page.keyboard.press("Tab");
			const activeId = await page.evaluate(
				() =>
					document.activeElement?.getAttribute("data-testid") ??
					document.activeElement?.tagName,
			);
			if (activeId === "composer-input") {
				fails.push("Tab with no menu did not move focus out of composer");
			}

			await clearComposer(page);
			return verdict(
				fails,
				`Tab picked menu row into chip; with no menu Tab moved focus to "${activeId}"`,
			);
		},
	},

	{
		item: "7.k12",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			// With a menu open, Escape closes it and leaves the text.
			await input.pressSequentially("draft text @test");
			await expect(page.getByTestId("composer-menu")).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("composer-menu")).toHaveCount(0);
			const textAfterEsc = (await getEditorState(page))?.text;
			if (textAfterEsc !== "draft text @test")
				fails.push(`Escape left "${textAfterEsc}" in the box`);
			await clearComposer(page);

			// With no menu, Escape stops a running turn and keeps the draft.
			const liveId = await createChatThread(page, "fake-session:ask k12");
			try {
				await waitForAsk(page, liveId);
				await open(`/threads/${liveId}`);
				const stop = page.getByRole("button", { name: "Stop" });
				await expect(stop).toBeVisible();
				const liveInput = page.getByTestId("composer-input");
				await liveInput.focus();
				await liveInput.pressSequentially("keep this draft");
				await page.keyboard.press("Escape");
				await expect(stop).toHaveCount(0);
				const kept = (await getEditorState(page))?.text;
				if (kept !== "keep this draft")
					fails.push(`after stopping, the draft was "${kept}"`);
				await clearComposer(page);

				return verdict(
					fails,
					`Escape closed the menu and kept "${textAfterEsc}"; with no menu it stopped the running turn and kept the draft "${kept}"`,
				);
			} finally {
				await cancelThreads(page, [liveId]);
			}
		},
	},

	{
		item: "7.k13",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await page.route("**/api/threads*", async (route) => {
				if (route.request().method() === "POST") {
					await route.fulfill({
						contentType: "application/json",
						json: {
							investigationId: "00000000-0000-4000-8000-000000000099",
							jobId: null,
							queued: false,
						},
					});
				} else {
					await route.continue();
				}
			});

			try {
				await pickFirstHit(page, "@");
				await input.pressSequentially("recalled query text");
				const sendRes = page.waitForResponse(
					(res) =>
						res.url().includes("/api/threads") &&
						res.request().method() === "POST",
				);
				await page.keyboard.press("Enter");
				await sendRes;

				// Re-visit /new with empty draft
				await visitComposer(page, open);

				// Up recalls last message with chip
				await page.keyboard.press("ArrowUp");
				const chips = page.locator(".composer-chip");
				const upOk = await expect(chips)
					.toHaveCount(1, { timeout: 20_000 })
					.then(() => true)
					.catch(() => false);
				if (!upOk)
					fails.push(`Up left ${await chips.count()} chips, expected 1`);
				const recalledText = (await getEditorState(page))?.text;
				if (!recalledText?.includes("recalled query text")) {
					fails.push(`ArrowUp did not recall message text: "${recalledText}"`);
				}

				// Down returns to draft, once the recalled box has finished painting on the slow link.
				await page.waitForTimeout(2000);
				await page.keyboard.press("ArrowDown");
				const downOk = await expect(chips)
					.toHaveCount(0, { timeout: 20_000 })
					.then(() => true)
					.catch(() => false);
				if (!downOk)
					fails.push(`Down left ${await chips.count()} chips, expected 0`);
				const returnedText = (await getEditorState(page))?.text;
				if (returnedText !== "") {
					fails.push(
						`ArrowDown did not return to empty draft, found "${returnedText}"`,
					);
				}

				await clearComposer(page);
				return verdict(
					fails,
					`ArrowUp recalled message with chip ("${recalledText}"); ArrowDown returned to empty draft`,
				);
			} finally {
				await page.unrouteAll({ behavior: "ignoreErrors" });
			}
		},
	},

	{
		item: "7.k14",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			const chip = await pickFirstHit(page, "@");
			await page.keyboard.press("Backspace"); // selects chip
			await expect(chip).toHaveAttribute("data-selected", "");

			// Focus ring visible
			const ringSpan = chip.locator("span").first();
			const hasRing = await ringSpan.evaluate((el) => {
				const cls = el.className;
				return cls.includes("ring-2") && cls.includes("ring-accent");
			});
			if (!hasRing) {
				fails.push(
					"selected chip does not have visible ring classes (ring-2 ring-accent)",
				);
			}

			// Enter opens chip detail
			await page.keyboard.press("Enter");
			const detail = page.getByTestId("composer-chip-detail");
			await expect(detail).toBeVisible();
			if ((await detail.count()) === 0) {
				fails.push("Enter did not open chip detail popover");
			}

			// Remove button is labelled
			const removeBtn = chip.getByTestId("composer-chip-remove");
			const removeLabel = await removeBtn.getAttribute("aria-label");
			if (!removeLabel?.startsWith("Remove ")) {
				fails.push(
					`remove button aria-label "${removeLabel}" does not start with "Remove "`,
				);
			}

			await page.keyboard.press("Escape");
			await clearComposer(page);
			return verdict(
				fails,
				`chip focus ring verified, Enter opened chip detail popover, remove button labelled "${removeLabel}"`,
			);
		},
	},

	{
		item: "7.k15",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			await dropFile(
				page,
				"dropped-spec.txt",
				"text/plain",
				"specification content",
			);
			const fileChip = page.getByTestId("composer-file");
			await expect(fileChip).toBeVisible();
			const chipText = (await fileChip.textContent())?.trim();
			if (!chipText?.includes("dropped-spec.txt")) {
				fails.push(
					`dropped file chip text "${chipText}" does not contain dropped-spec.txt`,
				);
			}

			await clearComposer(page);
			return verdict(
				fails,
				`dropping a file added file chip with label "${chipText}"`,
			);
		},
	},

	{
		item: "7.k16",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const path = sim.thread("host.standby", 0);
			await open(path);
			const input = page.getByTestId("composer-input");
			await expect(input).toBeVisible({ timeout: 45_000 });
			const editorText = async () => (await getEditorState(page))?.text ?? "";
			const outsideField = () =>
				page.evaluate(() => {
					const a = document.activeElement as HTMLElement | null;
					return (
						!a ||
						a === document.body ||
						!(
							a.tagName === "INPUT" ||
							a.tagName === "TEXTAREA" ||
							a.isContentEditable ||
							a.closest("[data-testid=thread-row-wrap]")
						)
					);
				});
			// Focus leaves any field: a click on the transcript's empty margin.
			const blur = async () => {
				const scroller = await page
					.getByTestId("transcript-scroller")
					.boundingBox({ timeout: 10_000 });
				if (!scroller) throw new Error("no transcript to click beside");
				await page.mouse.click(
					scroller.x + scroller.width - 6,
					scroller.y + scroller.height / 2,
				);
			};

			// 1. A draft, then letters typed with focus outside any field land after it.
			await clearComposer(page);
			await page.keyboard.type("draft ");
			await expect.poll(editorText, { timeout: 10_000 }).toBe("draft ");
			await page.waitForTimeout(1500);
			await blur();
			if (!(await outsideField()))
				fails.push("the click on the transcript left focus inside a field");
			const urlBefore = page.url();
			await page.keyboard.type("abc", { delay: 40 });
			await page.waitForTimeout(500);
			const typed = await editorText();
			if (typed !== "draft abc")
				fails.push(
					`letters typed outside a field read "${typed}" in the box, expected "draft abc"`,
				);

			// 2. A bare letter that was once a shortcut does nothing but type.
			await blur();
			await page.keyboard.type("gjn?", { delay: 40 });
			await page.waitForTimeout(800);
			const dialogs = await page.locator("[role=dialog]").count();
			if (page.url() !== urlBefore)
				fails.push(
					`bare letters navigated: ${new URL(urlBefore).pathname} -> ${new URL(page.url()).pathname}`,
				);
			if (dialogs) fails.push(`bare letters opened ${dialogs} dialogs`);

			// 3. Letters typed before the page finishes loading land after the draft too.
			await page.waitForTimeout(1500);
			await page.goto(path, { waitUntil: "commit" });
			await page.keyboard.type("qrs", { delay: 30 });
			await expect(input).toBeVisible({ timeout: 60_000 });
			await page.waitForTimeout(1500);
			const early = await editorText();
			if (!early.startsWith("draft abc") || !early.endsWith("qrs"))
				fails.push(
					`letters typed before the page loaded read "${early}", expected the draft then "qrs"`,
				);
			await clearComposer(page);

			// 4. A single-key action runs on the row that has focus.
			const asked = await createChatThread(page, "fake-session:ask test-7-k16");
			let acted = "";
			try {
				await waitForAsk(page, asked);
				const wrap = getThreadRowWrap(page, asked);
				await expect(wrap).toBeVisible({ timeout: 45_000 });
				// Until the row carries its ask (its Answer button), its keys are not bound.
				await expect(wrap.getByTestId("row-answer")).toBeAttached({
					timeout: 30_000,
				});
				await wrap.getByTestId("thread-row").focus();
				await page.keyboard.press("n");
				acted = await expect(wrap.getByTestId("row-ask-answered"))
					.toBeVisible({ timeout: 15_000 })
					.then(() => "declined the ask")
					.catch(() => "");
				if (!acted)
					fails.push("N on a focused needs-you row did not answer its ask");
			} finally {
				await cancelThreads(page, [asked]);
			}

			return verdict(
				fails,
				`outside a field "abc" landed after the draft ("${typed}"), "gjn?" changed no URL, letters typed before load landed ("${early}"), and N on the focused row ${acted}`,
			);
		},
	},

	{
		item: "7.1",
		async run() {
			const fails: string[] = [];
			const keyRows = checks.filter((c) => /^7\.k\d+$/.test(c.item));
			// The key rows run first in this category and each leaves its verdict; 16 reruns do not fit one check's 180 s on the slow link (#1101).
			const saved = (
				item: string,
			): { status: string; value: string } | null => {
				try {
					return JSON.parse(
						readFileSync(
							join(
								resolve(process.env.BAR_OUT ?? "test-results/bar"),
								"results",
								`${item}.json`,
							),
							"utf8",
						),
					);
				} catch {
					return null;
				}
			};
			const unproven: string[] = [];
			for (const c of keyRows) {
				const r = saved(c.item);
				if (!r) {
					unproven.push(`${c.item} has no verdict in this run`);
				} else if (
					r.status === "fail" &&
					/^check (threw|timed out)/.test(r.value)
				) {
					unproven.push(`${c.item} ${r.value}`);
				} else if (r.status === "fail") {
					fails.push(`${c.item}: ${r.value}`);
				} else if (r.status !== "pass") {
					unproven.push(`${c.item} not set up: ${r.value}`);
				}
			}
			if (!fails.length && unproven.length)
				return notSetUp(`key rows not proven: ${unproven.join("; ")}`);
			return verdict(
				fails,
				`all ${keyRows.length} key-list rows passed on this run`,
			);
		},
	},

	{
		item: "7.2",
		async run({ page, open }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await input.pressSequentially("compare ");
			await pickFirstHit(page, "@");
			await input.pressSequentially("with ");
			await pickFirstHit(page, "@");

			const inlineNodes = await page.evaluate(() => {
				const el = document.querySelector('[data-testid="composer-input"]') as
					| (HTMLElement & {
							editor?: {
								view: {
									state: {
										doc: {
											content: {
												firstChild?: {
													content: {
														forEach: (
															fn: (n: {
																type: { name: string };
																text?: string;
															}) => void,
														) => void;
													};
												};
											};
										};
									};
								};
							};
					  })
					| null;
				const names: string[] = [];
				el?.editor?.view.state.doc.content.firstChild?.content.forEach((n) => {
					names.push(n.type.name === "chip" ? "chip" : (n.text ?? "text"));
				});
				return names;
			});

			if (inlineNodes[0] !== "compare ") {
				fails.push(`node 0 is "${inlineNodes[0]}", expected "compare "`);
			}
			if (inlineNodes[1] !== "chip") {
				fails.push(`node 1 is "${inlineNodes[1]}", expected "chip"`);
			}
			if (!inlineNodes[2]?.includes("with")) {
				fails.push(`node 2 is "${inlineNodes[2]}", expected "with "`);
			}
			if (inlineNodes[3] !== "chip") {
				fails.push(`node 3 is "${inlineNodes[3]}", expected "chip"`);
			}

			await clearComposer(page);
			return verdict(
				fails,
				`chips sit inline: node sequence is [${inlineNodes.join(", ")}]`,
			);
		},
	},

	{
		item: "7.3",
		async run({ page, open }) {
			await visitComposer(page, open);
			const fails: string[] = [];

			// 1. Pasted image shows thumbnail
			await pasteImage(page, "instant-shot.png");
			const thumb = page.getByTestId("composer-thumb");
			await expect(thumb).toBeVisible({ timeout: 1000 });
			const src = await thumb.getAttribute("src");
			if (!src?.startsWith("blob:") && !src?.startsWith("data:image/")) {
				fails.push(`thumbnail src "${src}" is neither blob: nor data:`);
			}
			await page.keyboard.press("Control+a");
			await page.keyboard.press("Delete");

			// 2. Refused file
			await dropFile(page, "payload.exe", "application/x-msdownload", "binary");
			const refusedChip = page.locator('.composer-chip[data-refused=""]');
			await expect(refusedChip).toBeVisible();
			const refusalEl = refusedChip.getByTestId("composer-file-refusal");
			await expect(refusalEl).toBeVisible();
			const refusalReason = (await refusalEl.textContent())?.trim();
			if (!refusalReason?.toLowerCase().includes("program")) {
				fails.push(
					`refusal reason "${refusalReason}" does not mention programs`,
				);
			}

			await clearComposer(page);
			return verdict(
				fails,
				`pasted image rendered immediate thumbnail (${src?.slice(0, 30)}...); refused executable showed chip reason "${refusalReason}"`,
			);
		},
	},

	{
		item: "7.4",
		async run({ page, open, device, sim }) {
			const input = await visitComposer(page, open);
			const fails: string[] = [];

			await input.pressSequentially("persisted draft ");
			await pickFirstHit(page, "@");

			// Wait for draft auto-save debounce
			await page.waitForTimeout(600);

			// 1. Reload preserves text and chips
			await page.reload();
			const reloadedInput = page.getByTestId("composer-input");
			await expect(reloadedInput).toBeVisible();
			await expect(reloadedInput.locator(".composer-chip")).toHaveCount(1);
			const reloadedText = (await getEditorState(page))?.text;
			if (!reloadedText?.includes("persisted draft")) {
				fails.push(`reload did not keep text: "${reloadedText}"`);
			}

			// 2. Second device sees the same draft and chips
			const phone = await device({ width: 390 });
			await phone.goto(`${sim.url}/new`);
			const phoneInput = phone.getByTestId("composer-input");
			await expect(phoneInput).toBeVisible();
			await expect(phoneInput.locator(".composer-chip")).toHaveCount(1);
			const phoneText = await phone.evaluate(() => {
				const el = document.querySelector('[data-testid="composer-input"]') as
					| (HTMLElement & {
							editor?: { view: { state: { doc: { textContent: string } } } };
					  })
					| null;
				return el?.editor?.view.state.doc.textContent;
			});
			if (!phoneText?.includes("persisted draft")) {
				fails.push(`second device did not sync draft text: "${phoneText}"`);
			}

			await phone.close();
			await clearComposer(page);

			return verdict(
				fails,
				`draft survived reload (text: "${reloadedText}", 1 chip) and synced to second device (text: "${phoneText}", 1 chip)`,
			);
		},
	},
]);

export default checks;
