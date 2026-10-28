// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	hideQueryDevtools,
	INVESTIGATION_ID,
	RUN_ID,
	serveEventsHistory,
	serveInvestigationAs,
} from "./live-stream-fixtures";

// The panel's views (#973): Files (the tree and the file at its commit) and Changes (a recorded pair).
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const HEAD = "a".repeat(40);
const BASE = "c".repeat(40);
const RUN_URL = `/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`;

const compare = {
	repo: "repo",
	head: HEAD,
	headKind: "deployment",
	headName: "v2.14.0",
	base: BASE,
	baseKind: "deployment",
	baseName: "v2.13.2",
	between: 3,
};

const workspace = {
	layout: "single" as const,
	cwd: "/work/repo",
	repos: [
		{
			name: "repo",
			dir: "/work/repo",
			sourceKind: "folder" as const,
			url: "/src/repo",
			subPath: null,
			connectionId: null,
			head: HEAD,
			branch: "main",
			services: [],
		},
	],
	compare: [compare],
};

const PATCH = [
	"diff --git a/src/payments/client.ts b/src/payments/client.ts",
	"index 1111111..2222222 100644",
	"--- a/src/payments/client.ts",
	"+++ b/src/payments/client.ts",
	"@@ -1,3 +1,3 @@",
	" export const gateway = {",
	"-  timeoutMs: 3000,",
	"+  timeoutMs: 800,",
	" };",
	"",
].join("\n");

function readEvent(): CanonicalEvent[] {
	const base = (seq: number) => ({
		runId: RUN_ID,
		branchId: "main",
		path: [] as string[],
		seq,
		ts: new Date(1700000000000 + seq * 1000).toISOString(),
	});
	return [
		{
			kind: "agent_step",
			...base(1),
			label: "agent",
			text: "Reading the client",
			toolCalls: [
				{
					toolCallId: "read-1",
					name: "read_file",
					args: { path: "repo/src/payments/client.ts", offset: 2 },
				},
			],
		},
		{
			kind: "tool_result",
			...base(2),
			label: null,
			result: {
				toolCallId: "read-1",
				name: "read_file",
				toolCategory: "file",
				ok: true,
				source: "read_file(repo/src/payments/client.ts)",
				preview: "read",
			},
		},
	] as CanonicalEvent[];
}

async function setup(page: Page, width = 1440) {
	await page.setViewportSize({ width, height: 900 });
	await hideQueryDevtools(page);
	await serveInvestigationAs(page, INVESTIGATION_ID, {
		status: "completed",
		workspace,
	});
	await serveEventsHistory(page, INVESTIGATION_ID, readEvent());
	const content = "export const gateway = {\n  timeoutMs: 800,\n};\n";
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}/blob`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					state: "ok",
					repo: "repo",
					sha: HEAD,
					path: "src/payments/client.ts",
					kind: "file",
					size: content.length,
					oid: "b".repeat(40),
					content,
					omitted: null,
				}),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}/diff`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					state: "ok",
					comparison: compare,
					files: [
						{
							path: "src/payments/client.ts",
							oldPath: null,
							additions: 1,
							deletions: 1,
						},
					],
					patch: PATCH,
					omitted: null,
				}),
			}),
	);
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}/tree`,
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					state: "ok",
					repo: "repo",
					sha: HEAD,
					prefix: null,
					entries: [
						{ name: "README.md", path: "README.md", type: "file" },
						{
							name: "client.ts",
							path: "src/payments/client.ts",
							type: "file",
						},
					],
					truncated: false,
				}),
			}),
	);
	await page.goto(RUN_URL);
	await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
}

test.describe("Panel views (#973)", () => {
	test("a Read step opens the file under Files; Back, Forward and reload show what the URL names", async ({
		page,
	}) => {
		await setup(page);
		const step1 = page.locator('[data-testid="step"][data-step="1"]');
		await expect(step1).toBeVisible({ timeout: 15_000 });
		if (!(await step1.getByTestId("step-body").isVisible()))
			await step1.getByTestId("step-toggle").click();
		await page.locator("#open-step-1").click();

		await expect(page.getByTestId("run-details-tab-files")).toHaveAttribute(
			"data-state",
			"active",
		);
		await expect(page.getByTestId("evidence-file")).toBeVisible();
		await expect(page).toHaveURL(/panel=files/);
		await expect(page).toHaveURL(/file=repo%3Asrc%2Fpayments%2Fclient\.ts/);

		await page.getByTestId("evidence-file-back").click();
		await expect(page.getByTestId("evidence-file")).toHaveCount(0);
		await expect(page.locator("#open-step-1")).toBeFocused();

		await page.goForward();
		await expect(page.getByTestId("evidence-file")).toBeVisible();
		await page.reload();
		await expect(page.getByTestId("evidence-file")).toBeVisible({
			timeout: 15_000,
		});
		await page.goBack();
		await expect(page.getByTestId("evidence-file")).toHaveCount(0);

		// The browser's Back returns focus to the step too (#975 OBJ-008).
		if (!(await step1.getByTestId("step-body").isVisible()))
			await step1.getByTestId("step-toggle").click();
		await page.locator("#open-step-1").click();
		await expect(page.getByTestId("evidence-file")).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId("evidence-file")).toHaveCount(0);
		await expect(page.locator("#open-step-1")).toBeFocused();
	});

	test("on a phone, a sheet opened for a file closes with it on Back, again after Forward", async ({
		page,
	}) => {
		await setup(page, 390);
		const step1 = page.locator('[data-testid="step"][data-step="1"]');
		await expect(step1).toBeVisible({ timeout: 15_000 });
		if (!(await step1.getByTestId("step-body").isVisible()))
			await step1.getByTestId("step-toggle").click();
		await page.locator("#open-step-1").click();
		const sheet = page.getByRole("dialog", { name: /details/i });
		await expect(sheet.getByTestId("evidence-file")).toBeVisible();
		for (let i = 0; i < 2; i++) {
			await page.goBack();
			await expect(sheet).toHaveCount(0);
			await page.goForward();
			await expect(sheet.getByTestId("evidence-file")).toBeVisible();
		}
		await page.goBack();
		await expect(sheet).toHaveCount(0);
	});

	test("Files lists what the run touched in a named tree", async ({ page }) => {
		await setup(page);
		await page.getByTestId("details-toggle").click();
		await page.getByTestId("run-details-tab-files").click();
		await expect(page).toHaveURL(/panel=files/);
		await expect(page.getByTestId("run-details-tab-files")).toContainText("1");
		const tree = page.getByRole("tree", { name: "Files this run touched" });
		await expect(tree).toBeVisible();
		const item = tree.getByRole("treeitem", { name: /client\.\s?ts/ });
		await expect(item).toBeVisible();
		await item.click();
		await expect(page.getByTestId("evidence-file")).toBeVisible();
	});

	test("All files opens a folder by keyboard with its files already listed", async ({
		page,
	}) => {
		await setup(page);
		await page.getByTestId("details-toggle").click();
		await page.getByTestId("run-details-tab-files").click();
		await page.getByTestId("files-mode-all").click();
		const tree = page.getByRole("tree", { name: /All files at/ });
		const folder = tree.getByRole("treeitem", { name: /src/ }).first();
		await expect(folder).toBeVisible();
		await folder.focus();
		await page.keyboard.press("ArrowRight");
		await expect(
			tree.getByRole("treeitem", { name: /client\.\s?ts/ }),
		).toBeVisible();
	});

	test("Changes names the recorded pair and draws its diff split, or unified when narrow", async ({
		page,
	}) => {
		await setup(page);
		await page.getByTestId("details-toggle").click();
		await page.getByTestId("run-details-tab-changes").click();
		await expect(page.getByTestId("changes-label")).toHaveText(
			"Deployment v2.14.0 against deployment v2.13.2, 3 commits",
		);
		const diff = page.getByTestId("changes-diff");
		await expect(diff).toBeVisible();
		// The default panel is narrower than the split breakpoint.
		await expect(diff).toHaveAttribute("data-style", "unified");
		const sep = page.getByTestId("panel-right-separator");
		await sep.focus();
		for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
		await page.getByTestId("changes-style-split").click();
		await expect(diff).toHaveAttribute("data-style", "split");
		await page.getByTestId("changes-style-unified").click();
		await expect(diff).toHaveAttribute("data-style", "unified");
	});

	test("a run that recorded no pair says so", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await hideQueryDevtools(page);
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "completed",
			workspace: { ...workspace, compare: undefined },
		});
		await page.goto(`${RUN_URL}&panel=changes`);
		await expect(page.getByTestId("run-page")).toBeVisible({ timeout: 15_000 });
		await page.getByTestId("details-toggle").click();
		await expect(page.getByTestId("changes-none")).toBeVisible();
	});
});
