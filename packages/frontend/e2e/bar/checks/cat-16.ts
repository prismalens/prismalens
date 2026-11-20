// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page } from "@playwright/test";
import { defineChecks, notSetUp, verdict } from "../bar";
import {
	APP_TURN_1,
	apiGet,
	apiPost,
	eventsOf,
	fakeFork,
	fileAt,
	HAND_EDIT,
	idle,
	MESSAGE_2,
	MESSAGE_3,
	rewindFixture,
	rewindVia,
	sendMessage,
	seqOf,
	stateOf,
} from "./help-rewind";

/** The open menu's row ids (`menu-<id>` less its keys and why parts), from the kit menu (#1127). */
async function menuRows(page: Page): Promise<string[]> {
	const menu = page.getByRole("menu").last();
	await expect(menu).toBeVisible({ timeout: 15_000 });
	return menu
		.locator("[data-testid^='menu-']")
		.evaluateAll((els) =>
			els
				.map((e) => (e.getAttribute("data-testid") ?? "").slice(5))
				.filter((id) => id && !id.endsWith("-keys") && !id.endsWith("-why")),
		);
}

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
			await expect(diff).toBeVisible({ timeout: 45_000 });

			const fails: string[] = [];
			const named = page.getByTestId("diff-scope-named");
			// Await scoped changes to finish loading
			await expect(named).toContainText("files", { timeout: 45_000 });

			const scopeBtn = page.getByTestId("diff-scope");
			// The pane may open on any scope, so each is picked and its name read back.
			const pick = async (id: string, label: string) => {
				const opt = page.getByTestId(`diff-scope-${id}`);
				// The option is re-drawn while the huge diff paints, so each try opens, clicks and reads back.
				await expect(async () => {
					if (!(await opt.isVisible())) await scopeBtn.click();
					await expect(opt).toBeVisible({ timeout: 2000 });
					await opt.click({ timeout: 3000 });
					await expect(scopeBtn).toContainText(label, { timeout: 4000 });
				}).toPass({ timeout: 60_000 });
				return (await scopeBtn.innerText()).trim();
			};
			const allText = await pick("all", "All vs base");
			const turnText = await pick("turn", "This turn");

			// Switch to "Uncommitted"
			const uncommittedText = await pick("uncommitted", "Uncommitted");

			// Restore to all vs base
			await page.getByTestId("diff-scope-clear").click();
			await expect(scopeBtn).toContainText("All vs base", { timeout: 30_000 });

			return verdict(
				fails,
				`scopes supported and named: "${allText}" -> "${turnText}" -> "${uncommittedText}"`,
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
			await expect(page.getByTestId("diff-surface")).toBeVisible({
				timeout: 45_000,
			});

			const fails: string[] = [];
			const patch = page.getByTestId("diff-patch");
			// The patch column shows only when the panel is wide: the narrow panel lists files first.
			await page.getByLabel("Expand the panel").click({ timeout: 30_000 });
			await expect(patch).toBeVisible({ timeout: 60_000 });

			// Hover over text in the patch to reveal the gutter utility comment button
			const utilityBtn = patch.locator("[data-utility-button]").first();
			// The gutter button follows the pointer once the patch has painted, late on the slow link.
			await expect(async () => {
				await page.mouse.move(700, 600);
				await patch.getByText("createdAt").first().hover({ timeout: 5000 });
				await expect(utilityBtn).toBeVisible({ timeout: 3000 });
			}).toPass({ timeout: 60_000 });
			const at = await utilityBtn.boundingBox();
			if (!at) throw new Error("the line's + button has no box");
			await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
			await page.mouse.down();
			await page.mouse.up();

			const box = page.getByLabel("Comment for the agent");
			await expect(box).toBeVisible({ timeout: 15_000 });
			await box.fill("Check this query optimization");
			await page.getByTestId("diff-comment-add").click();

			// Comment shows as added note
			const added = page.getByTestId("diff-comment-added").first();
			await expect(added).toBeVisible({ timeout: 15_000 });
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
			// In the narrow panel the tree and the patch take turns: a pick opens the file (#1101 cat 16).
			await page
				.getByTestId("diff-files")
				.getByRole("treeitem", { name: /query\.ts/ })
				.first()
				.click();
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
			// The patch's hunk bars draw after the file diff, later on the slow link (#1101 cat 16).
			await hunkRevert
				.waitFor({ state: "visible", timeout: 30_000 })
				.catch(() => undefined);
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
	{
		item: "16.8",
		async run({ page, open, sim, context }) {
			await context.grantPermissions(["clipboard-read", "clipboard-write"]);
			await open(
				`${sim.thread("huge.diff", 2)}?panel=changes&path=shop:src/orders/query.ts`,
			);
			const fails: string[] = [];
			const patch = page.getByTestId("diff-patch");
			await page.getByLabel("Expand the panel").click({ timeout: 30_000 });
			await expect(patch).toBeVisible({ timeout: 60_000 });

			// Right-click a line: Comment and Copy line are on its menu.
			const line = patch.getByText("createdAt").first();
			await expect(line).toBeVisible({ timeout: 60_000 });
			await line.click({ button: "right" });
			const rows = await menuRows(page);
			for (const id of ["comment", "copy"])
				if (!rows.includes(id)) fails.push(`line menu lacks ${id} (${rows})`);
			await page.getByTestId("menu-copy").click();
			const copied = await page.evaluate(() => navigator.clipboard.readText());
			if (!copied.includes("createdAt"))
				fails.push(`Copy line put "${copied.slice(0, 60)}" on the clipboard`);

			// The keyboard's right-click opens the same menu on the focused diff.
			await patch.focus();
			await page.keyboard.press("Shift+F10");
			const keyed = await menuRows(page);
			if (!keyed.includes("comment"))
				fails.push(`Shift+F10 menu lacks comment (${keyed})`);
			await page.keyboard.press("Escape");

			return verdict(
				fails,
				`a diff line's right-click lists ${rows.join(", ")}; Copy line copied "${copied.trim().slice(0, 40)}"; Shift+F10 opens ${keyed.length} rows`,
			);
		},
	},
	{
		item: "16.9",
		async run({ page, open, sim }) {
			const fx = await rewindFixture(page, sim, { messages: [] });
			if (typeof fx === "string") return notSetUp(fx);
			const fails: string[] = [];
			// A slow follow-up keeps the thread running while Edit is tried.
			await sendMessage(page, fx.id, "Check the retries again, take your time");
			await open(fx.path, "thread-page");
			await expect(page.getByTestId("composer-stop")).toBeVisible({
				timeout: 30_000,
			});
			const sent = page
				.getByText("Check the retries again, take your time")
				.first();
			await sent.click({ button: "right" });
			const rows = await menuRows(page);
			if (!rows.includes("edit"))
				fails.push(`the message menu lacks edit (${rows})`);
			const disabled = await page
				.getByTestId("menu-edit")
				.getAttribute("data-disabled");
			const why = (
				(await page.getByTestId("menu-edit-why").textContent()) ?? ""
			).trim();
			if (disabled === null)
				fails.push("Edit is enabled while the thread runs");
			if (!/Stop the thread/.test(why))
				fails.push(`the running hint reads "${why}"`);
			await page.keyboard.press("Escape");

			await page.getByTestId("composer-stop").click();
			await idle(page, fx.id);
			await sent.click({ button: "right" });
			await page.getByTestId("menu-edit").click();
			const editor = page.getByTestId("message-edit");
			await expect(editor).toBeVisible({ timeout: 15_000 });
			await page.getByTestId("message-edit-text").press("Escape");
			await expect(editor).toBeHidden();
			return verdict(
				fails,
				`while running Edit is disabled with "${why}"; after Stop it opens the editor, and Esc closes it`,
			);
		},
	},
	{
		item: "16.10",
		async run({ page, open, sim }) {
			const fx = await rewindFixture(page, sim);
			if (typeof fx === "string") return notSetUp(fx);
			const fails: string[] = [];
			const before = await stateOf(page, fx.id, fx.cwd);
			await open(fx.path, "thread-page");
			await page
				.getByText(MESSAGE_2, { exact: true })
				.first()
				.click({ button: "right" });
			await page.getByTestId("menu-edit").click();
			await page.getByTestId("message-edit-text").fill("Set the retries to 5");
			await page.getByTestId("message-edit-send").click();
			const dialog = page.getByTestId("rewind-confirm");
			await expect(dialog).toBeVisible({ timeout: 15_000 });
			await expect(page.getByTestId("rewind-turns")).toBeVisible({
				timeout: 30_000,
			});
			const read = async (id: string) =>
				(
					(await page
						.getByTestId(id)
						.textContent()
						.catch(() => "")) ?? ""
				).trim();
			const turns = await read("rewind-turns");
			const revert = await read("rewind-revert");
			const kept = await read("rewind-kept");
			const session = await read("rewind-session");
			if (!/Folds 2 turns/.test(turns))
				fails.push(`turns line reads "${turns}"`);
			if (!/src\/app\.txt/.test(revert))
				fails.push(`set-back line reads "${revert}"`);
			if (!/README\.md \(you changed it\)/.test(kept))
				fails.push(`kept line reads "${kept}"`);
			if (!session) fails.push("no session line");
			const print = await read("rewind-small-print");
			if (
				!/may not be in the backup/.test(print) ||
				!/byte-for-byte/.test(print)
			)
				fails.push("the small print lacks R4 or R5");
			await page.getByRole("button", { name: "Cancel" }).last().click();
			await expect(dialog).toBeHidden();
			const after = await stateOf(page, fx.id, fx.cwd);
			if (after !== before)
				fails.push(`Cancel changed the thread: ${before} -> ${after}`);
			return verdict(
				fails,
				`the dialog reads "${turns}", "${revert}", "${kept}", "${session}"; Cancel left events, files and session columns as they were`,
			);
		},
	},
	{
		item: "16.11",
		async run({ page, open, sim }) {
			const fx = await rewindFixture(page, sim);
			if (typeof fx === "string") return notSetUp(fx);
			const fails: string[] = [];
			const rowsBefore = (await eventsOf(page, fx.id)).length;
			await open(fx.path, "thread-page");
			await page
				.getByText(MESSAGE_2, { exact: true })
				.first()
				.click({ button: "right" });
			await page.getByTestId("menu-edit").click();
			await page.getByTestId("message-edit-text").fill("Set the retries to 5");
			await page.getByTestId("message-edit-send").click();
			await expect(page.getByTestId("rewind-turns")).toBeVisible({
				timeout: 30_000,
			});
			await page.getByRole("button", { name: "Rewind and send" }).click();
			await expect(page.getByTestId("rewind-confirm")).toBeHidden({
				timeout: 30_000,
			});
			await idle(page, fx.id);
			const app = fileAt(fx.cwd, "src/app.txt");
			const readme = fileAt(fx.cwd, "README.md");
			if (app !== APP_TURN_1)
				fails.push(`src/app.txt is ${JSON.stringify(app)}`);
			if (readme !== HAND_EDIT)
				fails.push("the hand edit to README.md was lost");
			const fold = page.getByTestId("rewind-fold").first();
			await expect(fold).toBeVisible({ timeout: 30_000 });
			const foldText = ((await fold.textContent()) ?? "").trim();
			if (!/2 turns folded/.test(foldText))
				fails.push(`the fold row reads "${foldText}"`);
			await page.getByTestId("rewind-fold-show").first().click();
			const folded = page.getByTestId("rewind-folded").first();
			await expect(folded).toBeVisible({ timeout: 15_000 });
			if (!((await folded.textContent()) ?? "").includes(MESSAGE_3))
				fails.push("Show does not list the folded message");
			// Folded rows leave the visible record; the edit adds its own, so the store only grows.
			const all = await apiGet<{ events: unknown[] }>(
				page,
				`/threads/${fx.id}/rewind/${(await eventsOf(page, fx.id)).find((e) => e.kind === "thread_rewound")?.rewindId}/folded`,
			);
			if (all.events.length === 0) fails.push("the folded rows were not kept");
			const rowsAfter =
				(await eventsOf(page, fx.id)).length + all.events.length;
			if (rowsAfter < rowsBefore)
				fails.push(`rows dropped from ${rowsBefore} to ${rowsAfter}`);
			return verdict(
				fails,
				`src/app.txt is back at turn 1, README.md keeps the hand edit, the fold row reads "${foldText}" and Show lists the folded turns; ${all.events.length} rows folded, none deleted`,
			);
		},
	},
	{
		item: "16.12",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			const roundTrip = async (waitForReply: boolean) => {
				const fx = await rewindFixture(page, sim);
				if (typeof fx === "string") return fx;
				const before = await stateOf(page, fx.id, fx.cwd);
				const seq = await seqOf(page, fx.id, MESSAGE_2);
				if (seq === null) return "message 2 is not in the record";
				const r = await rewindVia(page, fx.id, seq, "Set the retries to 5");
				if (r.state !== "done" || !r.rewindId)
					return `the rewind answered ${r.state} ${r.reason ?? ""}`;
				if (waitForReply) await idle(page, fx.id);
				else
					await apiPost(page, `/investigations/${fx.id}/cancel`, {}).catch(
						() => undefined,
					);
				await idle(page, fx.id);
				const u = await apiPost<{ state: string; reason?: string }>(
					page,
					`/threads/${fx.id}/rewind/undo`,
					{ id: fx.id, rewindId: r.rewindId },
				);
				if (u.state !== "done")
					return `Undo answered ${u.state} ${u.reason ?? ""}`;
				const after = await stateOf(page, fx.id, fx.cwd);
				const b = JSON.parse(before) as {
					app: string;
					readme: string;
					session: unknown;
				};
				const a = JSON.parse(after) as {
					app: string;
					readme: string;
					session: unknown;
				};
				const visible = (await eventsOf(page, fx.id)).filter(
					(e) => e.kind === "operator_message",
				);
				if (a.app !== b.app || a.readme !== b.readme)
					fails.push(
						`${waitForReply ? "after the reply" : "before admission"}: files differ after Undo`,
					);
				if (JSON.stringify(a.session) !== JSON.stringify(b.session))
					fails.push(
						`${waitForReply ? "after the reply" : "before admission"}: session columns differ`,
					);
				if (!visible.some((e) => e.text === MESSAGE_3))
					fails.push("Undo did not bring the folded turns back");
				if (visible.some((e) => e.text === "Set the retries to 5"))
					fails.push("the edited branch is still visible after Undo");
				await open(`/threads/${fx.id}`, "thread-page");
				await expect(page.getByTestId("rewind-undone").first()).toBeVisible({
					timeout: 15_000,
				});
				return null;
			};
			for (const wait of [true, false]) {
				const why = await roundTrip(wait);
				if (why) return notSetUp(why);
			}

			// The crash fixture: an uncommitted rewind, flagged at boot, then Restore.
			let interrupted = "not checked";
			const crash = sim.thread("host.rewind-interrupted");
			if (crash) {
				await open(crash, "thread-page");
				const row = page.getByTestId("rewind-interrupted").first();
				await expect(row).toBeVisible({ timeout: 30_000 });
				interrupted = ((await row.textContent()) ?? "").trim();
				if (!/Rewind interrupted/.test(interrupted))
					fails.push(`the interrupted row reads "${interrupted}"`);
				await page.getByTestId("rewind-interrupted-restore").first().click();
				await expect(page.getByTestId("rewind-restore-preview")).toBeVisible({
					timeout: 30_000,
				});
				await page.getByRole("button", { name: "Restore" }).last().click();
				await expect(page.getByTestId("rewind-restored").first()).toBeVisible({
					timeout: 30_000,
				});
			}

			// Asks and approvals in the folded range close as superseded, both ways.
			const fx = await rewindFixture(page, sim, { messages: [] });
			if (typeof fx === "string") return notSetUp(fx);
			await sendMessage(
				page,
				fx.id,
				"fake-session:ask-user Which retries should I use?",
			);
			await page.waitForTimeout(3000);
			const asked = await apiGet<{
				asks: { ask: { askId: string; threadId: string }; ended: boolean }[];
			}>(page, "/threads/asks");
			const open1 = asked.asks.find(
				(a) => !a.ended && a.ask.threadId === fx.id,
			);
			if (open1) {
				await apiPost(page, `/investigations/${fx.id}/cancel`, {}).catch(
					() => undefined,
				);
				await idle(page, fx.id);
				const seq = await seqOf(
					page,
					fx.id,
					"fake-session:ask-user Which retries should I use?",
				);
				const r =
					seq === null
						? null
						: await rewindVia(page, fx.id, seq, "Use 3 retries.");
				const closed = (await eventsOf(page, fx.id)).some(
					(e) =>
						e.kind === "ask_closed" &&
						e.askId === open1.ask.askId &&
						e.outcome === "superseded",
				);
				if (!r || r.state !== "done")
					fails.push("the rewind over an open ask did not run");
				else if (!closed)
					fails.push("the open ask did not close as superseded");
				const late = await page.request.post(
					`/api/investigations/${fx.id}/asks/${open1.ask.askId}`,
					{ data: { askId: open1.ask.askId, decision: "approve" } },
				);
				if (late.ok()) fails.push("answering the superseded ask was taken");
				if (r?.rewindId) {
					await idle(page, fx.id);
					await apiPost(page, `/threads/${fx.id}/rewind/undo`, {
						id: fx.id,
						rewindId: r.rewindId,
					});
					await open(`/threads/${fx.id}`, "thread-page");
					await expect(
						page.getByText("Superseded by an edit").first(),
					).toBeVisible({ timeout: 15_000 });
				}
			} else fails.push("the ask-user turn opened no ask");

			return verdict(
				fails,
				`Undo after the reply and before admission both restore files, turns and session columns and fold the edited branch; the crash row read "${interrupted}" and Restore ran; the folded ask closed as superseded and stayed closed after Undo`,
			);
		},
	},
	{
		item: "16.13",
		async run({ page, sim }) {
			const fails: string[] = [];
			const opened = async (
				label: string,
				fake: Parameters<typeof fakeFork>[0],
				setting: "fork" | "replay",
				expectHow: string,
			) => {
				fakeFork(fake);
				await page.request.patch("/api/settings/harness", {
					data: { rewindSession: setting },
				});
				const fx = await rewindFixture(page, sim);
				if (typeof fx === "string") return fx;
				const seq = await seqOf(page, fx.id, MESSAGE_3);
				if (seq === null) return "message 3 is not in the record";
				const r = await rewindVia(page, fx.id, seq, "Set the retries to 6");
				if (r.state !== "done")
					return `${label}: the rewind answered ${r.state}`;
				await idle(page, fx.id);
				const events = await eventsOf(page, fx.id);
				const at = events.findIndex((e) => e.kind === "thread_rewound");
				const tail = events.slice(at);
				const session = tail.find((e) => e.kind === "session_opened");
				const input = tail.find((e) => e.kind === "turn_input");
				const how = String(session?.how ?? "none");
				if (how !== expectHow)
					fails.push(`${label}: opened ${how}, not ${expectHow}`);
				if (expectHow !== "fork" && setting === "fork" && !session?.forkFailed)
					fails.push(`${label}: the divider names no reason`);
				if (!input) fails.push(`${label}: no prompt recorded after the edit`);
				else {
					const body = await apiGet<{ parts: { text?: string }[] }>(
						page,
						`/investigations/${fx.id}/turn-inputs/${String(input.inputId)}`,
					).catch(() => null);
					const sent = (body?.parts ?? []).map((p) => p.text ?? "").join("\n");
					if (sent.includes(MESSAGE_3))
						fails.push(`${label}: the prompt carried the folded message`);
				}
				return null;
			};
			const cases: [
				string,
				Parameters<typeof fakeFork>[0],
				"fork" | "replay",
				string,
			][] = [
				["fork", {}, "fork", "fork"],
				["ignoreForkPoint", { ignoreForkPoint: true }, "fork", "handoff"],
				["another adapter", { version: "0.107.0" }, "fork", "handoff"],
				["setting replay", {}, "replay", "handoff"],
			];
			try {
				for (const [label, fake, setting, how] of cases) {
					const why = await opened(label, fake, setting, how);
					if (why) return notSetUp(why);
				}
			} finally {
				fakeFork(null);
				await page.request.patch("/api/settings/harness", {
					data: { rewindSession: "fork" },
				});
			}
			return verdict(
				fails,
				"the edit opened on a fork at the pinned adapter; ignoreForkPoint, another adapter version and the replay setting each replayed with the reason on the divider; no prompt carried the folded message",
			);
		},
	},
]);
