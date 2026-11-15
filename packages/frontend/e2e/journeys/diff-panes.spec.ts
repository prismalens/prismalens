// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { hideQueryDevtools, installStreamDouble } from "./live-stream-fixtures";

/**
 * The thread's diff surface and panes (#1101 categories 16 and 21), on a served thread with
 * two turns, an edit made outside them and an untracked file. With DESIGN_SHOTS set it also
 * writes the design-matrix states to DESIGN_SHOTS_DIR (default design-shots/matrix).
 */
const ID = "d1ff0000-0000-4000-8000-000000000001";
const CWD = "/tmp/worktrees/pl-d1ff0000";
const BASE = "a".repeat(40);
const T1S = "b".repeat(40);
const T1E = "c".repeat(40);
const T2S = "d".repeat(40);
const NOW = "e".repeat(40);
const OUT = resolve(process.env.DESIGN_SHOTS_DIR ?? "design-shots/matrix");

const APP_PATCH = `diff --git a/src/app.txt b/src/app.txt
index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644
--- a/src/app.txt
+++ b/src/app.txt
@@ -1,5 +1,5 @@
 line 1
 line 2
-timeout = 5
+timeout = 30
 line 4
 line 5
@@ -8,3 +8,3 @@ line 7
 line 8
 line 9
-retries = 1
+retries = 5
`;
const README_PATCH = `diff --git a/README.md b/README.md
index 3333333333333333333333333333333333333333..4444444444444444444444444444444444444444 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,3 @@
 # shop
+
+Edited by hand.
`;
const NOTES_PATCH = `diff --git a/NOTES.md b/NOTES.md
new file mode 100644
index 0000000000000000000000000000000000000000..5555555555555555555555555555555555555555
--- /dev/null
+++ b/NOTES.md
@@ -0,0 +1,3 @@
+# Notes
+
+Retries raised to 5 after the second look.
`;

type Scope = "all" | "turn" | "uncommitted" | "outside";
const FILES = {
	app: { path: "src/app.txt", status: "modified", additions: 2, deletions: 2 },
	readme: { path: "README.md", status: "modified", additions: 2, deletions: 0 },
	notes: { path: "NOTES.md", status: "added", additions: 3, deletions: 0 },
} as const;

function changes(scope: Scope, turn: number | null) {
	const set =
		scope === "outside"
			? [FILES.readme]
			: scope === "turn"
				? turn === 1
					? [FILES.app]
					: [FILES.app, FILES.notes]
				: [FILES.notes, FILES.readme, FILES.app];
	const patch = set
		.map((f) =>
			f === FILES.app
				? APP_PATCH
				: f === FILES.readme
					? README_PATCH
					: NOTES_PATCH,
		)
		.join("");
	const from =
		scope === "turn"
			? turn === 1
				? T1S
				: T2S
			: scope === "outside"
				? T1E
				: BASE;
	return {
		repos: [
			{
				state: "ok",
				repo: "shop",
				base: BASE,
				branch: "prismalens/shop-d1ff0000",
				files: set,
				additions: set.reduce((n, f) => n + f.additions, 0),
				deletions: set.reduce((n, f) => n + f.deletions, 0),
				patch,
				omitted: null,
				truncated: false,
				scoped: {
					scope,
					from,
					to: NOW,
					turn: scope === "turn" ? (turn ?? 2) : null,
					live: false,
					states: Object.fromEntries(
						set.map((f) => [f.path, `100644 ${"9".repeat(40)}`]),
					),
					outside: ["README.md"],
					skipped: [],
					turns: [
						{ seq: 1, ended: true },
						{ seq: 2, ended: true },
					],
					revert: null,
					interrupted: [],
				},
			},
		],
	};
}

async function serve(page: Page) {
	const row = {
		id: ID,
		incidentId: null,
		serviceId: null,
		scheduleId: null,
		repositoryId: null,
		subject: "project",
		status: "completed",
		kind: "chat",
		title: "Fix the checkout timeout",
		accessLevel: "supervised",
		harness: null,
		model: null,
		effort: null,
		hasReport: false,
		startedAt: new Date().toISOString(),
		completedAt: new Date().toISOString(),
		summary: null,
		rootCause: null,
		rootCauseCategory: null,
		report: null,
		error: null,
		liveTurn: null,
		workspace: {
			layout: "single",
			cwd: CWD,
			repos: [
				{
					name: "shop",
					dir: CWD,
					sourceKind: "folder",
					url: "/code/shop",
					subPath: null,
					connectionId: null,
					head: BASE,
					branch: "prismalens/shop-d1ff0000",
					services: [],
				},
			],
		},
		resumable: true,
		resumeBlockedReason: null,
		continuable: false,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	const json = (body: unknown) => ({
		status: 200,
		contentType: "application/json",
		body: JSON.stringify(body),
	});
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}`,
		(r) => r.fulfill(json(row)),
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/status`,
		(r) => r.fulfill(json({ investigation: row, job: null })),
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/events`,
		(r) => r.fulfill(json({ events: [], nextCursor: null })),
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/changes`,
		(r) => {
			const q = new URL(r.request().url()).searchParams;
			const turn = q.get("turn");
			return r.fulfill(
				json(
					changes(
						(q.get("scope") ?? "all") as Scope,
						turn ? Number(turn) : null,
					),
				),
			);
		},
	);
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/changes/file`,
		(r) =>
			r.fulfill(
				json({
					state: "ok",
					contents:
						"line 1\nline 2\ntimeout = 30\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nretries = 5\n",
				}),
			),
	);
	const reverts: unknown[] = [];
	await page.route(
		(u) => u.pathname === `/api/investigations/${ID}/changes/revert`,
		(r) => {
			reverts.push(r.request().postDataJSON());
			return r.fulfill(
				json({
					state: "done",
					revertId: "1700000000000",
					paths: ["src/app.txt"],
				}),
			);
		},
	);
	return reverts;
}

const shots = !!process.env.DESIGN_SHOTS;
async function shot(page: Page, name: string) {
	if (!shots) return;
	mkdirSync(OUT, { recursive: true });
	await page.waitForTimeout(300);
	await page.screenshot({
		path: join(OUT, `${name}.png`),
		animations: "disabled",
	});
}

test.describe("#1101 — the thread's diff and panes", () => {
	test.beforeEach(async ({ page }) => {
		await hideQueryDevtools(page);
		await installStreamDouble(page);
	});

	test("the diff names its scope, splits when wide, goes unified when narrow, and switches scope", async ({
		page,
	}) => {
		await serve(page);
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/threads/${ID}?panel=changes&path=shop:src/app.txt`);
		await expect(page.getByTestId("diff-surface")).toBeVisible();
		await expect(page.getByTestId("diff-scope-named")).toContainText(
			"All vs base · 3 files +7 −2",
		);
		// The side panel is narrower than two code columns: Auto stays unified there.
		await expect(page.getByTestId("diff-file-pane")).toHaveAttribute(
			"data-split",
			"unified",
		);
		await shot(page, "diff-unified-1600");
		await page.getByTestId("diff-style-split").click();
		await expect(page.getByTestId("diff-file-pane")).toHaveAttribute(
			"data-split",
			"split",
		);
		await shot(page, "diff-split-1600");
		await page.getByTestId("diff-style-auto").click();
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.getByTestId("diff-file-pane")).toHaveAttribute(
			"data-split",
			"unified",
		);
		await shot(page, "diff-unified-390");
		await page.setViewportSize({ width: 1600, height: 900 });
		for (const [s, named] of [
			["turn", "This turn · 2 files +5 −2"],
			["uncommitted", "Uncommitted · 3 files +7 −2"],
			["outside", "Outside turns · 1 file +2 −0"],
		] as const) {
			await page.getByTestId(`diff-scope-${s}`).click();
			await expect(page.getByTestId("diff-scope-named")).toContainText(named);
			await expect(page).toHaveURL(new RegExp(`scope=${s}`));
			await shot(page, `diff-scope-${s}-1600`);
		}
	});

	test("a revert asks first and names the file, and a turn's Undo asks first", async ({
		page,
	}) => {
		const reverts = await serve(page);
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/threads/${ID}?panel=changes&path=shop:src/app.txt`);
		await page.getByTestId("diff-revert-file").click();
		await expect(page.getByTestId("diff-revert-confirm")).toContainText(
			"Revert src/app.txt?",
		);
		await shot(page, "diff-revert-confirm-1600");
		await page.getByTestId("diff-revert-confirm-action").click();
		await expect.poll(() => reverts.length).toBe(1);
		expect(reverts[0]).toMatchObject({
			repo: "shop",
			scope: "all",
			from: BASE,
			target: { kind: "file", path: "src/app.txt" },
			expect: { "src/app.txt": `100644 ${"9".repeat(40)}` },
		});
		await page.getByTestId("diff-scope-turn").click();
		await page.getByTestId("turn-undo").click();
		await expect(page.getByTestId("turn-undo-confirm")).toContainText(
			"Undo this turn's changes?",
		);
		await shot(page, "diff-turn-undo-1600");
	});

	test("a + on a line opens a comment, and two comments go to the composer as two chips", async ({
		page,
	}) => {
		await serve(page);
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/threads/${ID}?panel=changes&path=shop:src/app.txt`);
		const patch = page.getByTestId("diff-patch");
		// The `+` follows the pointer: the first comment opens from it.
		await patch.getByText("timeout = 30").hover();
		await patch.locator("[data-utility-button]").last().click();
		await page.getByLabel("Comment for the agent").fill("Why 30 and not 20?");
		await shot(page, "diff-comment-open-1600");
		await page.getByTestId("diff-comment-add").click();
		// The second opens from the line number, on the added side of line 10.
		await patch.getByText("10", { exact: true }).last().click();
		await page
			.getByLabel("Comment for the agent")
			.fill("Make this configurable");
		await page.getByTestId("diff-comment-add").click();
		await expect(page.getByTestId("diff-comment-added")).toHaveText([
			"In your message: Why 30 and not 20?",
			"In your message: Make this configurable",
		]);
		await expect(page.getByTestId("composer-quote")).toHaveText([
			"src/app.txt:3 · Why 30 and not 20?",
			"src/app.txt:10 · Make this configurable",
		]);
		await shot(page, "diff-comment-chips-1600");
	});

	test("the New tab page lists every tool with its key, says why one cannot open, and tiles a pane", async ({
		page,
	}) => {
		await serve(page);
		await page.setViewportSize({ width: 1600, height: 900 });
		await page.goto(`/threads/${ID}?panel=thread`);
		await page.getByTestId("panel-new-tab").click();
		await expect(page.getByTestId("new-tab-page")).toBeVisible();
		for (const id of ["thread", "changes", "files", "browser", "terminal"])
			await expect(page.getByTestId(`new-tab-${id}`)).toBeVisible();
		await expect(page.getByTestId("new-tab-unavailable-browser")).toHaveText(
			"The browser pane needs the desktop app. Open this thread in PrismaLens desktop; links open in a new tab here.",
		);
		await shot(page, "panes-new-tab-1600");
		await page.getByTestId("new-tab-tile-changes").click();
		await expect(page.getByTestId("panel-split")).toBeVisible();
		await expect(page.getByTestId("panel-split")).toContainText("Changes");
		await shot(page, "panes-tiled-1600");
	});
});
