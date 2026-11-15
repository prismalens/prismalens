// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { expect, type Locator, type Page } from "@playwright/test";
import { defineChecks, verdict } from "../bar";

/** The hint opens on pointer movement after a delay, so hover and then nudge the pointer. */
async function hoverHint(page: Page, el: Locator) {
	await el.hover();
	const box = await el.boundingBox();
	if (!box) throw new Error("hover target has no box");
	for (let i = 1; i <= 5; i++) {
		await page.mouse.move(box.x + box.width / 2 + i, box.y + box.height / 2);
		await page.waitForTimeout(200);
	}
}

/** The hint's own tooltip, hovering again when the first try meets a re-render of its anchor. */
async function showTip(page: Page, el: Locator): Promise<Locator> {
	const tip = page.getByRole("tooltip");
	for (let i = 0; i < 4; i++) {
		await page.mouse.move(5, 5);
		await page.waitForTimeout(400);
		await hoverHint(page, el);
		if (
			await expect(tip)
				.toBeVisible({ timeout: 4000 })
				.then(() => true)
				.catch(() => false)
		)
			break;
	}
	await expect(tip).toBeVisible({ timeout: 2000 });
	return tip;
}

/** #1101 category 11, Context. */
export default defineChecks([
	{
		item: "11.1",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("usage.telemetry"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const meter = page.getByTestId("context-meter");
			await expect(meter).toBeVisible({ timeout: 15_000 });

			const text = (await meter.textContent()) ?? "";
			const m = /(\d+k?)\s*\/\s*(\d+k?)/.exec(text);
			if (!m) {
				fails.push(
					`context meter text "${text}" does not match used / size ratio`,
				);
			}

			const ring = meter.getByTestId("context-meter-ring");
			await expect(ring).toBeVisible();
			const tone = await ring.getAttribute("data-tone");
			if (!tone || !["neutral", "warn", "danger"].includes(tone)) {
				fails.push(
					`context-meter-ring tone "${tone}" is not one of neutral|warn|danger`,
				);
			}

			const autoTick = meter.getByTestId("context-meter-auto");
			if ((await autoTick.count()) === 0) {
				fails.push("context-meter-auto tick is missing from the meter ring");
			}

			await meter.click();
			const autoLine = page.getByTestId("context-meter-auto-line");
			await expect(autoLine).toBeVisible({ timeout: 5000 });
			const autoText = (await autoLine.textContent()) ?? "";
			if (
				!autoText.includes("compaction point") &&
				!autoText.includes("Compacts by itself")
			) {
				fails.push(
					`compaction line "${autoText}" mentions neither compaction point nor Compacts by itself`,
				);
			}

			return verdict(
				fails,
				`context meter visible with ratio ${text}, tone "${tone}", auto tick mark, and compaction line "${autoText}"`,
			);
		},
	},
	{
		item: "11.2",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("usage.telemetry"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const composer = page.getByTestId("composer-input");
			await composer.fill("/context");
			await composer.press("Enter");

			const popover = page.getByTestId("context-meter-popover");
			await expect(popover).toBeVisible({ timeout: 10_000 });

			const breakdown = page.getByTestId("context-breakdown");
			await expect(breakdown).toBeVisible();

			const rows = breakdown.locator("table tbody tr[data-category]");
			const rowCount = await rows.count();
			if (rowCount === 0) {
				fails.push("no category rows in context breakdown table");
			}

			const rowData = await rows.evaluateAll((els) =>
				els.map((el) => {
					const cat = el.getAttribute("data-category") ?? "";
					const cells = Array.from(el.querySelectorAll("td")).map((td) =>
						(td.textContent ?? "").trim(),
					);
					return {
						cat,
						label: cells[0] ?? "",
						tokens: cells[1] ?? "",
						percent: cells[2] ?? "",
					};
				}),
			);

			for (const r of rowData) {
				if (!r.label) fails.push(`category ${r.cat} has no label`);
				if (!r.tokens) fails.push(`category ${r.cat} has no token count`);
				if (!r.percent?.includes("%")) {
					fails.push(`category ${r.cat} percent "${r.percent}" lacks % sign`);
				}
			}

			const largest = page.getByTestId("context-largest");
			let largestCount = 0;
			if (!(await largest.isVisible())) {
				fails.push("context-largest section is not visible");
			} else {
				const items = largest.locator("p.flex");
				largestCount = await items.count();
				if (largestCount === 0) {
					fails.push("context-largest has no items");
				}
			}

			return verdict(
				fails,
				`/context breakdown shows ${rowCount} categories with tokens and percent, and ${largestCount} largest items`,
			);
		},
	},
	{
		item: "11.3",
		async run({ page, open }) {
			const fails: string[] = [];

			// 1. Completed compaction with tokens before and after and focus instruction echoed
			const made = await page.request.post("/api/incidents", {
				data: { title: "Bar check 11.3 compaction", tags: ["chat"] },
			});
			if (!made.ok())
				throw new Error(`create incident failed: ${await made.text()}`);
			const { id: incidentId } = (await made.json()) as { id: string };

			const started = await page.request.post(
				`/api/incidents/${incidentId}/chat`,
				{
					data: {
						text: "Investigate latency fake-session:compact",
						harness: "claude-code",
					},
				},
			);
			if (!started.ok())
				throw new Error(`start chat failed: ${await started.text()}`);
			const { investigationId: runId } = (await started.json()) as {
				investigationId: string;
			};

			await open(`/threads/${runId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			await expect(
				page.getByText("The p99 rise follows d37d888").first(),
			).toBeVisible({ timeout: 40_000 });

			const compactRes = await page.request.post(
				`/api/investigations/${runId}/compact`,
				{
					data: { instructions: "keep the index finding" },
				},
			);
			if (!compactRes.ok())
				throw new Error(`compact request failed: ${await compactRes.text()}`);

			const divider = page.getByTestId("compaction-divider");
			// The event is stored, so a page the slow link left behind is reloaded once.
			if (
				!(await expect(divider.first())
					.toBeVisible({ timeout: 30_000 })
					.then(() => true)
					.catch(() => false))
			) {
				await page.reload();
				await expect(divider.first()).toBeVisible({ timeout: 60_000 });
			}

			const node = divider.first().getByTestId("node-compaction");
			await expect(node).toBeVisible();
			const nodeText = (await node.textContent()) ?? "";

			if (!/Compacted\s*·\s*\d+k?\s*to\s*\d+k?\s*tokens/i.test(nodeText)) {
				fails.push(
					`compaction node "${nodeText}" does not show tokens before and after`,
				);
			}

			const focus = node.getByTestId("node-compaction-focus");
			if (!(await focus.isVisible())) {
				fails.push(
					`compact sent with the focus "keep the index finding", but the divider reads "${nodeText.trim()}" with no Kept line`,
				);
			} else {
				const focusText = (await focus.textContent()) ?? "";
				if (!focusText.includes("keep the index finding")) {
					fails.push(
						`focus instruction "${focusText}" does not echo "keep the index finding"`,
					);
				}
			}

			// 2. Failed compaction offers Retry
			const madeFail = await page.request.post("/api/incidents", {
				data: { title: "Bar check 11.3 failed compaction", tags: ["chat"] },
			});
			const { id: failIncId } = (await madeFail.json()) as { id: string };

			const startedFail = await page.request.post(
				`/api/incidents/${failIncId}/chat`,
				{
					data: {
						text: "Investigate timeout fake-session:limit-follow-up",
						harness: "claude-code",
					},
				},
			);
			const { investigationId: failRunId } = (await startedFail.json()) as {
				investigationId: string;
			};

			await open(`/threads/${failRunId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible();
			await expect(
				page.getByText("The p99 rise follows d37d888").first(),
			).toBeVisible({ timeout: 40_000 });

			// Follow up with compact: true will hit the limit in fake-session:limit-follow-up
			await page.request.post(`/api/investigations/${failRunId}/messages`, {
				data: { text: "Still timing out?", compact: true },
			});

			const failNode = page.locator(
				'[data-testid="node-compaction"][data-phase="failed"]',
			);
			if (
				!(await expect(failNode.first())
					.toBeVisible({ timeout: 30_000 })
					.then(() => true)
					.catch(() => false))
			) {
				await page.reload();
				await expect(failNode.first()).toBeVisible({ timeout: 60_000 });
			}
			const retryBtn = failNode.first().getByTestId("node-compaction-retry");
			if (!(await retryBtn.isVisible())) {
				fails.push("failed compaction does not offer Retry button");
			} else {
				const retryText = (await retryBtn.textContent()) ?? "";
				if (!retryText.includes("Retry")) {
					fails.push(
						`retry button text "${retryText}" does not contain "Retry"`,
					);
				}
			}

			return verdict(
				fails,
				`compaction divider shows "${nodeText.trim()}", echoes focus instruction, and failed compaction offers Retry`,
			);
		},
	},
	{
		item: "11.4",
		async run({ page, open, sim }) {
			const fails: string[] = [];
			await open(sim.thread("usage.telemetry"));
			await expect(page.getByTestId("thread-page")).toBeVisible();

			const meter = page.getByTestId("context-meter");
			await expect(meter).toBeVisible({ timeout: 10_000 });
			await meter.click();

			const cacheLine = page.getByTestId("context-meter-cache");
			await expect(cacheLine).toBeVisible({ timeout: 5000 });

			const text = ((await cacheLine.textContent()) ?? "").trim();
			if (!text) {
				fails.push("cache state text is empty");
			} else if (
				!text.startsWith("Cache warm") &&
				!text.startsWith("Cache cold") &&
				!text.includes("counts as cold")
			) {
				fails.push(
					`cache state "${text}" is not stated plainly as warm or cold`,
				);
			}

			return verdict(fails, `cache state stated plainly: "${text}"`);
		},
	},
	{
		item: "11.5",
		async run({ page, open }) {
			const fails: string[] = [];

			// Create a thread with an agent that can compact (fake-session:compact)
			const made = await page.request.post("/api/incidents", {
				data: { title: "Bar check 11.5 context control", tags: ["chat"] },
			});
			if (!made.ok())
				throw new Error(`create incident failed: ${await made.text()}`);
			const { id: incidentId } = (await made.json()) as { id: string };

			const started = await page.request.post(
				`/api/incidents/${incidentId}/chat`,
				{
					data: {
						text: "Investigate latency fake-session:compact",
						harness: "claude-code",
					},
				},
			);
			if (!started.ok())
				throw new Error(`start chat failed: ${await started.text()}`);
			const { investigationId: runId } = (await started.json()) as {
				investigationId: string;
			};

			await open(`/threads/${runId}`);
			await expect(page.getByTestId("thread-page")).toBeVisible({
				timeout: 45_000,
			});
			await expect(
				page.getByText("The p99 rise follows d37d888").first(),
			).toBeVisible({ timeout: 40_000 });

			const ctrl = page.getByTestId("context-control");
			await expect(ctrl).toBeVisible({ timeout: 45_000 });
			// The sim's token count varies; the sentences are matched on whatever it shows.
			await expect(ctrl).toHaveText(/\d+k?/, { timeout: 30_000 });

			const modeBefore = await ctrl.getAttribute("data-mode", {
				timeout: 10_000,
			});
			if (modeBefore !== "keep") {
				fails.push(
					`initial context control mode is "${modeBefore}", expected "keep"`,
				);
			}

			const textBefore = (
				(await ctrl.textContent({ timeout: 10_000 })) ?? ""
			).trim();
			if (!/^Keep\s*\d+k?$/.test(textBefore)) {
				fails.push(
					`initial control text "${textBefore}" does not match "Keep <n>k"`,
				);
			}

			// Hover to inspect the tooltip
			const tip = await showTip(page, ctrl);
			const hintBefore = ((await tip.textContent()) ?? "").trim();
			if (
				!/Next send keeps all \d+k? tokens\. Click to compact first\./.test(
					hintBefore,
				)
			) {
				fails.push(
					`initial hover hint "${hintBefore}" did not match expected sentence`,
				);
			}

			// Click to toggle to Compact
			await ctrl.click();
			await expect(ctrl).toHaveAttribute("data-mode", "compact");
			const textToggled = ((await ctrl.textContent()) ?? "").trim();
			if (!/^Compact\s*\d+k?$/.test(textToggled)) {
				fails.push(
					`after click control text "${textToggled}" does not match "Compact <n>k"`,
				);
			}

			await showTip(page, ctrl);
			const hintToggled = ((await tip.textContent()) ?? "").trim();
			if (
				!/Next send compacts \d+k? tokens first\. Click to keep them all\./.test(
					hintToggled,
				)
			) {
				fails.push(
					`toggled hover hint "${hintToggled}" did not match expected sentence`,
				);
			}

			// Click again to toggle back to Keep
			await ctrl.click();
			await expect(ctrl).toHaveAttribute("data-mode", "keep");

			return verdict(
				fails,
				`context control toggles between "${textBefore}" and "${textToggled}", with exact hover sentences`,
			);
		},
	},
]);
