// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import {
	hideQueryDevtools,
	INVESTIGATION_ID,
	RUN_ID,
	serveEventsHistory,
	serveInvestigationAs,
} from "./live-stream-fixtures";

const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";
const SHA = "a".repeat(40);

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
			head: SHA,
			branch: "main",
			services: [],
		},
	],
};

function buildContent(lineCount = 2000): string {
	const words =
		"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega ";
	const padding = words.repeat(5).slice(0, 200);
	const lines: string[] = [];
	for (let i = 1; i <= lineCount; i++) {
		lines.push(`// line ${i} ${padding}`);
	}
	return lines.join("\n");
}

function makeTwoReadEvents(): CanonicalEvent[] {
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
			text: "Reading file at line 20",
			toolCalls: [
				{
					toolCallId: "read-1",
					name: "read_file",
					args: { path: "repo/src/long.ts", offset: 20 },
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
				source: "read_file(repo/src/long.ts)",
				preview: "read lines around 20",
			},
		},
		{
			kind: "agent_step",
			...base(3),
			label: "agent",
			text: "Reading file at line 1500",
			toolCalls: [
				{
					toolCallId: "read-2",
					name: "read_file",
					args: { path: "repo/src/long.ts", offset: 1500 },
				},
			],
		},
		{
			kind: "tool_result",
			...base(4),
			label: null,
			result: {
				toolCallId: "read-2",
				name: "read_file",
				toolCategory: "file",
				ok: true,
				source: "read_file(repo/src/long.ts)",
				preview: "read lines around 1500",
			},
		},
	];
}

async function setupPage(page: import("@playwright/test").Page) {
	await hideQueryDevtools(page);

	await serveInvestigationAs(page, INVESTIGATION_ID, {
		status: "completed",
		report: null,
		workspace,
	});

	await serveEventsHistory(page, INVESTIGATION_ID, makeTwoReadEvents());

	const content = buildContent(2000);
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}/blob`,
		async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					state: "ok",
					repo: "repo",
					sha: SHA,
					path: "src/long.ts",
					kind: "file",
					size: content.length,
					oid: "b".repeat(40),
					content,
					omitted: null,
				}),
			});
		},
	);
}

test.describe("Evidence file view resize (#874)", () => {
	test("Desktop (1280x800): cited line in view after details panel width change", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await setupPage(page);

		await page.goto(
			`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
		);

		const step1 = page.locator('[data-testid="step"][data-step="1"]');
		await expect(step1).toBeVisible({ timeout: 15_000 });

		const step1Body = step1.getByTestId("step-body");
		if (!(await step1Body.isVisible())) {
			await step1.getByTestId("step-toggle").click();
		}
		await expect(step1Body).toBeVisible();

		await page.locator("#open-step-1").click();

		const details = page.locator("#run-details");
		await expect(details).toBeVisible();
		await expect(page.getByTestId("evidence-file")).toBeVisible();

		const codeSection = page.getByTestId("evidence-file-code");
		await expect(codeSection).toHaveAttribute("data-first", "20");

		const line20 = page.locator('[data-line="20"]');
		await expect(line20).toBeInViewport({ timeout: 5000 });

		await page.evaluate(() => {
			const el = document.getElementById("run-details");
			if (el) el.style.width = "760px";
		});
		await page.waitForTimeout(500);

		await page.getByTestId("evidence-file-back").click();
		await expect(page.getByTestId("evidence-file")).toBeHidden();

		const step2 = page.locator('[data-testid="step"][data-step="2"]');
		await expect(step2).toBeVisible();

		const step2Body = step2.getByTestId("step-body");
		if (!(await step2Body.isVisible())) {
			await step2.getByTestId("step-toggle").click();
		}
		await expect(step2Body).toBeVisible();

		await page.locator("#open-step-2").click();

		await expect(codeSection).toHaveAttribute("data-first", "1500");
		const line1500 = page.locator('[data-line="1500"]');
		await expect(line1500).toBeInViewport({ timeout: 5000 });
	});

	test("Phone: cited line in view after viewport resize", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await setupPage(page);

		await page.goto(
			`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
		);

		const step1 = page.locator('[data-testid="step"][data-step="1"]');
		await expect(step1).toBeVisible({ timeout: 15_000 });

		const step1Body = step1.getByTestId("step-body");
		if (!(await step1Body.isVisible())) {
			await step1.getByTestId("step-toggle").click();
		}
		await expect(step1Body).toBeVisible();

		await page.locator("#open-step-1").click();

		await expect(page.getByTestId("evidence-file")).toBeVisible();

		const codeSection = page.getByTestId("evidence-file-code");
		await expect(codeSection).toHaveAttribute("data-first", "20");

		const line20 = page.locator('[data-line="20"]');
		await expect(line20).toBeInViewport({ timeout: 5000 });

		await page.setViewportSize({ width: 740, height: 844 });
		await page.waitForTimeout(500);

		await page.getByTestId("evidence-file-back").click();
		await expect(page.getByTestId("evidence-file")).toBeHidden();

		const step2 = page.locator('[data-testid="step"][data-step="2"]');
		await expect(step2).toBeVisible();

		const step2Body = step2.getByTestId("step-body");
		if (!(await step2Body.isVisible())) {
			await step2.getByTestId("step-toggle").click();
		}
		await expect(step2Body).toBeVisible();

		await page.locator("#open-step-2").click();

		await expect(codeSection).toHaveAttribute("data-first", "1500");
		const line1500 = page.locator('[data-line="1500"]');
		await expect(line1500).toBeInViewport({ timeout: 5000 });
	});
});
