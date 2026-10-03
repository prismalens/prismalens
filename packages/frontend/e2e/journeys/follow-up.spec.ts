// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { CanonicalEvent } from "@prismalens/contracts";
import { expect, type Page, test } from "@playwright/test";
import {
	deliver,
	eventFactory,
	hideQueryDevtools,
	INVESTIGATION_ID,
	installStreamDouble,
	RUN_ID,
	serveEventsHistory,
} from "./live-stream-fixtures";

/**
 * #752: a finished investigation takes a follow-up in the same session (#747).
 * The box sends, the conversation marks where the session resumed, the answer
 * streams in, and the report is the one it was before.
 *
 * The seed's completed investigation is served as resumable, the send answers
 * `resumed` and flips the status to `running`, and the stream is the double.
 */
const INCIDENT_ID = "b0111111-1111-4111-8111-111111111111";

/** The real GET, with the status the test holds and the follow-up admitted. */
async function serveFollowUpState(
	page: Page,
	status: () => string,
): Promise<void> {
	await page.route(
		(url) => url.pathname === `/api/investigations/${INVESTIGATION_ID}`,
		async (route) => {
			try {
				const response = await route.fetch();
				const body = (await response.json()) as Record<string, unknown>;
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						...body,
						status: status(),
						resumable: true,
						resumeBlockedReason: null,
					}),
				});
			} catch (error) {
				if (page.isClosed() || /disposed/i.test(String(error))) return;
				throw error;
			}
		},
	);
}

test.describe("#752 — a follow-up on a finished investigation", () => {
	test.beforeEach(({ page }) => hideQueryDevtools(page));

	test("sends, marks the resumed session, streams the answer, keeps the report", async ({
		page,
	}) => {
		let status = "completed";
		await installStreamDouble(page);
		await serveFollowUpState(page, () => status);
		const history = eventFactory("root");
		await serveEventsHistory(page, INVESTIGATION_ID, [
			history.agentStep("scout", "Mapping the connection pool"),
			history.branchDone(),
		]);
		let sent: Record<string, unknown> | null = null;
		await page.route(
			(url) =>
				url.pathname === `/api/investigations/${INVESTIGATION_ID}/messages`,
			async (route) => {
				sent = route.request().postDataJSON() as Record<string, unknown>;
				status = "running";
				await route.fulfill({
					status: 202,
					contentType: "application/json",
					body: JSON.stringify({ state: "resumed" }),
				});
			},
		);

		await page.goto(`/incidents/${INCIDENT_ID}/report`);
		const report = page.getByTestId("report-route");
		await expect(report).toBeVisible({ timeout: 15_000 });
		// The placeholder shows until the run's events load; compare the report itself.
		await expect(report.getByTestId("report-empty")).toHaveCount(0);
		const before = await report.innerText();

		await page.goto(`/incidents/${INCIDENT_ID}/conversation`);
		const input = page.getByTestId("composer-input");
		await expect(input).toBeVisible({ timeout: 15_000 });
		await input.fill("Why did the pool saturate at 14:02?");
		await input.press("Enter");

		await expect.poll(() => sent).toMatchObject({
			text: "Why did the pool saturate at 14:02?",
		});
		// The refetch reads `running`, so the stream double opens.
		await expect
			.poll(() => page.evaluate(() => window.__liveStream.sources.length))
			.toBeGreaterThan(0);

		const base = { runId: RUN_ID, branchId: "root", path: [] as string[] };
		const at = () => new Date().toISOString();
		const resumed: CanonicalEvent = {
			kind: "operator_message",
			...base,
			seq: 10,
			ts: at(),
			text: "Why did the pool saturate at 14:02?",
			mode: "queue",
			delivered: true,
			resumed: [{ name: "checkout-api", head: "1a2b3c4d5e6f" }],
		};
		await deliver(page, resumed);
		await deliver(page, {
			kind: "agent_step",
			...base,
			seq: 11,
			ts: at(),
			label: "root",
			text: "The deploy at 14:00 halved the pool size.",
			toolCalls: [],
		});

		await expect(page.getByTestId("transcript-divider")).toContainText(
			"Resumed in the same session, code at 1a2b3c4",
		);
		await expect(
			page.getByText("The deploy at 14:00 halved the pool size."),
		).toBeVisible();

		status = "completed";
		await page.evaluate(() =>
			window.__liveStream.deliver(JSON.stringify({ type: "done" })),
		);

		await page.goto(`/incidents/${INCIDENT_ID}/report`);
		await expect(report).toBeVisible({ timeout: 15_000 });
		await expect.poll(() => report.innerText()).toBe(before);
	});
});
