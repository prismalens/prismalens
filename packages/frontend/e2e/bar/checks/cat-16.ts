// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** #1101 category 16, Diff and files. */
export default defineChecks([
	{
		item: "16.1",
		async run({ page, open, sim, device }) {
			await open(`${sim.thread("huge.diff", 0)}?panel=changes`);
			const diff = page.getByTestId("diff-surface");
			await expect(diff).toBeVisible();

			const fails: string[] = [];
			// File tree with filter and per-file +/-
			const tree = page.getByTestId("diff-tree-column");
			await expect(tree).toBeVisible();

			const counts = page.getByTestId("diff-total-add");
			await expect(counts).toBeVisible();

			// Split and unified views
			const splitBtn = page.getByTestId("diff-style-split");
			const unifiedBtn = page.getByTestId("diff-style-unified");
			const wrapBtn = page.getByTestId("diff-style-wrap");

			await expect(splitBtn).toBeVisible();
			await expect(unifiedBtn).toBeVisible();
			await expect(wrapBtn).toBeVisible();

			// Wrap toggle
			const initialWrap = await wrapBtn.getAttribute("aria-pressed");
			await wrapBtn.click();
			const toggledWrap = await wrapBtn.getAttribute("aria-pressed");
			if (initialWrap === toggledWrap) {
				fails.push("wrap toggle did not change pressed state");
			}
			await wrapBtn.click(); // restore

			// Per-file +/- in the tree, and a filter that narrows it
			const treeFiles = page.getByTestId("diff-files");
			await expect(treeFiles.getByText(/^\+\d+/).first()).toBeVisible();
			const filter = page.getByPlaceholder("Search…");
			const treeNames = () =>
				page.evaluate(() => {
					const host = document.querySelector("[data-testid=diff-files]");
					const root = host?.querySelector("*")?.shadowRoot;
					return Array.from(
						root?.querySelectorAll("[role=treeitem]") ?? [],
					).map((e) =>
						(e.getAttribute("aria-label") ?? e.textContent ?? "").trim(),
					);
				});
			const unfiltered = (await treeNames()).length;
			await filter.fill("CODEOWNERS");
			await expect.poll(treeNames, { timeout: 20_000 }).toContain("CODEOWNERS");
			const narrowed = (await treeNames()).length;
			if (narrowed >= unfiltered) {
				fails.push(`filter left ${narrowed} of ${unfiltered} tree rows`);
			}
			await filter.fill("");

			// Split and unified on one file's patch, with expandable context
			await open(
				`${sim.thread("huge.diff", 2)}?panel=changes&path=shop:src/orders/query.ts`,
			);
			const pane = page.getByTestId("diff-file-pane");
			await expect(pane).toBeVisible();
			await splitBtn.click();
			await expect(pane).toHaveAttribute("data-split", "split");
			await unifiedBtn.click();
			await expect(pane).toHaveAttribute("data-split", "unified");
			const context = page.getByText(/orders query line \d+/);
			await expect(context.first()).toBeVisible();
			const shown = await context.count();
			await page.locator("[data-expand-button]").first().click();
			await expect.poll(() => context.count()).toBeGreaterThan(shown);

			// Unified automatically when narrow (on a 390 px phone)
			const phone = await device({ width: 390, height: 844 });
			await phone.goto(
				`${sim.thread("huge.diff", 2)}?panel=changes&path=shop:src/orders/query.ts`,
			);
			await expect(phone.getByTestId("diff-file-pane")).toHaveAttribute(
				"data-split",
				"unified",
				{ timeout: 30_000 },
			);
			await phone.context().close();

			return verdict(
				fails,
				`tree shows per-file +/- and a filter that narrows ${unfiltered} rows to ${narrowed} around CODEOWNERS; the patch switches split <-> unified, expands more context lines, is unified on a 390 px phone; wrap toggles`,
			);
		},
	},
	{
		item: "16.2",
		async run({ page, open, sim }) {
			await open(`${sim.thread("huge.diff", 0)}?panel=changes`);
			const diff = page.getByTestId("diff-surface");
			await expect(diff).toBeVisible();

			const fails: string[] = [];
			const named = page.getByTestId("diff-scope-named");
			// Await scoped changes to finish loading
			await expect(named).toContainText("files");

			const scopeBtn = page.getByTestId("diff-scope");
			await expect(scopeBtn).toContainText("All vs base");
			const allText = await scopeBtn.innerText();

			// Open scope picker and switch to "This turn"
			const turnOpt = page.getByTestId("diff-scope-turn");
			await expect(async () => {
				if (!(await turnOpt.isVisible())) await scopeBtn.click();
				await expect(turnOpt).toBeVisible({ timeout: 2000 });
			}).toPass({ timeout: 30_000 });
			// The option is re-drawn while the huge diff paints, so click it in the page.
			await turnOpt.evaluate((el) => (el as HTMLElement).click());

			await expect(scopeBtn).toContainText("This turn");
			const turnText = await scopeBtn.innerText();

			// Switch to "Uncommitted"
			const uncommittedOpt = page.getByTestId("diff-scope-uncommitted");
			await expect(async () => {
				if (!(await uncommittedOpt.isVisible())) await scopeBtn.click();
				await expect(uncommittedOpt).toBeVisible({ timeout: 2000 });
			}).toPass({ timeout: 30_000 });
			await uncommittedOpt.evaluate((el) => (el as HTMLElement).click());

			await expect(scopeBtn).toContainText("Uncommitted");
			const uncommittedText = await scopeBtn.innerText();

			// Restore to all vs base
			await page.getByTestId("diff-scope-clear").click();
			await expect(scopeBtn).toContainText("All vs base");

			return verdict(
				fails,
				`scopes supported and named: "${allText.trim()}" -> "${turnText.trim()}" -> "${uncommittedText.trim()}"`,
			);
		},
	},
	{
		item: "16.3",
		async run({ page, open, sim }) {
			// Open diff for PR #412 with specific path loaded in patch
			await open(
				`${sim.thread("huge.diff", 2)}?panel=changes&path=shop:src/orders/query.ts`,
			);
			await expect(page.getByTestId("diff-surface")).toBeVisible();

			const fails: string[] = [];
			const patch = page.getByTestId("diff-patch");
			await expect(patch).toBeVisible();

			// Hover over text in the patch to reveal the gutter utility comment button
			await patch.getByText("createdAt").first().hover();
			const utilityBtn = patch.locator("[data-utility-button]").first();
			await expect(utilityBtn).toBeVisible();
			const at = await utilityBtn.boundingBox();
			if (!at) throw new Error("the line's + button has no box");
			await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
			await page.mouse.down();
			await page.mouse.up();

			const box = page.getByLabel("Comment for the agent");
			await expect(box).toBeVisible();
			await box.fill("Check this query optimization");
			await page.getByTestId("diff-comment-add").click();

			// Comment shows as added note
			const added = page.getByTestId("diff-comment-added").first();
			await expect(added).toBeVisible();
			const addedText = await added.innerText();
			if (!addedText.includes("Check this query optimization")) {
				fails.push(`comment added note missing text (got: "${addedText}")`);
			}

			// Batched comment shows as chip in composer
			const chip = page.getByTestId("composer-quote").first();
			await expect(chip).toBeVisible();
			const chipText = await chip.innerText();
			if (!chipText.includes("Check this query optimization")) {
				fails.push(`composer chip missing comment text (got: "${chipText}")`);
			}

			return verdict(
				fails,
				`line comment added via "+" button, displays in patch ("${addedText.trim()}") and as quote chip in composer ("${chipText.trim()}")`,
			);
		},
	},
	{
		item: "16.4",
		async run({ page, open, sim }) {
			// Open PR thread diff with loaded patch to check per-file and per-hunk revert
			await open(
				`${sim.thread("huge.diff", 2)}?panel=changes&path=shop:src/orders/query.ts`,
			);
			await expect(page.getByTestId("diff-surface")).toBeVisible();
			await expect(page.getByTestId("diff-patch")).toBeVisible();

			const fails: string[] = [];
			// Per-file revert button and confirmation dialog
			const fileRevert = page.getByTestId("diff-revert-file");
			await expect(fileRevert).toBeVisible();
			await fileRevert.click();

			const confirm = page.getByTestId("diff-revert-confirm");
			await expect(confirm).toBeVisible();
			const text = await confirm.innerText();
			if (!text.includes("Revert")) {
				fails.push(
					`revert confirm missing "Revert" (got: "${text.slice(0, 60)}")`,
				);
			}
			// Cancel to preserve shared sim state
			await page.locator("button:has-text('Cancel')").last().click();
			await expect(confirm).toBeHidden();

			// Per-hunk revert in patch
			const hunkRevert = page.getByTestId("diff-revert-hunk").first();
			if (await hunkRevert.isVisible()) {
				await hunkRevert.click();
				await expect(confirm).toBeVisible();
				await page.locator("button:has-text('Cancel')").last().click();
				await expect(confirm).toBeHidden();
			} else {
				fails.push("diff-revert-hunk button not visible on hunk");
			}

			// Per-turn Undo on transcript row in diff-turns thread
			await open(sim.thread("huge.diff", 1));
			const undoBtn = page.getByTestId("turn-undo").first();
			await expect(undoBtn).toBeVisible();
			await undoBtn.click();

			const turnConfirm = page.getByTestId("turn-undo-confirm");
			await expect(turnConfirm).toBeVisible();
			const undoText = await turnConfirm.innerText();
			if (!undoText.includes("Undo this turn")) {
				fails.push(
					`turn undo dialog missing expected title (got: "${undoText.slice(0, 60)}")`,
				);
			}
			await page.locator("button:has-text('Cancel')").last().click();
			await expect(turnConfirm).toBeHidden();

			return verdict(
				fails,
				"per-file revert, per-hunk revert and per-turn Undo each open confirmed and cancelable dialogs",
			);
		},
	},
	{
		item: "16.5",
		async run({ page, open, sim }) {
			await open(`${sim.thread("huge.diff", 0)}?panel=changes`);
			await expect(page.getByTestId("diff-surface")).toBeVisible();

			const fails: string[] = [];
			// Open file in place with line highlighted
			const viewFileBtn = page.getByTestId("diff-view-file");
			await expect(viewFileBtn).toBeVisible();
			await viewFileBtn.click();

			const fileView = page.getByTestId("file-view");
			await expect(fileView).toBeVisible();

			const backBtn = page.getByTestId("file-view-back");
			await expect(backBtn).toBeVisible();
			await backBtn.click();
			await expect(page.getByTestId("diff-surface")).toBeVisible();

			// The file view: open in the editor, copy its path, attach it as context
			await viewFileBtn.click();
			for (const id of [
				"file-view-editor",
				"file-view-copy",
				"file-view-attach",
			]) {
				await expect(page.getByTestId(id)).toBeVisible();
			}
			await expect(page.getByTestId("file-view-code")).toContainText(/\S/);
			await page.getByTestId("file-view-back").click();

			// The file's ... menu offers the same three
			await page.getByTestId("diff-file-more").click();
			for (const name of ["Open in editor", "Copy path", "Attach to message"]) {
				await expect(page.getByRole("menuitem", { name })).toBeVisible();
			}
			await page.keyboard.press("Escape");

			return verdict(
				fails,
				"View file opens the file in place with its code, editor, copy-path and attach buttons, and the file menu lists Open in editor, Copy path and Attach to message",
			);
		},
	},
	{
		item: "16.6",
		async run({ page, open, sim }) {
			const fails: string[] = [];

			// A file the agent names opens at its line in one click
			await open(sim.thread("huge.diff", 1));
			const fileLink = page.locator("a[data-link-type='file']").first();
			await expect(fileLink).toBeVisible({ timeout: 30_000 });
			const cited = ((await fileLink.textContent()) ?? "").trim();
			await fileLink.click();
			await expect(page).toHaveURL(/panel=files/);
			const line = new URL(page.url()).searchParams.get("line");
			if (line !== cited.split(":")[1]) {
				fails.push(`cited "${cited}" opened at line ${line}`);
			}

			// The diff the turn row opens marks the user's own edit as outside, and the agent's files not
			await open(sim.thread("huge.diff", 1));
			await page.getByTestId("turn-changes-open").first().click();
			await expect(page.getByTestId("diff-surface")).toBeVisible();
			await expect(page.getByTestId("diff-scope-named")).toContainText(
				"3 files",
				{
					timeout: 30_000,
				},
			);
			const treeRows = () =>
				page.evaluate(() => {
					const host = document.querySelector("[data-testid=diff-files]");
					const root = host?.querySelector("*")?.shadowRoot;
					return Array.from(
						root?.querySelectorAll("[role=treeitem]") ?? [],
					).map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim());
				});
			await expect
				.poll(
					async () =>
						(await treeRows()).filter((r) => /outside/.test(r)).length,
					{
						timeout: 20_000,
					},
				)
				.toBeGreaterThan(0);
			const rows = await treeRows();
			const outside = rows.filter((r) => /outside/.test(r));
			const agents = rows.filter(
				(r) => /[+]\d+ [−-]\d+/.test(r) && !/outside/.test(r),
			);
			if (outside.length !== 1 || !/README/.test(outside[0] ?? "")) {
				fails.push(
					`outside-marked files are [${outside.join(" | ")}], expected only README.md`,
				);
			}
			if (agents.length < 2) {
				fails.push(
					`only ${agents.length} files are shown as the agent's own: [${rows.join(" | ")}]`,
				);
			}

			return verdict(
				fails,
				`cited "${cited}" opened the Files pane at line ${line} in one click; in the diff its turn row opens, only README.md is marked "outside" and ${agents.length} agent files are not`,
			);
		},
	},
	{
		item: "16.7",
		async run({ page, open, sim }) {
			await open(`${sim.thread("huge.diff", 0)}?panel=changes`);
			const diff = page.getByTestId("diff-surface");
			await expect(diff).toBeVisible();

			const fails: string[] = [];
			const named = page.getByTestId("diff-scope-named");
			// Await 1,000+ files to finish loading
			await expect(named).toContainText("files");
			const text = await named.innerText();

			const fileMatch = /(\d[\d,]*)\s*files?/.exec(text);
			const addMatch = /\+(\d[\d,]*)/.exec(text);
			const filesCount = fileMatch ? Number(fileMatch[1].replace(/,/g, "")) : 0;
			const addCount = addMatch ? Number(addMatch[1].replace(/,/g, "")) : 0;

			if (filesCount < 1000) {
				fails.push(`expected 1,000+ files, got ${filesCount} in "${text}"`);
			}
			if (addCount < 50000) {
				fails.push(`expected 50k+ additions, got ${addCount} in "${text}"`);
			}

			// File tree painted
			const tree = page.getByTestId("diff-tree-column");
			await expect(tree).toBeVisible();

			// File groups bar (tests, generated, lock, config, etc.)
			const groupBar = page.getByTestId("diff-groups");
			await expect(groupBar).toBeVisible();
			const groupButtons = page.locator("[data-testid^='diff-group-']");
			const groupCount = await groupButtons.count();
			if (groupCount === 0) {
				fails.push("no file group filter buttons found");
			}

			return verdict(
				fails,
				`huge diff loaded: ${filesCount} files, +${addCount} lines, file tree painted on demand with ${groupCount} group folding buttons`,
			);
		},
	},
]);
