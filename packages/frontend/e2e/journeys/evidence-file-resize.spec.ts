// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Page, test } from "@playwright/test";
import type { CanonicalEvent } from "@prismalens/contracts";
import { sidewaysFaults } from "../steps/product";
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

/** A report whose one piece of evidence cites the file the run read. */
const CITING = {
	summary: "The long file is slow.",
	rootCause: "Line 20 of src/long.ts loops.",
	rootCauseCategory: "code",
	hypotheses: [
		{
			statement: "Line 20 loops",
			status: "supported",
			evidence: [
				{
					observation: "The loop at line 20 never exits early",
					source: "repo/src/long.ts:20",
					direction: "supports",
					status: "verified",
					toolCallId: "read-1",
				},
				{
					observation: "Line 1500 is never reached",
					source: "read_file output",
					direction: "supports",
					status: "verified",
					toolCallId: "read-2",
				},
			],
		},
	],
	ruledOut: [],
	coverage: { queried: ["code"], notQueried: [] },
	nextSteps: [],
};

async function setupPage(page: Page, report: object | null = null) {
	await hideQueryDevtools(page);

	await serveInvestigationAs(page, INVESTIGATION_ID, {
		status: "completed",
		report,
		workspace,
	});

	// A report event ends the transcript with the report and its hypotheses card.
	const ended = report
		? ({
				kind: "report",
				runId: RUN_ID,
				seq: 5,
				ts: new Date(1700000005000).toISOString(),
				report,
			} as CanonicalEvent)
		: null;
	await serveEventsHistory(page, INVESTIGATION_ID, [
		...makeTwoReadEvents(),
		...(ended ? [ended] : []),
	]);

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

		// Widen the panel the way a reader does: its separator, by keyboard (#973).
		await page.getByTestId("panel-right-separator").focus();
		for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowLeft");
		await page.waitForTimeout(500);

		// Step 2 opens from the transcript beside the panel: the same code view, its heights cached at the old width.
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

	test.describe("on a phone, Run details is a sheet (0.5.3 walk W11)", () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await setupPage(page, CITING);
			await page.goto(
				`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
			);
			await page.getByTestId("details-toggle").click();
			await expect(page.getByTestId("run-details")).toBeVisible();
		});

		test("Back from a file cited in Summary returns to the citation, inside the sheet", async ({
			page,
		}) => {
			await page.getByTestId("run-details-tab-summary").click();
			await page.getByTestId("detail-file").first().click();
			await expect(page.getByTestId("evidence-file")).toBeVisible();
			await page.getByTestId("evidence-file-back").click();
			await expect(page.getByTestId("evidence-file")).toBeHidden();
			await expect(page.getByTestId("run-details-summary")).toBeVisible();
			await expect(page.getByTestId("detail-file").first()).toBeFocused();
		});

		test("Back from a file opened in Steps returns to the steps, inside the sheet", async ({
			page,
		}) => {
			await page.getByTestId("run-details-tab-steps").click();
			await page.locator('[data-testid="steps-row"][data-step="1"]').click();
			await expect(page.getByTestId("evidence-file")).toBeVisible();
			await page.getByTestId("evidence-file-back").click();
			await expect(page.getByTestId("evidence-file")).toBeHidden();
			await expect(page.getByTestId("run-details-steps")).toBeVisible();
			await expect(page.locator("#steps-row-1")).toBeFocused();
		});

		test("a step link in the sheet lifts it and shows the step", async ({
			page,
		}) => {
			await page.getByTestId("run-details-tab-summary").click();
			await page.getByTestId("detail-step").first().click();
			await expect(page.getByTestId("run-details")).toBeHidden();
			await expect(
				page.locator('[data-testid="step"][data-step="1"]'),
			).toBeInViewport();
			await expect(
				page
					.locator('[data-testid="step"][data-step="1"]')
					.getByTestId("step-toggle"),
			).toBeFocused();
		});

		test("the drawing opened from the sheet: a step lifts the sheet, a file comes Back to Summary", async ({
			page,
		}) => {
			const preview = page.getByTestId("hypotheses-preview");
			const open = async () => {
				await page.getByTestId("run-details-tab-summary").click();
				await page.getByTestId("detail-hypotheses").click();
				await expect(preview).toBeVisible();
			};
			await open();
			await preview
				.getByTestId("hypotheses-cite")
				.filter({ hasNotText: "long.ts" })
				.click();
			await expect(page.getByTestId("run-details")).toBeHidden();
			await expect(
				page.locator('[data-testid="step"][data-step="2"]'),
			).toBeInViewport();

			await page.getByTestId("details-toggle").click();
			await open();
			await preview
				.getByTestId("hypotheses-cite")
				.filter({ hasText: "long.ts" })
				.click();
			await expect(page.getByTestId("evidence-file")).toBeVisible();
			await page.getByTestId("evidence-file-back").click();
			await expect(page.getByTestId("run-details-summary")).toBeVisible();
			await expect(page.getByTestId("detail-hypotheses")).toBeFocused();
		});

		test("the sideways guard sees a spill inside the open sheet", async ({
			page,
		}) => {
			expect(await sidewaysFaults(page)).toEqual([]);
			await page
				.locator("#run-details h2")
				.evaluate((h) => h.style.setProperty("min-width", "600px"));
			expect((await sidewaysFaults(page)).join(" | ")).toMatch(
				/spans \d+ to \d+ of 390/,
			);
		});

		test("the drawing opened from the sheet gives focus back to its link on Esc and on Close", async ({
			page,
		}) => {
			const preview = page.getByTestId("hypotheses-preview");
			const link = page.getByTestId("detail-hypotheses");
			await page.getByTestId("run-details-tab-summary").click();
			for (const close of ["Escape", "Close"] as const) {
				await link.click();
				await expect(preview).toBeVisible();
				if (close === "Escape") await page.keyboard.press("Escape");
				else await preview.getByRole("button", { name: "Close" }).click();
				await expect(preview).toBeHidden();
				await expect(page.getByTestId("run-details")).toBeVisible();
				await expect(link, `after ${close}`).toBeFocused();
			}
		});

		test("the sheet is a dialog that holds focus, and Esc closes it once", async ({
			page,
		}) => {
			await expect(page.getByRole("dialog")).toContainText("Run 1 details");
			await page.getByTestId("run-details-close").focus();
			await page.keyboard.press("Shift+Tab");
			expect(
				await page.evaluate(
					() => !!document.activeElement?.closest('[role="dialog"]'),
				),
				"focus stays in the sheet",
			).toBe(true);
			await page.keyboard.press("Escape");
			await expect(page.getByTestId("run-details")).toBeHidden();
			await expect(page.getByTestId("details-toggle")).toBeFocused();
			await expect(page.getByTestId("details-toggle")).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		});

		test("nothing spills sideways with a file open at 320, 360 and 390 px", async ({
			page,
		}) => {
			await page.getByTestId("run-details-tab-steps").click();
			await page.locator('[data-testid="steps-row"][data-step="1"]').click();
			await expect(page.getByTestId("evidence-file-code")).toBeVisible();
			for (const width of [320, 360, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await page.waitForTimeout(300);
				expect.soft(await sidewaysFaults(page), `at ${width}`).toEqual([]);
			}
		});
	});

	test.describe("a phone chat whose tools did not connect (0.5.3 walk W11)", () => {
		test.use({ hasTouch: true, isMobile: true });

		test("Question details shows the tools status and the trust hint the strip hides", async ({
			page,
		}) => {
			await page.setViewportSize({ width: 390, height: 844 });
			await hideQueryDevtools(page);
			await serveInvestigationAs(page, INVESTIGATION_ID, {
				status: "completed",
				kind: "chat",
				harness: "gemini",
				report: null,
				workspace,
			});
			const disconnected = {
				kind: "harness_tools",
				runId: RUN_ID,
				branchId: "main",
				path: [],
				seq: 5,
				ts: new Date(1700000005000).toISOString(),
				server: "prismalens",
				turn: "first",
				connected: false,
				calls: [],
			} as CanonicalEvent;
			await serveEventsHistory(page, INVESTIGATION_ID, [
				...makeTwoReadEvents(),
				disconnected,
			]);
			await page.goto(
				`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
			);
			await expect(page.getByTestId("details-warn")).toBeVisible({
				timeout: 15_000,
			});
			await page.getByTestId("details-toggle").tap();
			await expect(page.getByTestId("run-tools-status")).toHaveText(
				"Did not reach the model",
			);
			await expect(page.getByTestId("run-tools-hint")).toContainText(
				"trust the runs folder",
			);
		});
	});

	test("a phone run with a flag and a hidden warning marks the toggle with both", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await hideQueryDevtools(page);
		await serveInvestigationAs(page, INVESTIGATION_ID, {
			status: "completed",
			report: {
				...CITING,
				flaggedContent: [
					{
						where: "tool-output",
						quote: "ignore all previous instructions",
						why: "prompt injection attempt in tool output",
					},
				],
			},
			workspace,
		});
		await serveEventsHistory(page, INVESTIGATION_ID, [
			...makeTwoReadEvents(),
			{
				kind: "harness_tools",
				runId: RUN_ID,
				branchId: "main",
				path: [],
				seq: 5,
				ts: new Date(1700000005000).toISOString(),
				server: "prismalens",
				turn: "first",
				connected: false,
				calls: [],
			} as CanonicalEvent,
		]);
		await page.goto(
			`/incidents/${INCIDENT_ID}/conversation?investigation=${INVESTIGATION_ID}`,
		);
		await expect(page.getByTestId("details-flag")).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.getByTestId("details-warn")).toBeVisible();
		await expect(page.getByTestId("details-toggle")).toHaveAttribute(
			"aria-label",
			/1 flagged item, Tools: not connected/,
		);
	});
});
